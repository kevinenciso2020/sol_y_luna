import { applyBps } from '@sol-y-luna/shared';
import type { CommissionRule, PriceTier } from '../generated/prisma/client.js';

/**
 * Platform commission. For each line the most specific active rule wins:
 * PRODUCT, then CATEGORY, then GLOBAL — preferring a rule for the line's price tier over a
 * tier-agnostic one. Base = line total minus its proportional share of the discount
 * (never shipping or gateway fees). The fixed amount per order comes from the GLOBAL rule.
 */
export interface CommissionLine {
  productId: string | null;
  categoryId: string | null;
  lineTotal: number;
  priceTier: PriceTier;
}

export interface CommissionResult {
  base: number;
  amount: number;
  fixed: number;
  /** Effective rate over the base, in basis points (informative when lines use different rules). */
  rateBps: number;
  /** Rule applied when every line used the same one; null when it was mixed. */
  ruleId: string | null;
}

const active = (rule: CommissionRule, now: Date) =>
  rule.isActive && rule.validFrom <= now && (rule.validTo === null || rule.validTo > now);

export function pickRule(
  rules: CommissionRule[],
  line: Pick<CommissionLine, 'productId' | 'categoryId' | 'priceTier'>,
  now: Date,
): CommissionRule | null {
  const candidates = rules.filter(
    (r) => active(r, now) && (r.priceTier === null || r.priceTier === line.priceTier),
  );
  const byScope = (scope: CommissionRule['scope'], match: (r: CommissionRule) => boolean) =>
    candidates
      .filter((r) => r.scope === scope && match(r))
      // Tier-specific beats tier-agnostic; then the newest.
      .sort(
        (a, b) =>
          Number(b.priceTier !== null) - Number(a.priceTier !== null) ||
          b.validFrom.getTime() - a.validFrom.getTime(),
      )[0];
  return (
    (line.productId ? byScope('PRODUCT', (r) => r.productId === line.productId) : undefined) ??
    (line.categoryId ? byScope('CATEGORY', (r) => r.categoryId === line.categoryId) : undefined) ??
    byScope('GLOBAL', () => true) ??
    null
  );
}

/** Splits `discount` across lines proportionally, assigning rounding leftovers to the last line. */
export function allocateDiscount(lineTotals: number[], discount: number): number[] {
  const subtotal = lineTotals.reduce((s, v) => s + v, 0);
  if (subtotal === 0 || discount === 0) return lineTotals.map(() => 0);
  const shares = lineTotals.map((v) => Math.floor((v * discount) / subtotal));
  const leftover = discount - shares.reduce((s, v) => s + v, 0);
  shares[shares.length - 1]! += leftover;
  return shares;
}

export function computeCommission(
  rules: CommissionRule[],
  lines: CommissionLine[],
  discount: number,
  now = new Date(),
): CommissionResult {
  const discounts = allocateDiscount(
    lines.map((l) => l.lineTotal),
    discount,
  );
  let amount = 0;
  let base = 0;
  const used = new Set<string>();
  lines.forEach((line, i) => {
    const lineBase = line.lineTotal - discounts[i]!;
    base += lineBase;
    const rule = pickRule(rules, line, now);
    if (!rule) return;
    used.add(rule.id);
    amount += applyBps(lineBase, rule.rateBps);
  });
  const global = rules.find((r) => r.scope === 'GLOBAL' && active(r, now));
  const fixed = global?.fixedAmount ?? 0;
  const total = Math.min(amount + fixed, base);
  return {
    base,
    amount: total,
    fixed,
    rateBps: base > 0 ? Math.round((amount * 10_000) / base) : 0,
    ruleId: used.size === 1 ? [...used][0]! : null,
  };
}

/** Commission after a refund: full refund reverses it, partial refund scales it proportionally. */
export function commissionAfterRefund(
  original: { amount: number; total: number },
  refunded: number,
): number {
  if (refunded >= original.total) return 0;
  return Math.round((original.amount * (original.total - refunded)) / original.total);
}
