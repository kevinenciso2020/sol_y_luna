import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { handler } from '../lib/async.js';
import type { CloudinaryService } from '../services/cloudinary.js';

const signBody = z.object({
  kind: z.enum(['products', 'categories', 'brands', 'banners']).default('products'),
});
const verifyBody = z.object({ publicId: z.string().min(1).max(255) });

/** Signed Cloudinary uploads. Mounted for ADMIN and OPERATOR only. */
export function uploadsRouter(deps: { cloudinary: CloudinaryService }): ExpressRouter {
  const { cloudinary } = deps;
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({ enabled: cloudinary.enabled });
  });

  router.post(
    '/signature',
    handler(async (req, res) => {
      const { kind } = signBody.parse(req.body ?? {});
      res.json({ data: cloudinary.sign(kind) });
    }),
  );

  router.post(
    '/verify',
    handler(async (req, res) => {
      const { publicId } = verifyBody.parse(req.body);
      res.json({ data: await cloudinary.verify(publicId) });
    }),
  );

  return router;
}
