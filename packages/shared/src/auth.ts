import { z } from 'zod';
import { emailSchema } from './schemas.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const RESET_TOKEN_TTL_MINUTES = 30;
export const VERIFY_TOKEN_TTL_HOURS = 24;

/** Cookie names and paths shared by the API and the web BFF. */
export const REFRESH_COOKIE = 'syl_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';
export const SESSION_COOKIE = 'syl_session';

export const passwordSchema = z
  .string({ error: 'Escribe una contraseña' })
  .min(PASSWORD_MIN_LENGTH, {
    error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
  })
  .max(PASSWORD_MAX_LENGTH, { error: 'La contraseña es demasiado larga' })
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    error: 'La contraseña debe tener al menos una letra y un número',
  });

const nameSchema = z
  .string({ error: 'Escribe tu nombre' })
  .trim()
  .min(2, { error: 'Escribe tu nombre' })
  .max(80, { error: 'El nombre es demasiado largo' });

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?\d[\d\s-]{6,18}$/, { error: 'Escribe un teléfono válido' });

const turnstileToken = z.string().max(4096).optional();

export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    phone: phoneSchema.optional(),
    acceptTerms: z.literal(true, {
      error: 'Debes aceptar los términos y la política de tratamiento de datos',
    }),
    turnstileToken,
  })
  .refine((data) => data.password.toLowerCase() !== data.email, {
    error: 'La contraseña no puede ser igual a tu correo',
    path: ['password'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Escribe tu contraseña' })
    .min(1, { error: 'Escribe tu contraseña' })
    .max(PASSWORD_MAX_LENGTH),
  turnstileToken,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema, turnstileToken });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, { error: 'Escribe tu contraseña actual' })
      .max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    error: 'La nueva contraseña debe ser diferente a la actual',
    path: ['newPassword'],
  });

export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: 'ADMIN' | 'OPERATOR' | 'CUSTOMER';
  emailVerified: boolean;
  wholesaleStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface AuthSessionResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUserDto;
}
