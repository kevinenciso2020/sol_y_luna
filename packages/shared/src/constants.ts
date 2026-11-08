export const ROLES = ['ADMIN', 'OPERATOR', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export const WHOLESALE_STATUSES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type WholesaleStatus = (typeof WHOLESALE_STATUSES)[number];

export const AUDIENCES = ['HIM', 'HER', 'UNISEX'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const INVIMA_STATUSES = [
  'REGISTERED',
  'IN_PROCESS',
  'NOT_REQUIRED',
  'NOT_REGISTERED',
] as const;
export type InvimaStatus = (typeof INVIMA_STATUSES)[number];

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRICE_TIERS = ['RETAIL', 'WHOLESALE'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export const PAYMENT_PROVIDERS = ['MOCK', 'MERCADOPAGO', 'WOMPI'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'PAYMENT_FAILED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed order status transitions. Anything not listed here is rejected by the server.
 * See docs/DECISIONS.md for the rationale of the non-linear edges.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED', 'REFUNDED'],
  PREPARING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['DELIVERED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Labels shown to customers, in Colombian Spanish. */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'Pendiente de pago',
  PAID: 'Pagado',
  PREPARING: 'Preparando',
  SHIPPED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
  PAYMENT_FAILED: 'Pago rechazado',
};

export const STOCK_RESERVATION_MINUTES = 30;
export const ORDER_NUMBER_PREFIX = 'SYL';
export const DEFAULT_COMMISSION_BPS = 1000;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Formats a sequential order number: 123 -> "SYL-000123". */
export function formatOrderNumber(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new RangeError('sequence must be a positive integer');
  }
  return `${ORDER_NUMBER_PREFIX}-${sequence.toString().padStart(6, '0')}`;
}
