import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { handler } from '../lib/async.js';
import { HttpError } from '../lib/http-error.js';
import type { Logger } from '../lib/logger.js';
import { limiter, type RateLimitConfig } from '../middleware/rate-limit.js';
import type { OrdersService } from '../services/orders.service.js';
import type { MercadoPago } from '../services/payments/mercadopago.js';
import { InvalidSignatureError } from '../services/payments/types.js';
import { verifyWompiEvent } from '../services/payments/wompi.js';
import { ORDER_COOKIE, orderTokenFor } from './checkout.js';

const mockBody = z.object({
  reference: z.string().regex(/^SYL-\d{6,}-[A-Z0-9]{1,10}$/),
  outcome: z.enum(['approve', 'decline', 'pending']),
});

/** Signed OAuth state: "exp.nonce.signature" (10 minutes). */
export function signOAuthState(secret: string, now = Date.now()) {
  const payload = `${now + 10 * 60_000}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${createHmac('sha256', secret).update(`mp-oauth:${payload}`).digest('base64url')}`;
}
export function verifyOAuthState(secret: string, state: string, now = Date.now()) {
  const [exp, nonce, sig] = state.split('.');
  if (!exp || !nonce || !sig || Number(exp) < now) return false;
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`mp-oauth:${exp}.${nonce}`).digest('base64url'),
  );
  const received = Buffer.from(sig);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function paymentsRouter(deps: {
  orders: OrdersService;
  logger: Logger;
  rate: RateLimitConfig;
  mockEnabled: boolean;
  wompiEventsSecret: string | undefined;
  mercadoPago: MercadoPago | null;
  stateSecret: string;
  webUrl: string;
}): ExpressRouter {
  const { orders, logger } = deps;
  const router = Router();

  /** Simulated payment page (demo): same internal flow as a real webhook. */
  router.post(
    '/payments/mock/complete',
    limiter(deps.rate),
    handler(async (req, res) => {
      if (!deps.mockEnabled) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
      const { reference, outcome } = mockBody.parse(req.body);
      const payment = await orders.findByReference(reference);
      if (payment.provider !== 'MOCK')
        throw new HttpError(400, 'Este pago no es simulado', 'INVALID_PROVIDER');
      const number = reference.split('-').slice(0, 2).join('-');
      await orders.findAuthorized(payment.order.number, {
        userId: req.auth?.userId,
        accessToken: orderTokenFor(req.cookies?.[ORDER_COOKIE], number),
      });
      const status =
        outcome === 'approve' ? 'APPROVED' : outcome === 'decline' ? 'DECLINED' : 'PENDING';
      const result = await orders.processPaymentEvent({
        provider: 'MOCK',
        externalEventId: `mock:${reference}:${status}:${randomBytes(6).toString('hex')}`,
        reference,
        externalPaymentId: `mock-${reference}`,
        status,
        amount: payment.order.total,
        feeAmount: null,
        raw: { simulated: true, outcome },
      });
      res.json({
        data: {
          outcome: result.outcome,
          resultUrl: `/pago/resultado?ref=${encodeURIComponent(reference)}`,
        },
      });
    }),
  );

  /** Wompi events: verified checksum, idempotent processing. */
  router.post(
    '/webhooks/wompi',
    limiter(deps.rate),
    handler(async (req, res) => {
      if (!deps.wompiEventsSecret) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
      try {
        const event = verifyWompiEvent(req.body, deps.wompiEventsSecret);
        const result = await orders.processPaymentEvent(event);
        res.json({ received: true, ...result });
      } catch (error) {
        if (error instanceof InvalidSignatureError) {
          logger.warn({ reason: error.message }, 'webhook de Wompi rechazado');
          throw new HttpError(401, 'Firma inválida', 'INVALID_SIGNATURE');
        }
        throw error;
      }
    }),
  );

  /** Mercado Pago notifications: x-signature verified, then the payment is fetched from MP. */
  router.post(
    '/webhooks/mercadopago',
    limiter(deps.rate),
    handler(async (req, res) => {
      if (!deps.mercadoPago) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
      const body = (req.body ?? {}) as { type?: string; data?: { id?: string | number } };
      const queryId = req.query['data.id'];
      try {
        const event = await deps.mercadoPago.handleNotification({
          signatureHeader: req.header('x-signature'),
          requestId: req.header('x-request-id'),
          dataId:
            typeof queryId === 'string'
              ? queryId
              : body.data?.id !== undefined
                ? String(body.data.id)
                : undefined,
          type: typeof req.query['type'] === 'string' ? req.query['type'] : body.type,
        });
        if (!event) {
          res.json({ received: true, outcome: 'ignored' });
          return;
        }
        res.json({ received: true, ...(await orders.processPaymentEvent(event)) });
      } catch (error) {
        if (error instanceof InvalidSignatureError) {
          logger.warn({ reason: error.message }, 'webhook de Mercado Pago rechazado');
          throw new HttpError(401, 'Firma inválida', 'INVALID_SIGNATURE');
        }
        throw error;
      }
    }),
  );

  /** OAuth callback: the merchant authorized our Mercado Pago app. */
  router.get(
    '/payments/mercadopago/oauth/callback',
    handler(async (req, res) => {
      const done = (status: string) =>
        res.redirect(303, `${deps.webUrl.replace(/\/$/, '')}/admin/pagos?mp=${status}`);
      if (!deps.mercadoPago) return done('no-configurado');
      const code = typeof req.query['code'] === 'string' ? req.query['code'] : '';
      const state = typeof req.query['state'] === 'string' ? req.query['state'] : '';
      if (!code || !verifyOAuthState(deps.stateSecret, state)) return done('estado-invalido');
      await deps.mercadoPago.exchangeCode(code);
      logger.info('cuenta de Mercado Pago conectada');
      return done('conectado');
    }),
  );

  return router;
}
