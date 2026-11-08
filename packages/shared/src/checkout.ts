import { z } from 'zod';
import { addressInputSchema } from './address.js';
import { phoneSchema } from './auth.js';
import { emailSchema } from './schemas.js';

export const MAX_CART_QTY_PER_LINE = 200;

const variantId = z.string().regex(/^[a-z0-9]{20,40}$/, { error: 'Producto inválido' });
const quantity = z.coerce
  .number({ error: 'Cantidad inválida' })
  .int({ error: 'Cantidad inválida' })
  .min(1, { error: 'La cantidad mínima es 1' })
  .max(MAX_CART_QTY_PER_LINE, { error: `La cantidad máxima es ${MAX_CART_QTY_PER_LINE}` });

export const addToCartSchema = z.object({ variantId, quantity: quantity.default(1) });
export const updateCartItemSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(MAX_CART_QTY_PER_LINE),
});

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,30}$/, { error: 'Código de cupón inválido' });

export const CHECKOUT_PROVIDERS = ['MOCK', 'MERCADOPAGO', 'WOMPI'] as const;

export const checkoutSchema = z
  .object({
    contact: z.object({
      name: z.string().trim().min(2, { error: 'Escribe tu nombre' }).max(80),
      email: emailSchema,
      phone: phoneSchema,
      documentNumber: z
        .string()
        .trim()
        .regex(/^[0-9A-Za-z.-]{5,20}$/, { error: 'Documento inválido' })
        .optional()
        .or(z.literal('').transform(() => undefined)),
    }),
    address: addressInputSchema.optional(),
    addressId: z
      .string()
      .regex(/^[a-z0-9]{20,40}$/)
      .optional(),
    saveAddress: z.boolean().default(false),
    discreetPackaging: z.boolean().default(false),
    notes: z.string().trim().max(500).optional(),
    couponCode: couponCodeSchema.optional().or(z.literal('').transform(() => undefined)),
    paymentProvider: z.enum(CHECKOUT_PROVIDERS, { error: 'Elige un medio de pago' }),
    acceptTerms: z.literal(true, { error: 'Debes aceptar los términos y condiciones' }),
    acceptDataPolicy: z.literal(true, {
      error: 'Debes aceptar la política de tratamiento de datos',
    }),
    turnstileToken: z.string().max(4096).optional(),
  })
  .refine((c) => Boolean(c.address) !== Boolean(c.addressId), {
    error: 'Escribe la dirección de entrega',
    path: ['address'],
  });
export type CheckoutInput = z.infer<typeof checkoutSchema>;
