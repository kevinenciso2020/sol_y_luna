/**
 * Money helpers. All amounts are integer Colombian pesos (COP). Never use floats for money.
 */

export type Cop = number;

/** Throws if the value is not a safe integer amount of pesos. */
export function assertCop(value: number, label = 'amount'): asserts value is Cop {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer amount of COP, received ${String(value)}`);
  }
}

/** Formats an integer COP amount as shown in the store: 89900 -> "$89.900". */
export function formatCOP(value: Cop): string {
  assertCop(value);
  const sign = value < 0 ? '-' : '';
  const digits = Math.abs(value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${grouped}`;
}

/** Sums integer COP amounts, validating each one. */
export function sumCop(values: readonly Cop[]): Cop {
  return values.reduce<Cop>((total, value) => {
    assertCop(value);
    return total + value;
  }, 0);
}

/**
 * Applies a rate in basis points (1000 = 10%) to an integer amount,
 * rounding half away from zero to the nearest peso. Uses integer math only.
 */
export function applyBps(amount: Cop, bps: number): Cop {
  assertCop(amount);
  assertCop(bps, 'bps');
  const product = amount * bps;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError('amount * bps exceeds safe integer range');
  }
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  const quotient = Math.floor(abs / 10_000);
  const remainder = abs % 10_000;
  return sign * (remainder >= 5_000 ? quotient + 1 : quotient);
}

/** Wompi and other gateways expect amounts in cents. */
export function copToCents(value: Cop): number {
  assertCop(value);
  return value * 100;
}
