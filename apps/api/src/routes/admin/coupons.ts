import { Router, type Router as ExpressRouter } from 'express';
import { couponInputSchema } from '@sol-y-luna/shared';
import { handler } from '../../lib/async.js';
import { HttpError } from '../../lib/http-error.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit, diffFields } from '../../services/audit.js';
import { idParams } from './params.js';

const FIELDS = [
  'code',
  'description',
  'type',
  'value',
  'minSubtotal',
  'maxUses',
  'maxUsesPerUser',
  'startsAt',
  'endsAt',
  'isActive',
  'appliesToWholesale',
] as const;

export function adminCouponsRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();
  const toData = (input: ReturnType<typeof couponInputSchema.parse>) => ({
    code: input.code,
    description: input.description ?? null,
    type: input.type,
    value: input.value,
    minSubtotal: input.minSubtotal,
    maxUses: input.maxUses ?? null,
    maxUsesPerUser: input.maxUsesPerUser ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    isActive: input.isActive,
    appliesToWholesale: input.appliesToWholesale,
  });

  router.get(
    '/',
    handler(async (_req, res) => {
      res.json({
        data: await db.coupon.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] }),
      });
    }),
  );

  router.post(
    '/',
    handler(async (req, res) => {
      const input = couponInputSchema.parse(req.body);
      const created = await db.$transaction(async (tx) => {
        const coupon = await tx.coupon.create({ data: toData(input) });
        await audit(tx, actorFrom(req), {
          action: 'coupon.create',
          entity: 'Coupon',
          entityId: coupon.id,
          diff: toData(input),
        });
        return coupon;
      });
      res.status(201).json({ data: created });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const input = couponInputSchema.parse(req.body);
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.coupon.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Cupón no encontrado', 'NOT_FOUND');
        const data = toData(input);
        const coupon = await tx.coupon.update({ where: { id }, data });
        const diff = diffFields(existing as unknown as Record<string, unknown>, data, FIELDS);
        if (diff)
          await audit(tx, actorFrom(req), {
            action: 'coupon.update',
            entity: 'Coupon',
            entityId: id,
            diff,
          });
        return coupon;
      });
      res.json({ data: updated });
    }),
  );

  /** Orders keep the coupon code as a snapshot, so deleting a used coupon does not alter history. */
  router.delete(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await db.$transaction(async (tx) => {
        const existing = await tx.coupon.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Cupón no encontrado', 'NOT_FOUND');
        await tx.coupon.delete({ where: { id } });
        await audit(tx, actorFrom(req), {
          action: 'coupon.delete',
          entity: 'Coupon',
          entityId: id,
          diff: { code: existing.code },
        });
      });
      res.status(204).end();
    }),
  );

  return router;
}
