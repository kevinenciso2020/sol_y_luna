import { Router, type Router as ExpressRouter } from 'express';
import {
  adminOrderQuerySchema,
  inventoryQuerySchema,
  orderNumberParamsSchema,
  orderStatusChangeSchema,
  refundInputSchema,
  settlementGenerateSchema,
  settlementNotesSchema,
  shipmentInputSchema,
  stockAdjustmentSchema,
} from '@sol-y-luna/shared';
import { handler } from '../lib/async.js';
import { actorFrom } from '../middleware/actor.js';
import type { BackofficeScope, BackofficeService } from '../services/backoffice.service.js';
import type { SettlementsService } from '../services/settlements.service.js';
import { idParams } from './admin/params.js';

/**
 * Orders, stock and settlements for the panels. Mounted twice: under /api/admin (scope ADMIN,
 * with refunds and settlement management) and under /api/operator (scope OPERATOR: paid orders
 * only, dispatch transitions, read-only settlements). Role checks happen where it is mounted.
 */
export function backofficeRouter(deps: {
  backoffice: BackofficeService;
  settlements: SettlementsService;
  scope: BackofficeScope;
}): ExpressRouter {
  const { backoffice, settlements, scope } = deps;
  const router = Router();

  // ─── Orders ───
  router.get(
    '/orders',
    handler(async (req, res) => {
      res.json(await backoffice.listOrders(adminOrderQuerySchema.parse(req.query), scope));
    }),
  );
  router.get(
    '/orders/:number',
    handler(async (req, res) => {
      const { number } = orderNumberParamsSchema.parse(req.params);
      res.json({ data: await backoffice.getOrder(number, scope) });
    }),
  );
  router.post(
    '/orders/:number/status',
    handler(async (req, res) => {
      const { number } = orderNumberParamsSchema.parse(req.params);
      const input = orderStatusChangeSchema.parse(req.body);
      res.json({ data: await backoffice.changeStatus(number, input, actorFrom(req), scope) });
    }),
  );
  router.put(
    '/orders/:number/shipment',
    handler(async (req, res) => {
      const { number } = orderNumberParamsSchema.parse(req.params);
      const input = shipmentInputSchema.parse(req.body);
      res.json({ data: await backoffice.saveShipment(number, input, actorFrom(req), scope) });
    }),
  );
  if (scope === 'ADMIN') {
    router.post(
      '/orders/:number/refunds',
      handler(async (req, res) => {
        const { number } = orderNumberParamsSchema.parse(req.params);
        const input = refundInputSchema.parse(req.body);
        res.status(201).json({ data: await backoffice.refund(number, input, actorFrom(req)) });
      }),
    );
  }

  // ─── Stock ───
  router.get(
    '/inventory',
    handler(async (req, res) => {
      res.json(await backoffice.listInventory(inventoryQuerySchema.parse(req.query)));
    }),
  );
  router.post(
    '/inventory/:id/adjust',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const input = stockAdjustmentSchema.parse(req.body);
      res.json({ data: await backoffice.adjustStock(id, input, actorFrom(req)) });
    }),
  );

  // ─── Settlements ───
  router.get(
    '/settlements',
    handler(async (_req, res) => {
      res.json({ data: await settlements.list() });
    }),
  );
  router.get(
    '/settlements/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json({ data: await settlements.get(id) });
    }),
  );
  router.get(
    '/settlements/:id/csv',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const file = await settlements.csv(id);
      res
        .type('text/csv; charset=utf-8')
        .attachment(file.filename)
        .set('Cache-Control', 'no-store')
        .send(file.content);
    }),
  );
  if (scope === 'ADMIN') {
    router.post(
      '/settlements',
      handler(async (req, res) => {
        const { date } = settlementGenerateSchema.parse(req.body ?? {});
        res.status(201).json({ data: await settlements.generate(date, actorFrom(req)) });
      }),
    );
    const action = (name: 'recalculate' | 'close' | 'markPaid', path: string) =>
      router.post(
        `/settlements/:id/${path}`,
        handler(async (req, res) => {
          const { id } = idParams.parse(req.params);
          res.json({ data: await settlements[name](id, actorFrom(req)) });
        }),
      );
    action('recalculate', 'recalculate');
    action('close', 'close');
    action('markPaid', 'pay');
    router.put(
      '/settlements/:id/notes',
      handler(async (req, res) => {
        const { id } = idParams.parse(req.params);
        const { notes } = settlementNotesSchema.parse(req.body);
        res.json({ data: await settlements.updateNotes(id, notes ?? null, actorFrom(req)) });
      }),
    );
    router.delete(
      '/settlements/:id',
      handler(async (req, res) => {
        const { id } = idParams.parse(req.params);
        await settlements.remove(id, actorFrom(req));
        res.status(204).end();
      }),
    );
  }

  return router;
}
