import { Router, type Router as ExpressRouter } from 'express';
import { categoryInputSchema } from '@sol-y-luna/shared';
import { handler } from '../../lib/async.js';
import { HttpError } from '../../lib/http-error.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit, diffFields } from '../../services/audit.js';
import { idParams } from './params.js';

const FIELDS = [
  'name',
  'slug',
  'description',
  'image',
  'parentId',
  'sortOrder',
  'isActive',
  'isAdult',
] as const;

export function adminCategoriesRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();

  /** Rejects a parent that is the category itself or one of its descendants (no cycles). */
  async function assertParent(id: string | null, parentId: string | null | undefined) {
    if (!parentId) return;
    const all = await db.category.findMany({ select: { id: true, parentId: true } });
    if (!all.some((c) => c.id === parentId)) {
      throw new HttpError(400, 'La categoría padre no existe', 'INVALID_REFERENCE', [
        { path: ['parentId'], message: 'La categoría padre no existe' },
      ]);
    }
    let cursor: string | null | undefined = parentId;
    while (cursor) {
      if (cursor === id) {
        throw new HttpError(
          400,
          'Una categoría no puede quedar dentro de sí misma',
          'INVALID_PARENT',
          [{ path: ['parentId'], message: 'Una categoría no puede quedar dentro de sí misma' }],
        );
      }
      cursor = all.find((c) => c.id === cursor)?.parentId;
    }
  }

  router.get(
    '/',
    handler(async (_req, res) => {
      const categories = await db.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          parent: { select: { name: true } },
          _count: { select: { products: { where: { deletedAt: null } } } },
        },
      });
      const uncategorized = await db.product.count({
        where: { categoryId: null, deletedAt: null },
      });
      res.json({
        data: categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products })),
        meta: { uncategorizedProducts: uncategorized },
      });
    }),
  );

  router.post(
    '/',
    handler(async (req, res) => {
      const input = categoryInputSchema.parse(req.body);
      await assertParent(null, input.parentId);
      const created = await db.$transaction(async (tx) => {
        const category = await tx.category.create({
          data: {
            ...input,
            description: input.description ?? null,
            image: input.image ?? null,
            parentId: input.parentId ?? null,
          },
        });
        await audit(tx, actorFrom(req), {
          action: 'category.create',
          entity: 'Category',
          entityId: category.id,
          diff: input,
        });
        return category;
      });
      res.status(201).json({ data: created });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const input = categoryInputSchema.parse(req.body);
      await assertParent(id, input.parentId);
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.category.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Categoría no encontrada', 'NOT_FOUND');
        const data = {
          ...input,
          description: input.description ?? null,
          image: input.image ?? null,
          parentId: input.parentId ?? null,
        };
        const category = await tx.category.update({ where: { id }, data });
        const diff = diffFields(existing as unknown as Record<string, unknown>, data, FIELDS);
        if (diff)
          await audit(tx, actorFrom(req), {
            action: 'category.update',
            entity: 'Category',
            entityId: id,
            diff,
          });
        return category;
      });
      res.json({ data: updated });
    }),
  );

  /** Products of a deleted category stay, uncategorized (FK ON DELETE SET NULL); sub-categories move to the top level. */
  router.delete(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await db.$transaction(async (tx) => {
        const existing = await tx.category.findUnique({
          where: { id },
          include: { _count: { select: { products: true, children: true } } },
        });
        if (!existing) throw new HttpError(404, 'Categoría no encontrada', 'NOT_FOUND');
        await tx.category.delete({ where: { id } });
        await audit(tx, actorFrom(req), {
          action: 'category.delete',
          entity: 'Category',
          entityId: id,
          diff: {
            name: existing.name,
            productsLeftUncategorized: existing._count.products,
            subcategoriesMovedUp: existing._count.children,
          },
        });
      });
      res.status(204).end();
    }),
  );

  return router;
}
