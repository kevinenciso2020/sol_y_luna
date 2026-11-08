import { applyBps } from '@sol-y-luna/shared';
import type { Coupon, PriceTier } from '../generated/prisma/client.js';

/** Pure pricing rules. Everything money-related is computed here, on the server, in integer COP. */

export interface PricedVariantInput {
  variantId: string;
  quantity: number;
  retailPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number;
}

export interface PricedLine {
  variantId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  priceTier: PriceTier;
}

/** Wholesale price only for approved wholesalers buying at least the minimum of that variant. */
export function priceLine(input: PricedVariantInput, wholesaleApproved: boolean): PricedLine {
  const wholesale =
    wholesaleApproved && input.wholesalePrice !== null && input.quantity >= input.wholesaleMinQty;
  const unitPrice = wholesale ? input.wholesalePrice! : input.retailPrice;
  return {
    variantId: input.variantId,
    quantity: input.quantity,
    unitPrice,
    lineTotal: unitPrice * input.quantity,
    priceTier: wholesale ? 'WHOLESALE' : 'RETAIL',
  };
}

export type CouponCheck = { ok: true; discount: number } | { ok: false; reason: string };

/**
 * Validates a coupon against the cart and returns the discount (never more than the subtotal).
 * `uses` = total redemptions and redemptions by this customer (user id or email).
 */
export function evaluateCoupon(
  coupon: Coupon | null,
  ctx: { subtotal: number; hasWholesaleLines: boolean; now: Date; usesByCustomer: number },
): CouponCheck {
  if (!coupon || !coupon.isActive)
    return { ok: false, reason: 'El cupón no existe o no está activo' };
  if (coupon.startsAt && coupon.startsAt > ctx.now)
    return { ok: false, reason: 'El cupón todavía no está vigente' };
  if (coupon.endsAt && coupon.endsAt <= ctx.now) return { ok: false, reason: 'El cupón ya venció' };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)
    return { ok: false, reason: 'El cupón ya se agotó' };
  if (coupon.maxUsesPerUser !== null && ctx.usesByCustomer >= coupon.maxUsesPerUser) {
    return { ok: false, reason: 'Ya usaste este cupón' };
  }
  if (ctx.hasWholesaleLines && !coupon.appliesToWholesale) {
    return { ok: false, reason: 'Este cupón no aplica a compras con precio mayorista' };
  }
  if (ctx.subtotal < coupon.minSubtotal) {
    return {
      ok: false,
      reason: `El cupón aplica desde una compra de $${coupon.minSubtotal.toLocaleString('es-CO')}`,
    };
  }
  const raw = coupon.type === 'PERCENT' ? applyBps(ctx.subtotal, coupon.value * 100) : coupon.value;
  return { ok: true, discount: Math.min(raw, ctx.subtotal) };
}

export interface Totals {
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  priceTier: PriceTier;
}

export function totals(lines: PricedLine[], discount: number): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const safeDiscount = Math.min(Math.max(0, discount), subtotal);
  return {
    subtotal,
    discount: safeDiscount,
    shipping: 0, // free shipping, always
    total: subtotal - safeDiscount,
    priceTier: lines.some((l) => l.priceTier === 'WHOLESALE') ? 'WHOLESALE' : 'RETAIL',
  };
}
