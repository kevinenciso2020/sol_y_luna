import {
  OPERATOR_TARGET_STATUSES,
  OPERATOR_VISIBLE_STATUSES,
  ORDER_STATUS_LABELS,
  STOCK_REASON_LABELS,
  canTransitionOrder,
  formatCOP,
  formatOrderNumber,
  type AdminOrderQuery,
  type OrderStatus,
  type RefundInput,
  type ShipmentInput,
  type StockAdjustmentInput,
} from '@sol-y-luna/shared';
import type { z } from 'zod';
import type { inventoryQuerySchema } from '@sol-y-luna/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http-error.js';
import type { Logger } from '../lib/logger.js';
import { pageMeta, toSkipTake } from '../lib/pagination.js';
import type { Db } from '../lib/prisma.js';
import { audit, type AuditActor } from './audit.js';
import type { EmailSender } from './email.js';
import { orderShippedTemplate } from './email-templates.js';
import { orderInclude, releaseOrderReservations, toOrderDto } from './orders.service.js';
import { refundCommissionReversal } from './settlements.js';

type Tx = Prisma.TransactionClient;
/** Who is looking: the operator only sees paid orders and never commission data. */
export type BackofficeScope = 'ADMIN' | 'OPERATOR';

const PAID_STATUSES = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'] as const;
/** Targets the admin can set by hand; PAID, REFUNDED and the payment states come from events. */
const ADMIN_TARGET_STATUSES: readonly OrderStatus[] = [...OPERATOR_TARGET_STATUSES, 'CANCELLED'];

const detailInclude = {
  ...orderInclude,
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { name: true, role: true } } },
  },
  refunds: {
    orderBy: { createdAt: 'asc' },
    include: { createdBy: { select: { name: true } } },
  },
} satisfies Prisma.OrderInclude;
type DetailOrder = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

const parseNumber = (number: string) => Number.parseInt(number.slice(4), 10);

function toDetailDto(order: DetailOrder, scope: BackofficeScope) {
  const base = toOrderDto(order);
  const dto = {
    ...base,
    refundedAmount: order.refundedAmount,
    notes: order.notes,
    reviewReason: order.reviewReason,
    history: order.statusHistory.map((h) => ({
      status: h.toStatus,
      at: h.createdAt,
      note: h.note,
      by: h.changedBy?.name ?? null,
    })),
  };
  if (scope === 'OPERATOR') return dto;
  const commissionAmount = order.commissionAmount ?? 0;
  const current = commissionAmount - order.commissionRefunded;
  return {
    ...dto,
    settlementId: order.settlementId,
    commission: {
      ruleId: order.commissionRuleId,
      rateBps: order.commissionRateBps,
      fixed: order.commissionFixed,
      amount: commissionAmount,
      refunded: order.commissionRefunded,
      current,
      gatewayFee: order.gatewayFeeAmount,
      merchantNet: order.total - order.refundedAmount - current - (order.gatewayFeeAmount ?? 0),
    },
    refunds: order.refunds.map((r) => ({
      id: r.id,
      amount: r.amount,
      commissionReversed: r.commissionReversed,
      restocked: r.restocked,
      reason: r.reason,
      by: r.createdBy?.name ?? null,
      createdAt: r.createdAt,
    })),
  };
}

export interface BackofficeDeps {
  db: Db;
  email: EmailSender;
  logger: Logger;
}

export function createBackofficeService(deps: BackofficeDeps) {
  const { db, email, logger } = deps;

  const visibleWhere = (scope: BackofficeScope): Prisma.OrderWhereInput =>
    scope === 'OPERATOR' ? { status: { in: [...OPERATOR_VISIBLE_STATUSES] } } : {};

  async function findOrder(tx: Tx | Db, number: string, scope: BackofficeScope) {
    const order = await tx.order.findFirst({
      where: { number: parseNumber(number), ...visibleWhere(scope) },
      include: detailInclude,
    });
    if (!order) throw new HttpError(404, 'Pedido no encontrado', 'NOT_FOUND');
    return order;
  }

  /** Conditional status change: fails if someone else moved the order first. */
  async function moveStatus(
    tx: Tx,
    order: { id: string; status: OrderStatus },
    to: OrderStatus,
    note: string | null,
    actor: AuditActor,
  ) {
    const moved = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: to },
    });
    if (moved.count !== 1)
      throw new HttpError(
        409,
        'El pedido cambió mientras lo editabas. Recarga e intenta de nuevo',
        'CONFLICT',
      );
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: to,
        note,
        changedById: actor.userId,
      },
    });
    await audit(tx, actor, {
      action: 'order.status.change',
      entity: 'Order',
      entityId: order.id,
      diff: { status: { from: order.status, to }, note },
    });
  }

  function assertTransition(from: OrderStatus, to: OrderStatus) {
    if (!canTransitionOrder(from, to))
      throw new HttpError(
        409,
        `El pedido no puede pasar de "${ORDER_STATUS_LABELS[from]}" a "${ORDER_STATUS_LABELS[to]}"`,
        'INVALID_TRANSITION',
      );
  }

  async function sendSafely(message: Parameters<EmailSender['send']>[0]) {
    try {
      await email.send(message);
    } catch (error) {
      logger.error({ err: error, subject: message.subject }, 'no se pudo enviar el email');
    }
  }

  return {
    async listOrders(query: AdminOrderQuery, scope: BackofficeScope) {
      const and: Prisma.OrderWhereInput[] = [visibleWhere(scope)];
      if (query.status === 'TO_DISPATCH') and.push({ status: { in: ['PAID', 'PREPARING'] } });
      else if (query.status !== 'ALL') and.push({ status: query.status });
      if (query.review && scope === 'ADMIN') and.push({ needsReview: true });
      if (query.q) {
        const digits = query.q.replace(/^SYL-?/i, '');
        and.push({
          OR: [
            ...(/^\d{1,9}$/.test(digits) ? [{ number: Number(digits) }] : []),
            { customerName: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
            { phone: { contains: query.q } },
            { shipment: { trackingNumber: { contains: query.q, mode: 'insensitive' } } },
          ],
        });
      }
      const where: Prisma.OrderWhereInput = { AND: and };
      const [total, orders] = await Promise.all([
        db.order.count({ where }),
        db.order.findMany({
          where,
          include: {
            shipment: { select: { carrier: true, trackingNumber: true } },
            _count: { select: { items: true } },
          },
          // Oldest paid first is the natural dispatch queue; otherwise newest first.
          orderBy: query.status === 'TO_DISPATCH' ? { paidAt: 'asc' } : { createdAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      return {
        data: orders.map((o) => ({
          id: o.id,
          number: formatOrderNumber(o.number),
          status: o.status,
          createdAt: o.createdAt,
          paidAt: o.paidAt,
          customerName: o.customerName,
          municipality: o.shipMunicipalityName,
          department: o.shipDepartmentName,
          total: o.total,
          itemCount: o._count.items,
          discreetPackaging: o.discreetPackaging,
          needsReview: o.needsReview,
          shipment: o.shipment,
        })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async getOrder(number: string, scope: BackofficeScope) {
      return toDetailDto(await findOrder(db, number, scope), scope);
    },

    async changeStatus(
      number: string,
      input: { status: OrderStatus; note?: string | null | undefined },
      actor: AuditActor,
      scope: BackofficeScope,
    ) {
      const allowed: readonly OrderStatus[] =
        scope === 'OPERATOR' ? OPERATOR_TARGET_STATUSES : ADMIN_TARGET_STATUSES;
      if (!allowed.includes(input.status)) {
        if (scope === 'OPERATOR')
          throw new HttpError(
            403,
            'No tienes permiso para pasar un pedido a ese estado',
            'FORBIDDEN',
          );
        throw new HttpError(
          400,
          input.status === 'REFUNDED'
            ? 'Para reembolsar un pedido registra el reembolso'
            : 'Ese estado lo fijan los pagos automáticamente',
          'STATUS_NOT_ALLOWED',
        );
      }
      const note = input.note ?? null;
      await db.$transaction(async (tx) => {
        const order = await findOrder(tx, number, scope);
        assertTransition(order.status, input.status);
        if (
          input.status === 'CANCELLED' &&
          (PAID_STATUSES as readonly string[]).includes(order.status)
        )
          throw new HttpError(
            409,
            'Este pedido ya está pago: para cancelarlo registra un reembolso total',
            'REFUND_REQUIRED',
          );
        if (input.status === 'SHIPPED' && !order.shipment)
          throw new HttpError(
            409,
            'Registra la transportadora y el número de guía para despachar',
            'SHIPMENT_REQUIRED',
          );
        await moveStatus(tx, order, input.status, note, actor);
        if (input.status === 'DELIVERED' && order.shipment) {
          await tx.shipment.update({
            where: { orderId: order.id },
            data: { deliveredAt: new Date() },
          });
        }
        if (input.status === 'CANCELLED') {
          if (order.status === 'PENDING_PAYMENT')
            await releaseOrderReservations(tx, order.id, order.number, 'cancelado por el admin');
          await tx.order.update({
            where: { id: order.id },
            data: { cancelledAt: new Date(), reservationExpiresAt: null },
          });
          await tx.payment.updateMany({
            where: { orderId: order.id, status: 'PENDING' },
            data: { status: 'VOIDED' },
          });
        }
      });
      return this.getOrder(number, scope);
    },

    /** Records carrier and tracking number. From PREPARING it also dispatches (SHIPPED + email). */
    async saveShipment(
      number: string,
      input: ShipmentInput,
      actor: AuditActor,
      scope: BackofficeScope,
    ) {
      const data = {
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl ?? null,
      };
      const dispatched = await db.$transaction(async (tx) => {
        const order = await findOrder(tx, number, scope);
        if (!['PREPARING', 'SHIPPED', 'DELIVERED'].includes(order.status))
          throw new HttpError(
            409,
            'Primero marca el pedido como "Preparando" para poder despacharlo',
            'INVALID_TRANSITION',
          );
        const dispatching = order.status === 'PREPARING';
        await tx.shipment.upsert({
          where: { orderId: order.id },
          create: { orderId: order.id, ...data, shippedAt: new Date() },
          update: { ...data, ...(dispatching ? { shippedAt: new Date() } : {}) },
        });
        await audit(tx, actor, {
          action: 'order.shipment.update',
          entity: 'Order',
          entityId: order.id,
          diff: {
            from: order.shipment
              ? { carrier: order.shipment.carrier, trackingNumber: order.shipment.trackingNumber }
              : null,
            to: data,
          },
        });
        if (dispatching)
          await moveStatus(
            tx,
            order,
            'SHIPPED',
            `Despachado con ${data.carrier}, guía ${data.trackingNumber}`,
            actor,
          );
        return dispatching;
      });
      const result = await findOrder(db, number, scope);
      if (dispatched) {
        await sendSafely({
          to: result.email,
          ...orderShippedTemplate({ order: toOrderDto(result), shipment: data }),
        });
      }
      return toDetailDto(result, scope);
    },

    /**
     * Records a refund made in the gateway's panel. The commission is reversed cumulatively;
     * a full refund moves the order to REFUNDED and can return the units to stock.
     */
    async refund(number: string, input: RefundInput, actor: AuditActor) {
      await db.$transaction(async (tx) => {
        const order = await findOrder(tx, number, 'ADMIN');
        if (!(PAID_STATUSES as readonly string[]).includes(order.status))
          throw new HttpError(409, 'Solo se pueden reembolsar pedidos pagados', 'NOT_PAID');
        const remaining = order.total - order.refundedAmount;
        if (input.amount > remaining)
          throw new HttpError(400, 'Revisa el monto', 'VALIDATION_ERROR', [
            { path: ['amount'], message: `El máximo por reembolsar es ${formatCOP(remaining)}` },
          ]);
        const full = input.amount === remaining;
        if (input.restock && !full)
          throw new HttpError(400, 'Revisa el reembolso', 'VALIDATION_ERROR', [
            {
              path: ['restock'],
              message:
                'Solo el reembolso total devuelve todo al inventario; para una parte usa el ajuste de stock',
            },
          ]);
        const reversed = refundCommissionReversal(
          { total: order.total, commissionAmount: order.commissionAmount ?? 0 },
          {
            refundedBefore: order.refundedAmount,
            commissionRefunded: order.commissionRefunded,
            amount: input.amount,
          },
        );
        const updated = await tx.order.updateMany({
          where: { id: order.id, refundedAmount: order.refundedAmount },
          data: {
            refundedAmount: { increment: input.amount },
            commissionRefunded: { increment: reversed },
          },
        });
        if (updated.count !== 1)
          throw new HttpError(409, 'El pedido cambió mientras lo editabas. Recarga', 'CONFLICT');
        const refund = await tx.orderRefund.create({
          data: {
            orderId: order.id,
            amount: input.amount,
            commissionReversed: reversed,
            restocked: input.restock,
            reason: input.reason,
            createdById: actor.userId,
          },
        });
        if (full) {
          assertTransition(order.status, 'REFUNDED');
          await moveStatus(tx, order, 'REFUNDED', `Reembolso total: ${input.reason}`, actor);
        }
        if (input.restock) {
          for (const item of order.items) {
            if (!item.variantId) continue;
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
            await tx.inventoryMovement.create({
              data: {
                variantId: item.variantId,
                delta: item.quantity,
                reason: 'RETURN',
                reference: `${formatOrderNumber(order.number)}: reembolso`,
                orderId: order.id,
                createdById: actor.userId,
              },
            });
          }
        }
        await audit(tx, actor, {
          action: 'order.refund',
          entity: 'Order',
          entityId: order.id,
          diff: {
            refundId: refund.id,
            amount: input.amount,
            commissionReversed: reversed,
            restocked: input.restock,
            reason: input.reason,
          },
        });
      });
      return this.getOrder(number, 'ADMIN');
    },

    async listInventory(query: z.infer<typeof inventoryQuerySchema>) {
      const settings = await db.storeSettings.findUnique({ where: { id: 1 } });
      const threshold = settings?.lowStockThreshold ?? 5;
      const and: Prisma.ProductVariantWhereInput[] = [{ product: { deletedAt: null } }];
      if (query.q) {
        and.push({
          OR: [
            { sku: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
            { product: { name: { contains: query.q, mode: 'insensitive' } } },
            { product: { slug: { contains: query.q, mode: 'insensitive' } } },
          ],
        });
      }
      if (query.low) {
        const low = await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "ProductVariant"
          WHERE "isActive" AND "stock" - "reservedStock" <= ${threshold}`;
        and.push({ id: { in: low.map((r) => r.id) } });
      }
      const where: Prisma.ProductVariantWhereInput = { AND: and };
      const [total, variants] = await Promise.all([
        db.productVariant.count({ where }),
        db.productVariant.findMany({
          where,
          include: { product: { select: { name: true, slug: true } } },
          orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      return {
        data: variants.map((v) => ({
          id: v.id,
          productName: v.product.name,
          productSlug: v.product.slug,
          name: v.name,
          sku: v.sku,
          stock: v.stock,
          reservedStock: v.reservedStock,
          available: v.stock - v.reservedStock,
          isActive: v.isActive,
          low: v.stock - v.reservedStock <= threshold,
        })),
        meta: { ...pageMeta(query.page, query.pageSize, total), lowStockThreshold: threshold },
      };
    },

    /** Atomic adjustment: stock never goes below what pending orders have reserved. */
    async adjustStock(variantId: string, input: StockAdjustmentInput, actor: AuditActor) {
      return db.$transaction(async (tx) => {
        const before = await tx.productVariant.findUnique({ where: { id: variantId } });
        if (!before) throw new HttpError(404, 'Presentación no encontrada', 'NOT_FOUND');
        const updated = await tx.$executeRaw`
          UPDATE "ProductVariant"
          SET "stock" = "stock" + ${input.delta}, "updatedAt" = NOW()
          WHERE "id" = ${variantId} AND "stock" + ${input.delta} >= GREATEST("reservedStock", 0)`;
        if (updated !== 1) {
          const current = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
          throw new HttpError(
            409,
            current.reservedStock > 0
              ? `El stock no puede quedar por debajo de las ${current.reservedStock} unidades reservadas en pedidos pendientes`
              : 'El stock no puede quedar negativo',
            'STOCK_BELOW_RESERVED',
          );
        }
        const after = await tx.productVariant.findUniqueOrThrow({
          where: { id: variantId },
          include: { product: { select: { name: true, slug: true } } },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId,
            delta: input.delta,
            reason: input.reason,
            reference: input.note ?? STOCK_REASON_LABELS[input.reason] ?? null,
            createdById: actor.userId,
          },
        });
        await audit(tx, actor, {
          action: 'variant.stock.adjust',
          entity: 'ProductVariant',
          entityId: variantId,
          diff: {
            stock: { from: after.stock - input.delta, to: after.stock },
            reason: input.reason,
            note: input.note ?? null,
          },
        });
        return {
          id: after.id,
          productName: after.product.name,
          productSlug: after.product.slug,
          name: after.name,
          sku: after.sku,
          stock: after.stock,
          reservedStock: after.reservedStock,
          available: after.stock - after.reservedStock,
          isActive: after.isActive,
        };
      });
    },
  };
}

export type BackofficeService = ReturnType<typeof createBackofficeService>;
