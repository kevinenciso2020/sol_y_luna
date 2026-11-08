import { describe, expect, it } from 'vitest';
import { applyBps, copToCents, formatCOP, sumCop } from './money.js';

describe('formatCOP', () => {
  it.each([
    [0, '$0'],
    [900, '$900'],
    [89_900, '$89.900'],
    [1_250_000, '$1.250.000'],
    [-15_000, '-$15.000'],
  ])('formats %i as %s', (value, expected) => {
    expect(formatCOP(value)).toBe(expected);
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatCOP(89_900.5)).toThrow(TypeError);
  });
});

describe('applyBps', () => {
  it('computes 10% commission', () => {
    expect(applyBps(89_900, 1000)).toBe(8_990);
  });

  it('rounds half away from zero to the nearest peso', () => {
    expect(applyBps(15, 1000)).toBe(2); // 1.5 -> 2
    expect(applyBps(14, 1000)).toBe(1); // 1.4 -> 1
    expect(applyBps(-15, 1000)).toBe(-2);
  });

  it('rejects fractional bps', () => {
    expect(() => applyBps(100, 10.5)).toThrow(TypeError);
  });
});

describe('sumCop / copToCents', () => {
  it('sums integer amounts', () => {
    expect(sumCop([10_000, 20_500, 0])).toBe(30_500);
  });

  it('converts to cents', () => {
    expect(copToCents(89_900)).toBe(8_990_000);
  });
});
