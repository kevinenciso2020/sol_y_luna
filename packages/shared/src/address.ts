import { z } from 'zod';
import { isValidLocation } from './divipola/index.js';
import { phoneSchema } from './auth.js';

export const addressInputSchema = z
  .object({
    recipientName: z.string().trim().min(2, { error: 'Escribe el nombre de quien recibe' }).max(80),
    phone: phoneSchema,
    departmentCode: z.string().regex(/^\d{2}$/, { error: 'Selecciona un departamento' }),
    municipalityCode: z.string().regex(/^\d{5}$/, { error: 'Selecciona un municipio' }),
    addressLine: z.string().trim().min(5, { error: 'Escribe la dirección' }).max(160),
    neighborhood: z.string().trim().max(80).optional(),
    instructions: z.string().trim().max(240).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => isValidLocation(value.departmentCode, value.municipalityCode), {
    error: 'El municipio no pertenece al departamento seleccionado',
    path: ['municipalityCode'],
  });
export type AddressInput = z.infer<typeof addressInputSchema>;
