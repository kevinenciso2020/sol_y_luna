import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { adminProductQuerySchema, productInputSchema } from '@sol-y-luna/shared';
import { handler } from '../../lib/async.js';
import { actorFrom } from '../../middleware/actor.js';
import type { AdminProductsService } from '../../services/admin-products.service.js';
import { idParams } from './params.js';

const statusBody = z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']) });

export function adminProductsRouter(deps: { products: AdminProductsService }): ExpressRouter {
  const { products } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (req, res) => {
      res.json(await products.list(adminProductQuerySchema.parse(req.query)));
    }),
  );

  router.post(
    '/',
    handler(async (req, res) => {
      const input = productInputSchema.parse(req.body);
      res.status(201).json({ data: await products.create(input, actorFrom(req)) });
    }),
  );

  router.get(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json({ data: await products.get(id) });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const input = productInputSchema.parse(req.body);
      res.json({ data: await products.update(id, input, actorFrom(req)) });
    }),
  );

  router.patch(
    '/:id/status',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const { status } = statusBody.parse(req.body);
      res.json({ data: await products.setStatus(id, status, actorFrom(req)) });
    }),
  );

  router.delete(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await products.remove(id, actorFrom(req));
      res.status(204).end();
    }),
  );

  return router;
}
