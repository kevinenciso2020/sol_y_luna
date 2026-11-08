import { Router, type Router as ExpressRouter } from 'express';
import { adminReviewQuerySchema, reviewModerationSchema } from '@sol-y-luna/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { handler } from '../../lib/async.js';
import { HttpError } from '../../lib/http-error.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit } from '../../services/audit.js';
import { idParams } from './params.js';

const include = {
  user: { select: { name: true, email: true } },
  product: { select: { name: true, slug: true } },
} satisfies Prisma.ReviewInclude;
type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof include }>;

const toDto = (r: ReviewRow) => ({
  id: r.id,
  rating: r.rating,
  title: r.title,
  comment: r.comment,
  status: r.status,
  verified: r.orderId !== null,
  authorName: r.user.name,
  authorEmail: r.user.email,
  productName: r.product.name,
  productSlug: r.product.slug,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  moderatedAt: r.moderatedAt,
});

/** Review moderation (ADMIN). Only APPROVED reviews are ever shown in the store. */
export function adminReviewsRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (req, res) => {
      const query = adminReviewQuerySchema.parse(req.query);
      const where: Prisma.ReviewWhereInput = query.status === 'ALL' ? {} : { status: query.status };
      const [total, reviews] = await Promise.all([
        db.review.count({ where }),
        db.review.findMany({
          where,
          include,
          orderBy: { updatedAt: query.status === 'PENDING' ? 'asc' : 'desc' },
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      res.json({ data: reviews.map(toDto), meta: pageMeta(query.page, query.pageSize, total) });
    }),
  );

  router.post(
    '/:id/moderate',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const { status } = reviewModerationSchema.parse(req.body);
      const actor = actorFrom(req);
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.review.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Reseña no encontrada', 'NOT_FOUND');
        const review = await tx.review.update({
          where: { id },
          data: { status, moderatedById: actor.userId, moderatedAt: new Date() },
          include,
        });
        await audit(tx, actor, {
          action: 'review.moderate',
          entity: 'Review',
          entityId: id,
          diff: { status: { from: existing.status, to: status } },
        });
        return review;
      });
      res.json({ data: toDto(updated) });
    }),
  );

  router.delete(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await db.$transaction(async (tx) => {
        const existing = await tx.review.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Reseña no encontrada', 'NOT_FOUND');
        await tx.review.delete({ where: { id } });
        await audit(tx, actorFrom(req), {
          action: 'review.delete',
          entity: 'Review',
          entityId: id,
          diff: { rating: existing.rating, productId: existing.productId },
        });
      });
      res.status(204).end();
    }),
  );

  return router;
}
