import { Router, type Response, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { checkoutSchema } from '@sol-y-luna/shared';
import type { PaymentProvider as ProviderId } from '../generated/prisma/client.js';
import { handler } from '../lib/async.js';
import { HttpError } from '../lib/http-error.js';
import type { Db } from '../lib/prisma.js';
import { limiter, type RateLimitConfig } from '../middleware/rate-limit.js';
import type { OrdersService } from '../services/orders.service.js';
import type { TurnstileVerifier } from '../services/turnstile.js';
import { cartOwner } from './cart.js';

export const ORDER_COOKIE = 'syl_pedido';
const ORDER_COOKIE_MAX_AGE_MS = 7 * 86_400_000;

const numberParams = z.object({
  number: z.string().regex(/^SYL-\d{6,}$/, { error: 'Número de pedido inválido' }),
});
const retryBody = z.object({
  paymentProvider: z.enum(['MOCK', 'MERCADOPAGO', 'WOMPI']).optional(),
});

/** Parses "SYL-000123" into 123. */
export const parseOrderNumber = (value: string) => Number(value.slice(4));

/** Reads the guest order cookie ("SYL-000123.token"); returns the token only for that order. */
export function orderTokenFor(cookie: unknown, orderNumber: string): string | undefined {
  if (typeof cookie !== 'string') return undefined;
  const [number, token] = cookie.split('.');
  return number === orderNumber && token && token.length < 100 ? token : undefined;
}

export function checkoutRouter(deps: {
  orders: OrdersService;
  turnstile: TurnstileVerifier;
  db: Db;
  rate: RateLimitConfig;
  secureCookies: boolean;
  demoMode: boolean;
  mercadoPagoNeedsAccount: boolean;
}): ExpressRouter {
  const { orders, turnstile, db, secureCookies } = deps;
  const router = Router();

  async function providersAvailable(): Promise<ProviderId[]> {
    const list = orders.availableProviders();
    if (deps.mercadoPagoNeedsAccount && list.includes('MERCADOPAGO')) {
      const account = await db.paymentAccount.findUnique({
        where: { provider: 'MERCADOPAGO' },
        select: { id: true },
      });
      if (!account) return list.filter((p) => p !== 'MERCADOPAGO');
    }
    return list;
  }

  const setOrderCookie = (res: Response, orderNumber: string, token: string) =>
    res.cookie(ORDER_COOKIE, `${orderNumber}.${token}`, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: ORDER_COOKIE_MAX_AGE_MS,
    });

  router.get(
    '/checkout/options',
    handler(async (_req, res) => {
      const providers = await providersAvailable();
      res.json({ data: { providers, demo: deps.demoMode || providers.includes('MOCK') } });
    }),
  );

  router.post(
    '/checkout',
    limiter(deps.rate),
    handler(async (req, res) => {
      const input = checkoutSchema.parse(req.body);
      // Guest checkout is protected with Turnstile (signed-in users already passed it at login).
      if (!req.auth && !(await turnstile.verify(input.turnstileToken, req.clientIp))) {
        throw new HttpError(
          400,
          'No pudimos verificar que eres una persona. Intenta de nuevo.',
          'TURNSTILE_FAILED',
        );
      }
      if (!(await providersAvailable()).includes(input.paymentProvider)) {
        throw new HttpError(400, 'Ese medio de pago no está disponible', 'PROVIDER_DISABLED', [
          { path: ['paymentProvider'], message: 'Elige otro medio de pago' },
        ]);
      }
      const result = await orders.checkout(input, cartOwner(req));
      setOrderCookie(res, result.orderNumber, result.accessToken);
      res.status(201).json({
        data: {
          orderNumber: result.orderNumber,
          reference: result.reference,
          redirectUrl: result.redirectUrl,
        },
      });
    }),
  );

  router.get(
    '/orders/:number',
    handler(async (req, res) => {
      const { number } = numberParams.parse(req.params);
      const order = await orders.findAuthorized(parseOrderNumber(number), {
        userId: req.auth?.userId,
        accessToken:
          orderTokenFor(req.cookies?.[ORDER_COOKIE], number) ??
          (typeof req.query['token'] === 'string' ? req.query['token'] : undefined),
      });
      const { toOrderDto } = await import('../services/orders.service.js');
      res.json({ data: toOrderDto(order) });
    }),
  );

  router.post(
    '/orders/:number/retry',
    limiter(deps.rate),
    handler(async (req, res) => {
      const { number } = numberParams.parse(req.params);
      const { paymentProvider } = retryBody.parse(req.body ?? {});
      const result = await orders.retryPayment(
        parseOrderNumber(number),
        {
          userId: req.auth?.userId,
          accessToken: orderTokenFor(req.cookies?.[ORDER_COOKIE], number),
        },
        paymentProvider,
      );
      res.json({ data: result });
    }),
  );

  /** Order status by payment reference (result pages after the gateway redirect). */
  router.get(
    '/payments/:reference',
    handler(async (req, res) => {
      const reference = z
        .string()
        .regex(/^SYL-\d{6,}-[A-Z0-9]{1,10}$/)
        .parse(req.params['reference']);
      const payment = await orders.findByReference(reference);
      const number = reference.split('-').slice(0, 2).join('-');
      await orders.findAuthorized(payment.order.number, {
        userId: req.auth?.userId,
        accessToken: orderTokenFor(req.cookies?.[ORDER_COOKIE], number),
      });
      const { toOrderDto } = await import('../services/orders.service.js');
      res.json({
        data: {
          reference,
          paymentStatus: payment.status,
          provider: payment.provider,
          order: toOrderDto(payment.order),
        },
      });
    }),
  );

  return router;
}
