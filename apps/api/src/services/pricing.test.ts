import { describe, expect, it } from 'vitest';
import type { Coupon } from '../generated/prisma/client.js';
import { evaluateCoupon, priceLine, totals } from './pricing.js';

const variant = {
  variantId: 'v1',
  retailPrice: 12_900,
  wholesalePrice: 9_500,
  wholesaleMinQty: 12,
};

describe('priceLine', () => {
  it('usa precio detal para clientes normales', () => {
    expect(priceLine({ ...variant, quantity: 24 }, false)).toMatchObject({
      unitPrice: 12_900,
      priceTier: 'RETAIL',
      lineTotal: 309_600,
    });
  });

  it('usa precio mayorista solo si el mayorista cumple la cantidad mínima', () => {
    expect(priceLine({ ...variant, quantity: 11 }, true)).toMatchObject({
      unitPrice: 12_900,
      priceTier: 'RETAIL',
    });
    expect(priceLine({ ...variant, quantity: 12 }, true)).toMatchObject({
      unitPrice: 9_500,
      priceTier: 'WHOLESALE',
      lineTotal: 114_000,
    });
  });

  it('sin precio mayorista configurado siempre es detal', () => {
    expect(priceLine({ ...variant, wholesalePrice: null, quantity: 50 }, true).priceTier).toBe(
      'RETAIL',
    );
  });
});

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c1',
  code: 'BIENVENIDA10',
  description: null,
  type: 'PERCENT',
  value: 10,
  minSubtotal: 80_000,
  maxUses: null,
  maxUsesPerUser: 1,
  usedCount: 0,
  startsAt: null,
  endsAt: null,
  isActive: true,
  appliesToWholesale: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});
const ctx = { subtotal: 100_000, hasWholesaleLines: false, now: new Date(), usesByCustomer: 0 };

describe('evaluateCoupon', () => {
  it('calcula porcentaje y valor fijo sin pasarse del subtotal', () => {
    expect(evaluateCoupon(coupon(), ctx)).toEqual({ ok: true, discount: 10_000 });
    expect(evaluateCoupon(coupon({ type: 'FIXED', value: 150_000, minSubtotal: 0 }), ctx)).toEqual({
      ok: true,
      discount: 100_000,
    });
  });

  it('rechaza con el motivo en español', () => {
    expect(evaluateCoupon(null, ctx)).toMatchObject({ ok: false });
    expect(evaluateCoupon(coupon(), { ...ctx, subtotal: 50_000 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/desde una compra/),
    });
    expect(evaluateCoupon(coupon(), { ...ctx, usesByCustomer: 1 })).toMatchObject({
      ok: false,
      reason: 'Ya usaste este cupón',
    });
    expect(evaluateCoupon(coupon({ maxUses: 5, usedCount: 5 }), ctx)).toMatchObject({
      ok: false,
      reason: 'El cupón ya se agotó',
    });
    expect(evaluateCoupon(coupon({ endsAt: new Date(Date.now() - 1000) }), ctx)).toMatchObject({
      ok: false,
      reason: 'El cupón ya venció',
    });
    expect(evaluateCoupon(coupon(), { ...ctx, hasWholesaleLines: true })).toMatchObject({
      ok: false,
    });
  });
});

describe('totals', () => {
  it('envío gratis y total = subtotal − descuento', () => {
    const lines = [priceLine({ ...variant, quantity: 2 }, false)];
    expect(totals(lines, 2_580)).toEqual({
      subtotal: 25_800,
      discount: 2_580,
      shipping: 0,
      total: 23_220,
      priceTier: 'RETAIL',
    });
  });
});
