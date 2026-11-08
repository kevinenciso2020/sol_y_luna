import { z } from 'zod';

/** Reusable Zod building blocks with Spanish (Colombia) messages. */

export const copAmountSchema = z
  .number({ error: 'Debe ser un número' })
  .int({ error: 'El valor debe ser un número entero de pesos' })
  .nonnegative({ error: 'El valor no puede ser negativo' });

export const slugSchema = z
  .string({ error: 'Debe ser un texto' })
  .min(1, { error: 'El slug es obligatorio' })
  .max(120, { error: 'El slug es demasiado largo' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'Usa solo minúsculas, números y guiones',
  });

export const emailSchema = z
  .email({ error: 'Escribe un correo válido' })
  .max(254, { error: 'El correo es demasiado largo' })
  .transform((value) => value.trim().toLowerCase());

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1, { error: 'La página mínima es 1' }).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100, { error: 'Máximo 100 resultados por página' })
    .default(24),
});
export type Pagination = z.infer<typeof paginationSchema>;
