import { z } from 'zod';
import { AUDIENCES, INVIMA_STATUSES, PRODUCT_STATUSES, ROLES } from './constants.js';
import { copAmountSchema, emailSchema, slugSchema } from './schemas.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `Escribe ${label}` })
    .trim()
    .min(1, { error: `Escribe ${label}` })
    .max(max, { error: `Máximo ${max} caracteres` });

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/, { error: 'Identificador inválido' });

export const PRODUCT_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'name'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Public catalog query (shareable URL params). */
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: slugSchema.optional(),
  brand: slugSchema.optional(),
  audience: z.enum(AUDIENCES, { error: 'Audiencia inválida' }).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  invima: z
    .enum(['1', 'true'])
    .transform(() => true)
    .optional(),
  featured: z
    .enum(['1', 'true'])
    .transform(() => true)
    .optional(),
  sort: z.enum(PRODUCT_SORTS).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const variantInputSchema = z
  .object({
    id: idSchema.optional(),
    name: requiredText('la presentación', 60),
    sku: z
      .string({ error: 'Escribe el SKU' })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, { error: 'SKU: de 3 a 40 letras, números o guiones' }),
    retailPrice: copAmountSchema.min(1, { error: 'El precio debe ser mayor que cero' }),
    compareAtPrice: copAmountSchema.nullable().optional(),
    wholesalePrice: copAmountSchema.nullable().optional(),
    wholesaleMinQty: z.coerce
      .number()
      .int()
      .min(1, { error: 'Mínimo 1 unidad' })
      .max(10_000)
      .default(6),
    stock: z.coerce
      .number()
      .int()
      .min(0, { error: 'El stock no puede ser negativo' })
      .max(1_000_000),
    weightGrams: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.compareAtPrice == null || v.compareAtPrice > v.retailPrice, {
    error: 'El precio antes debe ser mayor que el precio actual',
    path: ['compareAtPrice'],
  })
  .refine((v) => v.wholesalePrice == null || v.wholesalePrice <= v.retailPrice, {
    error: 'El precio mayorista no puede ser mayor que el precio detal',
    path: ['wholesalePrice'],
  });
export type VariantInput = z.infer<typeof variantInputSchema>;

export const productImageInputSchema = z.object({
  id: idSchema.optional(),
  publicId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^(\/placeholders\/[a-z0-9-]+\.svg|[\w/-]+)$/, { error: 'Imagen inválida' }),
  alt: requiredText('el texto alternativo', 160),
});

export const productInputSchema = z
  .object({
    name: requiredText('el nombre', 120),
    slug: slugSchema,
    shortDescription: optionalText(240),
    description: optionalText(5000),
    benefits: z
      .array(z.string().trim().min(1).max(160))
      .max(12, { error: 'Máximo 12 beneficios' })
      .default([]),
    usage: optionalText(2000),
    ingredients: optionalText(2000),
    warnings: optionalText(2000),
    categoryId: idSchema.nullable().optional(),
    brandId: idSchema.nullable().optional(),
    audience: z.enum(AUDIENCES).default('UNISEX'),
    isAdult: z.boolean().default(false),
    invimaStatus: z.enum(INVIMA_STATUSES),
    invimaCode: optionalText(60),
    disclaimer: optionalText(500),
    status: z.enum(PRODUCT_STATUSES).default('DRAFT'),
    featured: z.boolean().default(false),
    seoTitle: optionalText(70),
    seoDescription: optionalText(170),
    variants: z
      .array(variantInputSchema)
      .min(1, { error: 'Agrega al menos una presentación' })
      .max(30, { error: 'Máximo 30 presentaciones' }),
    images: z.array(productImageInputSchema).max(12, { error: 'Máximo 12 imágenes' }).default([]),
  })
  .refine((p) => p.invimaStatus !== 'REGISTERED' || Boolean(p.invimaCode), {
    error: 'Escribe el número de registro INVIMA',
    path: ['invimaCode'],
  })
  .refine((p) => new Set(p.variants.map((v) => v.sku)).size === p.variants.length, {
    error: 'Hay SKU repetidos entre las presentaciones',
    path: ['variants'],
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export const adminProductQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum([...PRODUCT_STATUSES, 'ALL']).default('ALL'),
  categoryId: z.union([idSchema, z.literal('none')]).optional(),
  brandId: idSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const categoryInputSchema = z.object({
  name: requiredText('el nombre', 80),
  slug: slugSchema,
  description: optionalText(500),
  image: optionalText(255),
  parentId: idSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
  isAdult: z.boolean().default(false),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: 'Color en formato #RRGGBB' });
export const brandThemeSchema = z
  .object({
    mode: z.enum(['light', 'dark']).optional(),
    style: z.string().max(40).optional(),
    background: hexColor.optional(),
    accent: hexColor.optional(),
    accent2: hexColor.optional(),
  })
  .strict();

export const brandInputSchema = z.object({
  name: requiredText('el nombre', 80),
  slug: slugSchema,
  logo: optionalText(255),
  description: optionalText(1000),
  theme: brandThemeSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type BrandInput = z.infer<typeof brandInputSchema>;

export const couponInputSchema = z
  .object({
    code: z
      .string({ error: 'Escribe el código' })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,30}$/, { error: 'Código: de 3 a 30 letras o números, sin espacios' }),
    description: optionalText(200),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.coerce.number().int().min(1, { error: 'El valor debe ser mayor que cero' }),
    minSubtotal: copAmountSchema.default(0),
    maxUses: z.coerce.number().int().min(1).nullable().optional(),
    maxUsesPerUser: z.coerce.number().int().min(1).nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    isActive: z.boolean().default(true),
    appliesToWholesale: z.boolean().default(false),
  })
  .refine((c) => c.type !== 'PERCENT' || c.value <= 100, {
    error: 'El porcentaje máximo es 100',
    path: ['value'],
  })
  .refine((c) => !c.startsAt || !c.endsAt || c.endsAt > c.startsAt, {
    error: 'La fecha final debe ser posterior a la inicial',
    path: ['endsAt'],
  });
export type CouponInput = z.infer<typeof couponInputSchema>;

export const adminUserQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  role: z.enum([...ROLES, 'ALL']).default('ALL'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminUserCreateSchema = z.object({
  name: requiredText('el nombre', 80),
  email: emailSchema,
  phone: optionalText(20),
  role: z.enum(ROLES),
});

export const adminUserUpdateSchema = z.object({
  name: requiredText('el nombre', 80),
  phone: optionalText(20),
  role: z.enum(ROLES),
});

export const storeSettingsInputSchema = z.object({
  storeName: requiredText('el nombre de la tienda', 80),
  whatsappNumber: z
    .string()
    .trim()
    .regex(/^(\d{10,15})?$/, { error: 'Solo dígitos con indicativo, por ejemplo 573001234567' })
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  contactEmail: emailSchema.nullable().optional(),
  supportEmail: emailSchema.nullable().optional(),
  instagramUrl: z.url({ error: 'URL inválida' }).nullable().optional(),
  legalTerms: z.string().max(50_000),
  legalPrivacy: z.string().max(50_000),
  legalWithdrawal: z.string().max(50_000),
  legalShipping: z.string().max(50_000),
  legalReturns: z.string().max(50_000),
  settlementFrequency: z.enum(['BIWEEKLY', 'MONTHLY']),
  lowStockThreshold: z.coerce.number().int().min(0).max(1000),
});

export const auditQuerySchema = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  actorId: idSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/** "Saúco Negro + Zinc" -> "sauco-negro-zinc" */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export const PLACEHOLDER_IMAGES = ['frasco', 'gotero', 'tubo', 'spray', 'lata'] as const;
