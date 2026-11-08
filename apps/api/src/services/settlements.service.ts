import {
  formatOrderNumber,
  previousSettlementPeriod,
  settlementPeriodFor,
  type SettlementPeriod,
} from '@sol-y-luna/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http-error.js';
import type { Db } from '../lib/prisma.js';
import { audit, type AuditActor } from './audit.js';
import { settlementCsv, settlementTotals } from './settlements.js';

type Tx = Prisma.TransactionClient;

/** Orders that count for a settlement: paid at some point (a later refund is its own row). */
const SETTLED_STATUSES = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'REFUNDED'] as const;

const settlementInclude = {
  orders: {
    orderBy: { paidAt: 'asc' },
    select: {
      id: true,
      number: true,
      paidAt: true,
      customerName: true,
      status: true,
      total: true,
      commissionAmount: true,
      gatewayFeeAmount: true,
    },
  },
  refunds: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      amount: true,
      commissionReversed: true,
      reason: true,
      createdAt: true,
      order: { select: { number: true, customerName: true } },
    },
  },
} satisfies Prisma.SettlementInclude;
type FullSettlement = Prisma.SettlementGetPayload<{ include: typeof settlementInclude }>;

const summary = (s: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  orderCount: number;
  grossSales: number;
  refundTotal: number;
  commissionTotal: number;
  gatewayFeeTotal: number;
  netTotal: number;
  notes: string | null;
  closedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}) => ({
  id: s.id,
  periodStart: s.periodStart,
  periodEnd: s.periodEnd,
  status: s.status,
  orderCount: s.orderCount,
  grossSales: s.grossSales,
  refundTotal: s.refundTotal,
  commissionTotal: s.commissionTotal,
  gatewayFeeTotal: s.gatewayFeeTotal,
  netTotal: s.netTotal,
  notes: s.notes,
  closedAt: s.closedAt,
  paidAt: s.paidAt,
  createdAt: s.createdAt,
});

function toDetailDto(s: FullSettlement) {
  return {
    ...summary(s),
    orders: s.orders.map((o) => ({
      number: formatOrderNumber(o.number),
      paidAt: o.paidAt,
      customerName: o.customerName,
      status: o.status,
      total: o.total,
      commissionAmount: o.commissionAmount ?? 0,
      gatewayFeeAmount: o.gatewayFeeAmount ?? 0,
      net: o.total - (o.commissionAmount ?? 0) - (o.gatewayFeeAmount ?? 0),
    })),
    refunds: s.refunds.map((r) => ({
      id: r.id,
      number: formatOrderNumber(r.order.number),
      customerName: r.order.customerName,
      createdAt: r.createdAt,
      amount: r.amount,
      commissionReversed: r.commissionReversed,
      reason: r.reason,
    })),
  };
}

export function createSettlementsService(deps: { db: Db }) {
  const { db } = deps;

  async function load(tx: Tx | Db, id: string) {
    const settlement = await tx.settlement.findUnique({
      where: { id },
      include: settlementInclude,
    });
    if (!settlement) throw new HttpError(404, 'Liquidación no encontrada', 'NOT_FOUND');
    return settlement;
  }

  /** Attaches the still-unsettled orders and refunds of the period and recomputes the totals. */
  async function attachAndTotal(tx: Tx, id: string, period: SettlementPeriod) {
    const range = { gte: period.start, lt: period.end };
    await tx.order.updateMany({
      where: { settlementId: null, paidAt: range, status: { in: [...SETTLED_STATUSES] } },
      data: { settlementId: id },
    });
    await tx.orderRefund.updateMany({
      where: { settlementId: null, createdAt: range },
      data: { settlementId: id },
    });
    const [orders, refunds] = await Promise.all([
      tx.order.findMany({
        where: { settlementId: id },
        select: { total: true, commissionAmount: true, gatewayFeeAmount: true },
      }),
      tx.orderRefund.findMany({
        where: { settlementId: id },
        select: { amount: true, commissionReversed: true },
      }),
    ]);
    const totals = settlementTotals(orders, refunds);
    await tx.settlement.update({ where: { id }, data: totals });
    return totals;
  }

  /** Conditional status change (OPEN → CLOSED → PAID). */
  async function move(
    tx: Tx,
    id: string,
    from: 'OPEN' | 'CLOSED',
    data: Prisma.SettlementUpdateManyMutationInput,
    message: string,
  ) {
    const moved = await tx.settlement.updateMany({ where: { id, status: from }, data });
    if (moved.count !== 1) throw new HttpError(409, message, 'INVALID_STATE');
  }

  return {
    async list() {
      const rows = await db.settlement.findMany({ orderBy: { periodStart: 'desc' }, take: 100 });
      return rows.map(summary);
    },

    async get(id: string) {
      return toDetailDto(await load(db, id));
    },

    async generate(date: Date | undefined, actor: AuditActor, now = new Date()) {
      const settings = await db.storeSettings.findUnique({ where: { id: 1 } });
      const frequency = settings?.settlementFrequency ?? 'BIWEEKLY';
      const period = date
        ? settlementPeriodFor(date, frequency)
        : previousSettlementPeriod(now, frequency);
      if (period.start > now)
        throw new HttpError(400, 'Ese periodo todavía no empieza', 'FUTURE_PERIOD');
      const id = await db.$transaction(async (tx) => {
        // No overlaps, even if the frequency changed between settlements.
        const overlap = await tx.settlement.findFirst({
          where: { periodStart: { lt: period.end }, periodEnd: { gt: period.start } },
        });
        if (overlap)
          throw new HttpError(409, 'Ya existe una liquidación para ese periodo', 'DUPLICATE');
        const created = await tx.settlement.create({
          data: { periodStart: period.start, periodEnd: period.end },
        });
        const totals = await attachAndTotal(tx, created.id, period);
        await audit(tx, actor, {
          action: 'settlement.generate',
          entity: 'Settlement',
          entityId: created.id,
          diff: { periodStart: period.start, periodEnd: period.end, ...totals },
        });
        return created.id;
      });
      return this.get(id);
    },

    async recalculate(id: string, actor: AuditActor) {
      await db.$transaction(async (tx) => {
        const s = await load(tx, id);
        if (s.status !== 'OPEN')
          throw new HttpError(409, 'Solo se recalculan liquidaciones abiertas', 'INVALID_STATE');
        const totals = await attachAndTotal(tx, id, { start: s.periodStart, end: s.periodEnd });
        await audit(tx, actor, {
          action: 'settlement.recalculate',
          entity: 'Settlement',
          entityId: id,
          diff: { ...totals },
        });
      });
      return this.get(id);
    },

    /** Freezes the settlement: picks up any late items first, then no more changes. */
    async close(id: string, actor: AuditActor, now = new Date()) {
      await db.$transaction(async (tx) => {
        const s = await load(tx, id);
        if (s.status !== 'OPEN')
          throw new HttpError(409, 'La liquidación ya está cerrada', 'INVALID_STATE');
        if (s.periodEnd > now)
          throw new HttpError(
            409,
            'El periodo aún no termina: podrás cerrarla cuando acabe',
            'PERIOD_NOT_ENDED',
          );
        const totals = await attachAndTotal(tx, id, { start: s.periodStart, end: s.periodEnd });
        await move(tx, id, 'OPEN', { status: 'CLOSED', closedAt: now }, 'La liquidación cambió');
        await audit(tx, actor, {
          action: 'settlement.close',
          entity: 'Settlement',
          entityId: id,
          diff: { ...totals },
        });
      });
      return this.get(id);
    },

    async markPaid(id: string, actor: AuditActor, now = new Date()) {
      await db.$transaction(async (tx) => {
        await load(tx, id);
        await move(
          tx,
          id,
          'CLOSED',
          { status: 'PAID', paidAt: now },
          'Primero cierra la liquidación para marcarla como pagada',
        );
        await audit(tx, actor, {
          action: 'settlement.pay',
          entity: 'Settlement',
          entityId: id,
          diff: { paidAt: now },
        });
      });
      return this.get(id);
    },

    async updateNotes(id: string, notes: string | null, actor: AuditActor) {
      await db.$transaction(async (tx) => {
        const s = await load(tx, id);
        await tx.settlement.update({ where: { id }, data: { notes } });
        await audit(tx, actor, {
          action: 'settlement.notes',
          entity: 'Settlement',
          entityId: id,
          diff: { notes: { from: s.notes, to: notes } },
        });
      });
      return this.get(id);
    },

    /** Only open settlements can be deleted; their orders and refunds go back to unsettled. */
    async remove(id: string, actor: AuditActor) {
      await db.$transaction(async (tx) => {
        const s = await load(tx, id);
        if (s.status !== 'OPEN')
          throw new HttpError(409, 'Solo se eliminan liquidaciones abiertas', 'INVALID_STATE');
        await tx.order.updateMany({ where: { settlementId: id }, data: { settlementId: null } });
        await tx.orderRefund.updateMany({
          where: { settlementId: id },
          data: { settlementId: null },
        });
        await tx.settlement.delete({ where: { id } });
        await audit(tx, actor, {
          action: 'settlement.delete',
          entity: 'Settlement',
          entityId: id,
          diff: { periodStart: s.periodStart, periodEnd: s.periodEnd },
        });
      });
    },

    async csv(id: string) {
      const s = await load(db, id);
      const detail = toDetailDto(s);
      return {
        filename: `liquidacion-${detail.periodStart.toISOString().slice(0, 10)}.csv`,
        content: settlementCsv({
          period: { start: s.periodStart, end: s.periodEnd },
          orders: detail.orders.map((o) => ({
            number: o.number,
            paidAt: o.paidAt,
            customerName: o.customerName,
            total: o.total,
            commissionAmount: o.commissionAmount,
            gatewayFeeAmount: o.gatewayFeeAmount,
          })),
          refunds: detail.refunds,
          totals: {
            orderCount: s.orderCount,
            grossSales: s.grossSales,
            refundTotal: s.refundTotal,
            commissionTotal: s.commissionTotal,
            gatewayFeeTotal: s.gatewayFeeTotal,
            netTotal: s.netTotal,
          },
        }),
      };
    },
  };
}

export type SettlementsService = ReturnType<typeof createSettlementsService>;
