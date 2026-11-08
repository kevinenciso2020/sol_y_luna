import { Router, type Router as ExpressRouter } from 'express';
import { brandInputSchema } from '@sol-y-luna/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { handler } from '../../lib/async.js';
import { HttpError } from '../../lib/http-error.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit, diffFields } from '../../services/audit.js';
import { idParams } from './params.js';

const FIELDS = ['name', 'slug', 'logo', 'description', 'theme', 'isActive', 'sortOrder'] as const;

export function adminBrandsRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();
  const toData = (input: ReturnType<typeof brandInputSchema.parse>) => ({
    name: input.name,
    slug: input.slug,
    logo: input.logo ?? null,
    description: input.description ?? null,
    theme: (input.theme ?? undefined) as Prisma.InputJsonValue | undefined,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  });

  router.get(
    '/',
    handler(async (_req, res) => {
      const brands = await db.brand.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: { where: { deletedAt: null } } } } },
      });
      res.json({
        data: brands.map(({ _count, ...b }) => ({ ...b, productCount: _count.products })),
      });
    }),
  );

  router.post(
    '/',
    handler(async (req, res) => {
      const input = brandInputSchema.parse(req.body);
      const created = await db.$transaction(async (tx) => {
        const brand = await tx.brand.create({ data: toData(input) });
        await audit(tx, actorFrom(req), {
          action: 'brand.create',
          entity: 'Brand',
          entityId: brand.id,
          diff: { name: brand.name },
        });
        return brand;
      });
      res.status(201).json({ data: created });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const input = brandInputSchema.parse(req.body);
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.brand.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Marca no encontrada', 'NOT_FOUND');
        const data = toData(input);
        const brand = await tx.brand.update({
          where: { id },
          data: { ...data, theme: data.theme ?? undefined },
        });
        const diff = diffFields(
          existing as unknown as Record<string, unknown>,
          { ...data, theme: input.theme ?? null },
          FIELDS,
        );
        if (diff)
          await audit(tx, actorFrom(req), {
            action: 'brand.update',
            entity: 'Brand',
            entityId: id,
            diff,
          });
        return brand;
      });
      res.json({ data: updated });
    }),
  );

  /** Products of a deleted brand stay, without brand. */
  router.delete(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await db.$transaction(async (tx) => {
        const existing = await tx.brand.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Marca no encontrada', 'NOT_FOUND');
        await tx.brand.delete({ where: { id } });
        await audit(tx, actorFrom(req), {
          action: 'brand.delete',
          entity: 'Brand',
          entityId: id,
          diff: { name: existing.name },
        });
      });
      res.status(204).end();
    }),
  );

  return router;
}
