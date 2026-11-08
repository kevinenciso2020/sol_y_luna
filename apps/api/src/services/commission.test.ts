import { describe, expect, it } from 'vitest';
import type { CommissionRule } from '../generated/prisma/client.js';
import {
  allocateDiscount,
  commissionAfterRefund,
  computeCommission,
  pickRule,
} from './commission.js';

const now = new Date('2026-11-08T12:00:00Z');
const rule = (over: Partial<CommissionRule>): CommissionRule => ({
  id: 'r',
  scope: 'GLOBAL',
  categoryId: null,
  productId: null,
  priceTier: null,
  rateBps: 1000,
  fixedAmount: 0,
  validFrom: new Date('2026-01-01'),
  validTo: null,
  isActive: true,
  createdById: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

describe('pickRule', () => {
  const rules = [
    rule({ id: 'global' }),
    rule({ id: 'cat', scope: 'CATEGORY', categoryId: 'c1', rateBps: 800 }),
    rule({ id: 'prod', scope: 'PRODUCT', productId: 'p1', rateBps: 500 }),
    rule({ id: 'global-ws', priceTier: 'WHOLESALE', rateBps: 700 }),
    rule({
      id: 'vencida',
      scope: 'PRODUCT',
      productId: 'p2',
      validTo: new Date('2026-06-01'),
      rateBps: 100,
    }),
  ];
  it('aplica PRODUCT > CATEGORY > GLOBAL', () => {
    expect(
      pickRule(rules, { productId: 'p1', categoryId: 'c1', priceTier: 'RETAIL' }, now)?.id,
    ).toBe('prod');
    expect(
      pickRule(rules, { productId: 'p9', categoryId: 'c1', priceTier: 'RETAIL' }, now)?.id,
    ).toBe('cat');
    expect(
      pickRule(rules, { productId: 'p9', categoryId: null, priceTier: 'RETAIL' }, now)?.id,
    ).toBe('global');
  });
  it('prefiere la regla del nivel de precio e ignora las vencidas', () => {
    expect(
      pickRule(rules, { productId: null, categoryId: null, priceTier: 'WHOLESALE' }, now)?.id,
    ).toBe('global-ws');
    expect(
      pickRule(rules, { productId: 'p2', categoryId: null, priceTier: 'RETAIL' }, now)?.id,
    ).toBe('global');
  });
});

describe('computeCommission', () => {
  it('10% sobre subtotal menos descuento, sin envío', () => {
    const result = computeCommission(
      [rule({ id: 'g' })],
      [{ productId: 'p', categoryId: null, lineTotal: 129_800, priceTier: 'RETAIL' }],
      12_980,
      now,
    );
    expect(result).toEqual({ base: 116_820, amount: 11_682, fixed: 0, rateBps: 1000, ruleId: 'g' });
  });

  it('suma el valor fijo por pedido y mezcla reglas por línea', () => {
    const rules = [
      rule({ id: 'g', fixedAmount: 500 }),
      rule({ id: 'p', scope: 'PRODUCT', productId: 'p1', rateBps: 500 }),
    ];
    const result = computeCommission(
      rules,
      [
        { productId: 'p1', categoryId: null, lineTotal: 100_000, priceTier: 'RETAIL' },
        { productId: 'p2', categoryId: null, lineTotal: 100_000, priceTier: 'RETAIL' },
      ],
      0,
      now,
    );
    expect(result.amount).toBe(5_000 + 10_000 + 500);
    expect(result.ruleId).toBeNull();
  });
});

describe('allocateDiscount / commissionAfterRefund', () => {
  it('reparte el descuento sin perder pesos', () => {
    const parts = allocateDiscount([33_333, 33_333, 33_334], 10_000);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000);
  });
  it('reversa la comisión en reembolso total y la prorratea en parcial', () => {
    expect(commissionAfterRefund({ amount: 10_000, total: 100_000 }, 100_000)).toBe(0);
    expect(commissionAfterRefund({ amount: 10_000, total: 100_000 }, 25_000)).toBe(7_500);
  });
});
