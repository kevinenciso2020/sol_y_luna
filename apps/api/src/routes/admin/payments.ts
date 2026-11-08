import { Router, type Router as ExpressRouter } from 'express';
import type { Env } from '../../config/env.js';
import { handler } from '../../lib/async.js';
import { HttpError } from '../../lib/http-error.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit } from '../../services/audit.js';
import type { MercadoPago } from '../../services/payments/mercadopago.js';
import { signOAuthState } from '../payments.js';

export function adminPaymentsRouter(deps: {
  db: Db;
  env: Env;
  mercadoPago: MercadoPago | null;
  stateSecret: string;
}): ExpressRouter {
  const { db, env } = deps;
  const router = Router();

  router.get(
    '/status',
    handler(async (_req, res) => {
      const account = await db.paymentAccount.findUnique({ where: { provider: 'MERCADOPAGO' } });
      res.json({
        data: {
          mode: env.PAYMENTS_MODE,
          demo: env.features.payments.mock,
          mercadopago: {
            configured: env.features.payments.mercadopago,
            mode: env.MP_MODE,
            connected:
              env.MP_MODE === 'direct' ? env.features.payments.mercadopago : Boolean(account),
            connectedAt: account?.connectedAt ?? null,
            expiresAt: account?.expiresAt ?? null,
          },
          wompi: { configured: env.features.payments.wompi, env: env.WOMPI_ENV },
        },
      });
    }),
  );

  router.post(
    '/mercadopago/connect',
    handler(async (req, res) => {
      if (!deps.mercadoPago || env.MP_MODE !== 'marketplace') {
        throw new HttpError(
          400,
          'Mercado Pago en modo marketplace no está configurado',
          'PROVIDER_DISABLED',
        );
      }
      await db.$transaction((tx) =>
        audit(tx, actorFrom(req), {
          action: 'payments.mercadopago.connect',
          entity: 'PaymentAccount',
          entityId: 'MERCADOPAGO',
        }),
      );
      res.json({
        data: { url: deps.mercadoPago.authorizationUrl(signOAuthState(deps.stateSecret)) },
      });
    }),
  );

  router.delete(
    '/mercadopago',
    handler(async (req, res) => {
      await db.$transaction(async (tx) => {
        await tx.paymentAccount.deleteMany({ where: { provider: 'MERCADOPAGO' } });
        await audit(tx, actorFrom(req), {
          action: 'payments.mercadopago.disconnect',
          entity: 'PaymentAccount',
          entityId: 'MERCADOPAGO',
        });
      });
      res.status(204).end();
    }),
  );

  return router;
}
