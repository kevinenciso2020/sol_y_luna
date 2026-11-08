import type { SettlementPeriod } from '@sol-y-luna/shared';
import { commissionAfterRefund } from './commission.js';

/**
 * Pure settlement math. A settlement is the list of orders paid in the period plus the refunds
 * recorded in it; every column adds up so the CSV squares to the peso.
 */

/**
 * Commission to reverse for a new refund. It is cumulative: the remaining commission is always
 * `commissionAfterRefund(total refunded so far)`, so a series of partial refunds that ends in a
 * full refund reverses exactly the whole commission, without rounding leftovers.
 */
export function refundCommissionReversal(
  order: { total: number; commissionAmount: number },
  refund: { refundedBefore: number; commissionRefunded: number; amount: number },
): number {
  const remaining = commissionAfterRefund(
    { amount: order.commissionAmount, total: order.total },
    refund.refundedBefore + refund.amount,
  );
  return Math.max(0, order.commissionAmount - refund.commissionRefunded - remaining);
}

export interface SettlementOrderRow {
  total: number;
  commissionAmount: number | null;
  gatewayFeeAmount: number | null;
}

export interface SettlementRefundRow {
  amount: number;
  commissionReversed: number;
}

export interface SettlementTotals {
  orderCount: number;
  grossSales: number;
  refundTotal: number;
  commissionTotal: number;
  gatewayFeeTotal: number;
  netTotal: number;
}

export function settlementTotals(
  orders: SettlementOrderRow[],
  refunds: SettlementRefundRow[],
): SettlementTotals {
  const sum = <T>(rows: T[], pick: (row: T) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const grossSales = sum(orders, (o) => o.total);
  const refundTotal = sum(refunds, (r) => r.amount);
  const commissionTotal =
    sum(orders, (o) => o.commissionAmount ?? 0) - sum(refunds, (r) => r.commissionReversed);
  const gatewayFeeTotal = sum(orders, (o) => o.gatewayFeeAmount ?? 0);
  return {
    orderCount: orders.length,
    grossSales,
    refundTotal,
    commissionTotal,
    gatewayFeeTotal,
    netTotal: grossSales - refundTotal - commissionTotal - gatewayFeeTotal,
  };
}

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
/** YYYY-MM-DD in Colombian local time. */
export const bogotaDate = (date: Date) =>
  new Date(date.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);

/** Quotes a CSV cell and neutralizes spreadsheet formulas (CSV injection). */
function cell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) || text !== value ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface SettlementCsvInput {
  period: SettlementPeriod;
  orders: (SettlementOrderRow & { number: string; paidAt: Date | null; customerName: string })[];
  refunds: (SettlementRefundRow & { number: string; createdAt: Date; customerName: string })[];
  totals: SettlementTotals;
}

/** CSV for Excel in Colombia: UTF-8 with BOM, `;` separator, whole pesos. */
export function settlementCsv(input: SettlementCsvInput): string {
  const rows: (string | number)[][] = [
    ['Tipo', 'Pedido', 'Fecha', 'Cliente', 'Venta', 'Reembolso', 'Comisión', 'Pasarela', 'Neto'],
  ];
  for (const o of input.orders) {
    const commission = o.commissionAmount ?? 0;
    const fee = o.gatewayFeeAmount ?? 0;
    rows.push([
      'Pedido',
      o.number,
      o.paidAt ? bogotaDate(o.paidAt) : '',
      o.customerName,
      o.total,
      0,
      commission,
      fee,
      o.total - commission - fee,
    ]);
  }
  for (const r of input.refunds) {
    rows.push([
      'Reembolso',
      r.number,
      bogotaDate(r.createdAt),
      r.customerName,
      0,
      r.amount,
      -r.commissionReversed,
      0,
      -(r.amount - r.commissionReversed),
    ]);
  }
  const t = input.totals;
  rows.push([
    'Total',
    '',
    '',
    '',
    t.grossSales,
    t.refundTotal,
    t.commissionTotal,
    t.gatewayFeeTotal,
    t.netTotal,
  ]);
  return `\uFEFF${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}
