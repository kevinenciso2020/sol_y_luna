import { Router, type Router as ExpressRouter } from 'express';
import { commissionRuleInputSchema, type CommissionRuleInput } from '@sol-y-luna/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { handler } from '../../lib/async.js';
import { HttpError } from '../../lib/http-error.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit, diffFields } from '../../services/audit.js';
import { idParams } from './params.js';

type Tx = Prisma.TransactionClient;

const FIELDS = [
  'scope',
  'categoryId',
  'productId',
  'priceTier',
  'rateBps',
  'fixedAmount',
  'validFrom',
  'validTo',
  'isActive',
] as const;

const include = {
  category: { select: { name: true } },
  product: { select: { name: true } },
} satisfies Prisma.CommissionRuleInclude;

type RuleWithRefs = Prisma.CommissionRuleGetPayload<{ include: typeof include }>;

const toDto = (r: RuleWithRefs) => ({
  id: r.id,
  scope: r.scope,
  categoryId: r.categoryId,
  categoryName: r.category?.name ?? null,
  productId: r.productId,
  productName: r.product?.name ?? null,
  priceTier: r.priceTier,
  rateBps: r.rateBps,
  fixedAmount: r.fixedAmount,
  validFrom: r.validFrom,
  validTo: r.validTo,
  isActive: r.isActive,
  createdAt: r.createdAt,
});

/**
 * Platform commission rules (ADMIN only; the operator never reaches this router). Changing a rule
 * never alters orders already paid: each order keeps the commission frozen at payment time.
 */
export function adminCommissionRulesRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();

  const toData = (input: CommissionRuleInput) => ({
    scope: input.scope,
    categoryId: input.scope === 'CATEGORY' ? (input.categoryId ?? null) : null,
    productId: input.scope === 'PRODUCT' ? (input.productId ?? null) : null,
    priceTier: input.priceTier,
    rateBps: input.rateBps,
    fixedAmount: input.scope === 'GLOBAL' ? input.fixedAmount : 0,
    validFrom: input.validFrom ?? new Date(),
    validTo: input.validTo ?? null,
    isActive: input.isActive,
  });

  async function assertReferences(tx: Tx, data: ReturnType<typeof toData>) {
    if (data.categoryId && !(await tx.category.findUnique({ where: { id: data.categoryId } })))
      throw new HttpError(400, 'Revisa la regla', 'VALIDATION_ERROR', [
        { path: ['categoryId'], message: 'La categoría no existe' },
      ]);
    if (
      data.productId &&
      !(await tx.product.findFirst({ where: { id: data.productId, deletedAt: null } }))
    )
      throw new HttpError(400, 'Revisa la regla', 'VALIDATION_ERROR', [
        { path: ['productId'], message: 'El producto no existe' },
      ]);
  }

  /** Every order needs a fallback: at least one active GLOBAL rule must remain. */
  async function assertGlobalRemains(tx: Tx) {
    const globals = await tx.commissionRule.count({ where: { scope: 'GLOBAL', isActive: true } });
    if (globals === 0)
      throw new HttpError(400, 'Debe quedar al menos una regla global activa', 'LAST_GLOBAL_RULE');
  }

  router.get(
    '/',
    handler(async (_req, res) => {
      const rules = await db.commissionRule.findMany({
        include,
        orderBy: [{ isActive: 'desc' }, { scope: 'asc' }, { createdAt: 'desc' }],
      });
      res.json({ data: rules.map(toDto) });
    }),
  );

  router.post(
    '/',
    handler(async (req, res) => {
      const data = toData(commissionRuleInputSchema.parse(req.body));
      const created = await db.$transaction(async (tx) => {
        await assertReferences(tx, data);
        const rule = await tx.commissionRule.create({
          data: { ...data, createdById: req.auth!.userId },
          include,
        });
        await assertGlobalRemains(tx);
        await audit(tx, actorFrom(req), {
          action: 'commission.create',
          entity: 'CommissionRule',
          entityId: rule.id,
          diff: data,
        });
        return rule;
      });
      res.status(201).json({ data: toDto(created) });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const data = toData(commissionRuleInputSchema.parse(req.body));
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.commissionRule.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Regla no encontrada', 'NOT_FOUND');
        await assertReferences(tx, data);
        const rule = await tx.commissionRule.update({ where: { id }, data, include });
        await assertGlobalRemains(tx);
        const diff = diffFields(existing as unknown as Record<string, unknown>, data, FIELDS);
        if (diff)
          await audit(tx, actorFrom(req), {
            action: 'commission.update',
            entity: 'CommissionRule',
            entityId: id,
            diff,
          });
        return rule;
      });
      res.json({ data: toDto(updated) });
    }),
  );

  router.delete(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await db.$transaction(async (tx) => {
        const existing = await tx.commissionRule.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Regla no encontrada', 'NOT_FOUND');
        // Paid orders keep their frozen commission (commissionRuleId is set to null).
        await tx.commissionRule.delete({ where: { id } });
        await assertGlobalRemains(tx);
        await audit(tx, actorFrom(req), {
          action: 'commission.delete',
          entity: 'CommissionRule',
          entityId: id,
          diff: { scope: existing.scope, rateBps: existing.rateBps },
        });
      });
      res.status(204).end();
    }),
  );

  return router;
}
