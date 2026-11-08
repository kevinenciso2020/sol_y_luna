import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, canTransitionOrder, formatOrderNumber } from './constants.js';

describe('order transitions', () => {
  it('allows the happy path', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransitionOrder('PAID', 'PREPARING')).toBe(true);
    expect(canTransitionOrder('PREPARING', 'SHIPPED')).toBe(true);
    expect(canTransitionOrder('SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('rejects skipping steps or going backwards', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
    expect(canTransitionOrder('DELIVERED', 'PAID')).toBe(false);
    expect(canTransitionOrder('SHIPPED', 'PREPARING')).toBe(false);
  });

  it('treats CANCELLED and REFUNDED as terminal', () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransitionOrder('CANCELLED', to)).toBe(false);
      expect(canTransitionOrder('REFUNDED', to)).toBe(false);
    }
  });
});

describe('formatOrderNumber', () => {
  it('pads to six digits', () => {
    expect(formatOrderNumber(123)).toBe('SYL-000123');
  });

  it('rejects invalid sequences', () => {
    expect(() => formatOrderNumber(0)).toThrow(RangeError);
  });
});
