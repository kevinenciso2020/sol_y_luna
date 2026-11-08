import { Router, type Router as ExpressRouter, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  accountOrdersQuerySchema,
  orderNumberParamsSchema,
  productIdSchema,
  profileUpdateSchema,
  reviewInputSchema,
  wholesaleRequestSchema,
} from '@sol-y-luna/shared';
import { handler } from '../lib/async.js';
import type { AccountService } from '../services/account.service.js';

const idParams = z.object({
  id: z.string().regex(/^[a-z0-9]{20,40}$/, { error: 'Identificador inválido' }),
});

/**
 * "Mi cuenta" for any signed-in user (mounted behind `authenticated`). Every call uses the
 * session's userId; nothing here accepts a user id from the client.
 */
export function accountRouter(deps: {
  account: AccountService;
  reviewsLimiter: RequestHandler;
}): ExpressRouter {
  const { account, reviewsLimiter } = deps;
  const router = Router();
  const userId = (req: { auth?: { userId: string } }) => req.auth!.userId;

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });

  // ─── Profile ───
  router.get(
    '/profile',
    handler(async (req, res) => {
      res.json({ data: await account.profile(userId(req)) });
    }),
  );
  router.put(
    '/profile',
    handler(async (req, res) => {
      const input = profileUpdateSchema.parse(req.body);
      res.json({ data: await account.updateProfile(userId(req), input) });
    }),
  );

  // ─── Orders ───
  router.get(
    '/orders',
    handler(async (req, res) => {
      const { page, pageSize } = accountOrdersQuerySchema.parse(req.query);
      res.json(await account.listOrders(userId(req), page, pageSize));
    }),
  );
  router.get(
    '/orders/:number',
    handler(async (req, res) => {
      const { number } = orderNumberParamsSchema.parse(req.params);
      res.json({ data: await account.getOrder(userId(req), number) });
    }),
  );

  // ─── Wishlist ───
  router.get(
    '/wishlist',
    handler(async (req, res) => {
      res.json({ data: await account.wishlist(userId(req)) });
    }),
  );
  router.get(
    '/wishlist/ids',
    handler(async (req, res) => {
      res.json({ data: await account.wishlistIds(userId(req)) });
    }),
  );
  router.post(
    '/wishlist',
    handler(async (req, res) => {
      const { productId } = productIdSchema.parse(req.body);
      await account.addToWishlist(userId(req), productId);
      res.status(201).json({ data: { productId } });
    }),
  );
  router.delete(
    '/wishlist/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await account.removeFromWishlist(userId(req), id);
      res.status(204).end();
    }),
  );

  // ─── Reviews ───
  router.get(
    '/reviews',
    handler(async (req, res) => {
      res.json({ data: await account.myReviews(userId(req)) });
    }),
  );
  router.post(
    '/reviews',
    reviewsLimiter,
    handler(async (req, res) => {
      const input = reviewInputSchema.parse(req.body);
      res.status(201).json({ data: await account.saveReview(userId(req), input) });
    }),
  );
  router.delete(
    '/reviews/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await account.deleteReview(userId(req), id);
      res.status(204).end();
    }),
  );

  // ─── Wholesale ───
  router.post(
    '/wholesale',
    handler(async (req, res) => {
      const input = wholesaleRequestSchema.parse(req.body);
      res.json({ data: await account.requestWholesale(userId(req), input) });
    }),
  );

  return router;
}
