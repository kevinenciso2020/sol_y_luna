import { z } from 'zod';
import { phoneSchema } from './auth.js';
import { WHOLESALE_STATUSES, type WholesaleStatus } from './constants.js';

/** Phase 7: profile, wishlist, reviews and wholesale requests. */

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/, { error: 'Identificador inválido' });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const WHOLESALE_STATUS_LABELS: Readonly<Record<WholesaleStatus, string>> = {
  NONE: 'Sin solicitud',
  PENDING: 'En revisión',
  APPROVED: 'Aprobada',
  REJECTED: 'No aprobada',
};

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  PENDING: 'En moderación',
  APPROVED: 'Publicada',
  REJECTED: 'No publicada',
};

export const profileUpdateSchema = z.object({
  name: z
    .string({ error: 'Escribe tu nombre' })
    .trim()
    .min(2, { error: 'Escribe tu nombre' })
    .max(80, { error: 'El nombre es demasiado largo' }),
  phone: phoneSchema
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  documentNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z.-]{5,20}$/, { error: 'Documento inválido' })
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const productIdSchema = z.object({ productId: idSchema });

export const reviewInputSchema = z.object({
  productId: idSchema,
  rating: z.coerce
    .number({ error: 'Elige de 1 a 5 estrellas' })
    .int({ error: 'Elige de 1 a 5 estrellas' })
    .min(1, { error: 'Elige de 1 a 5 estrellas' })
    .max(5, { error: 'Elige de 1 a 5 estrellas' }),
  title: optionalText(80),
  comment: optionalText(1000),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const reviewModerationSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED'], { error: 'Elige publicar o rechazar' }),
});

export const adminReviewQuerySchema = z.object({
  status: z.enum([...REVIEW_STATUSES, 'ALL']).default('PENDING'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const publicReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const wholesaleRequestSchema = z.object({
  businessName: z
    .string({ error: 'Escribe el nombre de tu negocio' })
    .trim()
    .min(2, { error: 'Escribe el nombre de tu negocio' })
    .max(120, { error: 'Máximo 120 caracteres' }),
  note: optionalText(500),
});
export type WholesaleRequestInput = z.infer<typeof wholesaleRequestSchema>;

export const wholesaleDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED'], { error: 'Elige aprobar o rechazar' }),
});

export const wholesaleQuerySchema = z.object({
  status: z.enum([...WHOLESALE_STATUSES, 'ALL']).default('PENDING'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const accountOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
