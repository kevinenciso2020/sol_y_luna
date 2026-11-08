import { describe, expect, it } from 'vitest';
import {
  commissionRuleInputSchema,
  previousSettlementPeriod,
  refundInputSchema,
  settlementPeriodFor,
  shipmentInputSchema,
  stockAdjustmentSchema,
} from './business.js';

// Colombia is UTC-5 all year: local midnight is 05:00 UTC.
const utc = (iso: string) => new Date(iso);

describe('settlementPeriodFor', () => {
  it('quincenal: del 1 al 15 en hora de Colombia', () => {
    const p = settlementPeriodFor(utc('2026-11-10T12:00:00Z'), 'BIWEEKLY');
    expect(p.start.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });

  it('quincenal: del 16 al fin de mes (febrero)', () => {
    const p = settlementPeriodFor(utc('2026-02-20T00:00:00Z'), 'BIWEEKLY');
    expect(p.start.toISOString()).toBe('2026-02-16T05:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-03-01T05:00:00.000Z');
  });

  it('usa la fecha de Colombia, no la UTC (1 de diciembre 02:00 UTC = 30 de noviembre)', () => {
    const p = settlementPeriodFor(utc('2026-12-01T02:00:00Z'), 'MONTHLY');
    expect(p.start.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  it('mensual: cruza el año', () => {
    const p = settlementPeriodFor(utc('2026-12-31T20:00:00Z'), 'MONTHLY');
    expect(p.start.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(p.end.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
});

describe('previousSettlementPeriod', () => {
  it('devuelve el último periodo ya terminado', () => {
    const p = previousSettlementPeriod(utc('2026-11-08T15:00:00Z'), 'BIWEEKLY');
    expect(p.start.toISOString()).toBe('2026-10-16T05:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });
});

describe('commissionRuleInputSchema', () => {
  it('acepta una regla global del 10%', () => {
    const rule = commissionRuleInputSchema.parse({ scope: 'GLOBAL', rateBps: 1000 });
    expect(rule).toMatchObject({ rateBps: 1000, fixedAmount: 0, priceTier: null, isActive: true });
  });

  it('exige la categoría o el producto según el alcance', () => {
    const r = commissionRuleInputSchema.safeParse({ scope: 'CATEGORY', rateBps: 800 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Elige la categoría');
  });

  it('el valor fijo por pedido solo aplica a la regla global', () => {
    const r = commissionRuleInputSchema.safeParse({
      scope: 'PRODUCT',
      productId: 'cmabcdefghijklmnopqrstuv',
      rateBps: 500,
      fixedAmount: 1000,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['fixedAmount']);
  });

  it('no permite más del 100%', () => {
    expect(commissionRuleInputSchema.safeParse({ scope: 'GLOBAL', rateBps: 10_001 }).success).toBe(
      false,
    );
  });
});

describe('shipmentInputSchema', () => {
  it('pide transportadora y guía, y solo URLs https', () => {
    expect(
      shipmentInputSchema.safeParse({ carrier: 'Servientrega', trackingNumber: '123456789' })
        .success,
    ).toBe(true);
    const bad = shipmentInputSchema.safeParse({
      carrier: 'Servientrega',
      trackingNumber: '1',
      trackingUrl: 'javascript:alert(1)',
    });
    expect(bad.success).toBe(false);
  });
});

describe('stockAdjustmentSchema y refundInputSchema', () => {
  it('el ajuste no puede ser cero', () => {
    const r = stockAdjustmentSchema.safeParse({ delta: 0, reason: 'ADJUSTMENT', note: 'conteo' });
    expect(r.success).toBe(false);
  });

  it('el reembolso pide monto entero positivo y motivo', () => {
    expect(refundInputSchema.safeParse({ amount: 1000.5, reason: 'x' }).success).toBe(false);
    expect(refundInputSchema.parse({ amount: 1000, reason: 'Producto averiado' })).toMatchObject({
      restock: false,
    });
  });
});
