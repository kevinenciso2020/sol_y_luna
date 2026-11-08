import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { catalogQuerySchema, slugSchema } from '@sol-y-luna/shared';
import { handler } from '../lib/async.js';
import type { Db } from '../lib/prisma.js';
import type { CatalogService } from '../services/catalog.service.js';

const slugParams = z.object({ slug: slugSchema });
const legalParams = z.object({
  key: z.enum(['terms', 'privacy', 'withdrawal', 'shipping', 'returns']),
});

/** Public, read-only catalog. Short public caching keeps the store fast. */
export function catalogRouter(deps: { catalog: CatalogService; db: Db }): ExpressRouter {
  const { catalog, db } = deps;
  const router = Router();
  const cache = (seconds: number) =>
    `public, max-age=${seconds}, stale-while-revalidate=${seconds * 5}`;

  router.get(
    '/products',
    handler(async (req, res) => {
      const query = catalogQuerySchema.parse(req.query);
      res.setHeader('Cache-Control', cache(60));
      res.json(await catalog.listProducts(query));
    }),
  );

  router.get(
    '/products/:slug',
    handler(async (req, res) => {
      const { slug } = slugParams.parse(req.params);
      let wholesaleApproved = false;
      if (req.auth) {
        const user = await db.user.findUnique({
          where: { id: req.auth.userId },
          select: { wholesaleStatus: true },
        });
        wholesaleApproved = user?.wholesaleStatus === 'APPROVED';
      }
      // Personalized answers (wholesale prices) must never be cached publicly.
      res.setHeader('Cache-Control', req.auth ? 'private, no-store' : cache(60));
      res.json({ data: await catalog.getProduct(slug, { wholesaleApproved }) });
    }),
  );

  router.get(
    '/categories',
    handler(async (_req, res) => {
      res.setHeader('Cache-Control', cache(300));
      res.json({ data: await catalog.categoryTree() });
    }),
  );

  router.get(
    '/brands',
    handler(async (_req, res) => {
      res.setHeader('Cache-Control', cache(300));
      res.json({ data: await catalog.listBrands() });
    }),
  );

  router.get(
    '/brands/:slug',
    handler(async (req, res) => {
      const { slug } = slugParams.parse(req.params);
      res.setHeader('Cache-Control', cache(300));
      res.json({ data: await catalog.getBrand(slug) });
    }),
  );

  router.get(
    '/settings',
    handler(async (_req, res) => {
      res.setHeader('Cache-Control', cache(300));
      res.json({ data: await catalog.getSettingsPublic() });
    }),
  );

  router.get(
    '/legal/:key',
    handler(async (req, res) => {
      const { key } = legalParams.parse(req.params);
      res.setHeader('Cache-Control', cache(300));
      res.json({ data: await catalog.getLegalText(key) });
    }),
  );

  return router;
}
