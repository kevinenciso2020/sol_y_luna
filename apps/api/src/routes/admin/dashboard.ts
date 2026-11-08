import { Router, type Router as ExpressRouter } from 'express';
import { dashboardQuerySchema } from '@sol-y-luna/shared';
import { handler } from '../../lib/async.js';
import type { Db } from '../../lib/prisma.js';

const PAID_STATUSES = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'REFUNDED'] as const;

/** Admin summary for the last N days (by payment date). Amounts already net of refunds. */
export function adminDashboardRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (req, res) => {
      const { days } = dashboardQuerySchema.parse(req.query);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const paidWhere = { paidAt: { gte: since }, status: { in: [...PAID_STATUSES] } };
      const settings = await db.storeSettings.findUnique({ where: { id: 1 } });
      const threshold = settings?.lowStockThreshold ?? 5;

      const [sums, orders, top, lowStock, toDispatch, needsReview] = await Promise.all([
        db.order.aggregate({
          where: paidWhere,
          _sum: {
            total: true,
            refundedAmount: true,
            commissionAmount: true,
            commissionRefunded: true,
          },
        }),
        db.order.count({
          where: { ...paidWhere, status: { in: ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'] } },
        }),
        db.orderItem.groupBy({
          by: ['productId', 'productName'],
          where: { order: paidWhere },
          _sum: { quantity: true, lineTotal: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 5,
        }),
        db.$queryRaw<
          { id: string; productName: string; name: string; sku: string; available: number }[]
        >`
          SELECT v."id", p."name" AS "productName", v."name", v."sku",
                 (v."stock" - v."reservedStock")::int AS "available"
          FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId"
          WHERE v."isActive" AND p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
            AND v."stock" - v."reservedStock" <= ${threshold}
          ORDER BY "available" ASC, p."name" ASC
          LIMIT 10`,
        db.order.count({ where: { status: { in: ['PAID', 'PREPARING'] } } }),
        db.order.count({ where: { needsReview: true } }),
      ]);

      const sales = (sums._sum.total ?? 0) - (sums._sum.refundedAmount ?? 0);
      res.json({
        data: {
          days,
          sales,
          orders,
          averageTicket: orders > 0 ? Math.round(sales / orders) : 0,
          commission: (sums._sum.commissionAmount ?? 0) - (sums._sum.commissionRefunded ?? 0),
          topProducts: top.map((t) => ({
            productId: t.productId,
            name: t.productName,
            quantity: t._sum.quantity ?? 0,
            revenue: t._sum.lineTotal ?? 0,
          })),
          lowStock,
          lowStockThreshold: threshold,
          toDispatch,
          needsReview,
        },
      });
    }),
  );

  return router;
}
