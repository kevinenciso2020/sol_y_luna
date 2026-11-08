import { z } from 'zod';

export const idParams = z.object({
  id: z.string().regex(/^[a-z0-9]{20,40}$/, { error: 'Identificador inválido' }),
});
