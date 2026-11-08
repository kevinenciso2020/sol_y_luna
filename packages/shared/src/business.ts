import { z } from 'zod';
import { ORDER_STATUSES, PRICE_TIERS, type OrderStatus } from './constants.js';
import { copAmountSchema } from './schemas.js';

/** Phase 6: commissions, settlements, dispatch and stock. */

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/, { error: 'Identificador inválido' });

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `Escribe ${label}` })
    .trim()
    .min(1, { error: `Escribe ${label}` })
    .max(max, { error: `Máximo ${max} caracteres` });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

// ─── Settlement periods (Colombia is UTC-5 all year, no daylight saving) ────────────────────────

export const SETTLEMENT_FREQUENCIES = ['BIWEEKLY', 'MONTHLY'] as const;
export type SettlementFrequency = (typeof SETTLEMENT_FREQUENCIES)[number];
export const SETTLEMENT_STATUSES = ['OPEN', 'CLOSED', 'PAID'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_STATUS_LABELS: Readonly<Record<SettlementStatus, string>> = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
  PAID: 'Pagada',
};

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
/** Local midnight in Colombia for the given calendar day, as a UTC instant. */
const bogotaMidnight = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day) + BOGOTA_OFFSET_MS);

export interface SettlementPeriod {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** Period (in Colombian local time) that contains `date`. */
export function settlementPeriodFor(date: Date, frequency: SettlementFrequency): SettlementPeriod {
  const local = new Date(date.getTime() - BOGOTA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  if (frequency === 'MONTHLY') {
    return { start: bogotaMidnight(year, month, 1), end: bogotaMidnight(year, month + 1, 1) };
  }
  return local.getUTCDate() <= 15
    ? { start: bogotaMidnight(year, month, 1), end: bogotaMidnight(year, month, 16) }
    : { start: bogotaMidnight(year, month, 16), end: bogotaMidnight(year, month + 1, 1) };
}

/** Last period that already ended before `now`. */
export function previousSettlementPeriod(
  now: Date,
  frequency: SettlementFrequency,
): SettlementPeriod {
  const current = settlementPeriodFor(now, frequency);
  return settlementPeriodFor(new Date(current.start.getTime() - 1), frequency);
}

export const settlementGenerateSchema = z.object({
  /** Any instant inside the period to settle; defaults to the last finished period. */
  date: z.coerce.date({ error: 'Fecha inválida' }).optional(),
});

export const settlementNotesSchema = z.object({ notes: optionalText(1000) });

// ─── Commission rules ───────────────────────────────────────────────────────────────────────────

export const COMMISSION_SCOPES = ['GLOBAL', 'CATEGORY', 'PRODUCT'] as const;
export type CommissionScope = (typeof COMMISSION_SCOPES)[number];
export const COMMISSION_SCOPE_LABELS: Readonly<Record<CommissionScope, string>> = {
  GLOBAL: 'Global',
  CATEGORY: 'Categoría',
  PRODUCT: 'Producto',
};

export const commissionRuleInputSchema = z
  .object({
    scope: z.enum(COMMISSION_SCOPES, { error: 'Elige el alcance' }),
    categoryId: idSchema.nullable().optional(),
    productId: idSchema.nullable().optional(),
    priceTier: z.enum(PRICE_TIERS).nullable().default(null),
    rateBps: z.coerce
      .number({ error: 'Escribe el porcentaje' })
      .int({ error: 'Máximo dos decimales' })
      .min(0, { error: 'El porcentaje no puede ser negativo' })
      .max(10_000, { error: 'El porcentaje máximo es 100' }),
    fixedAmount: copAmountSchema.default(0),
    validFrom: z.coerce.date().nullable().optional(),
    validTo: z.coerce.date().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.scope !== 'CATEGORY' || Boolean(r.categoryId), {
    error: 'Elige la categoría',
    path: ['categoryId'],
  })
  .refine((r) => r.scope !== 'PRODUCT' || Boolean(r.productId), {
    error: 'Elige el producto',
    path: ['productId'],
  })
  .refine((r) => r.scope === 'GLOBAL' || r.fixedAmount === 0, {
    error: 'El valor fijo por pedido solo aplica a la regla global',
    path: ['fixedAmount'],
  })
  .refine((r) => !r.validFrom || !r.validTo || r.validTo > r.validFrom, {
    error: 'La fecha final debe ser posterior a la inicial',
    path: ['validTo'],
  });
export type CommissionRuleInput = z.infer<typeof commissionRuleInputSchema>;

// ─── Orders: dispatch, refunds ──────────────────────────────────────────────────────────────────

/** Statuses the operator can move an order to (the rest are admin-only). */
export const OPERATOR_TARGET_STATUSES = [
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
] as const satisfies readonly OrderStatus[];
/** Orders the operator can see: paid or later. */
export const OPERATOR_VISIBLE_STATUSES = [
  'PAID',
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
  'REFUNDED',
] as const satisfies readonly OrderStatus[];

export const CARRIERS = [
  'Servientrega',
  'Interrapidísimo',
  'Coordinadora',
  'Envía',
  'TCC',
  'Deprisa',
  '4-72',
] as const;

export const adminOrderQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum([...ORDER_STATUSES, 'ALL', 'TO_DISPATCH']).default('ALL'),
  review: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

export const orderNumberParamsSchema = z.object({
  number: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^SYL-\d{6,}$/, { error: 'Número de pedido inválido' }),
});

export const orderStatusChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES, { error: 'Estado inválido' }),
  note: optionalText(300),
});

export const shipmentInputSchema = z.object({
  carrier: requiredText('la transportadora', 60),
  trackingNumber: z
    .string({ error: 'Escribe el número de guía' })
    .trim()
    .regex(/^[A-Za-z0-9-]{4,40}$/, {
      error: 'Guía: de 4 a 40 letras, números o guiones',
    }),
  trackingUrl: z
    .url({ protocol: /^https$/, error: 'Usa un enlace https://' })
    .max(500)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
});
export type ShipmentInput = z.infer<typeof shipmentInputSchema>;

export const refundInputSchema = z.object({
  amount: z.coerce
    .number({ error: 'Escribe el monto' })
    .int({ error: 'El monto debe ser un número entero de pesos' })
    .min(1, { error: 'El monto debe ser mayor que cero' }),
  reason: requiredText('el motivo', 300),
  restock: z.boolean().default(false),
});
export type RefundInput = z.infer<typeof refundInputSchema>;

// ─── Stock ──────────────────────────────────────────────────────────────────────────────────────

export const STOCK_ADJUSTMENT_REASONS = ['RESTOCK', 'ADJUSTMENT', 'RETURN'] as const;
export const STOCK_REASON_LABELS: Readonly<Record<string, string>> = {
  RESTOCK: 'Llegada de mercancía',
  ADJUSTMENT: 'Ajuste de inventario',
  RETURN: 'Devolución',
  SALE: 'Venta',
  RESERVATION: 'Reserva',
  RELEASE: 'Liberación de reserva',
};

export const stockAdjustmentSchema = z.object({
  delta: z.coerce
    .number({ error: 'Escribe la cantidad' })
    .int({ error: 'Debe ser un número entero' })
    .min(-10_000, { error: 'Cantidad demasiado grande' })
    .max(10_000, { error: 'Cantidad demasiado grande' })
    .refine((v) => v !== 0, { error: 'La cantidad no puede ser cero' }),
  reason: z.enum(STOCK_ADJUSTMENT_REASONS, { error: 'Elige el motivo' }),
  note: optionalText(200),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export const inventoryQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  low: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Dashboard ──────────────────────────────────────────────────────────────────────────────────

export const dashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
});
