import { z } from 'zod';

/** Treat empty strings from .env files as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const required = (name: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string({ error: `Falta la variable de entorno ${name}` })
      .min(1, { error: `Falta la variable de entorno ${name}` }),
  );

const secret = (name: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string({ error: `Falta la variable de entorno ${name}` })
      .min(32, { error: `${name} debe tener al menos 32 caracteres` }),
  );

const urlVar = (name: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url({ error: `${name} debe ser una URL válida (falta o tiene un formato incorrecto)` }),
  );

const encryptionKey = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string({ error: 'Falta la variable de entorno ENCRYPTION_KEY' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      error: 'ENCRYPTION_KEY debe ser 32 bytes en base64 (genera una con: openssl rand -base64 32)',
    }),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // Database (Neon)
    DATABASE_URL: required('DATABASE_URL'),
    DIRECT_URL: optional(z.string()),

    // Auth & crypto
    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    REFRESH_TOKEN_PEPPER: secret('REFRESH_TOKEN_PEPPER'),
    ENCRYPTION_KEY: encryptionKey,

    // URLs
    CORS_ORIGINS: required('CORS_ORIGINS').transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    WEB_URL: urlVar('WEB_URL'),
    API_URL: urlVar('API_URL'),

    // Payments
    PAYMENTS_MODE: z.enum(['demo', 'live']).default('demo'),
    MP_MODE: z.enum(['marketplace', 'direct']).default('marketplace'),
    MP_CLIENT_ID: optional(z.string()),
    MP_CLIENT_SECRET: optional(z.string()),
    MP_ACCESS_TOKEN: optional(z.string()),
    MP_PUBLIC_KEY: optional(z.string()),
    MP_WEBHOOK_SECRET: optional(z.string()),
    MP_REDIRECT_URI: optional(z.url()),
    WOMPI_PUBLIC_KEY: optional(z.string()),
    WOMPI_PRIVATE_KEY: optional(z.string()),
    WOMPI_INTEGRITY_SECRET: optional(z.string()),
    WOMPI_EVENTS_SECRET: optional(z.string()),
    WOMPI_ENV: z.enum(['sandbox', 'production']).default('sandbox'),

    // Images
    CLOUDINARY_CLOUD_NAME: optional(z.string()),
    CLOUDINARY_API_KEY: optional(z.string()),
    CLOUDINARY_API_SECRET: optional(z.string()),
    CLOUDINARY_FOLDER: z.string().default('sol-y-luna'),

    // Email
    RESEND_API_KEY: optional(z.string()),
    EMAIL_FROM: z.string().default('Sol y Luna Store <no-reply@example.com>'),

    // Anti-bot & observability
    TURNSTILE_SECRET_KEY: optional(z.string()),
    SENTRY_DSN: optional(z.url()),

    // Seed users (only read by the seed script)
    ADMIN_SEED_EMAIL: optional(z.email()),
    ADMIN_SEED_PASSWORD: optional(z.string()),
    OPERATOR_SEED_EMAIL: optional(z.email()),
    OPERATOR_SEED_PASSWORD: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'Falta la variable de entorno TURNSTILE_SECRET_KEY (obligatoria en producción)',
      });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS no puede ser "*" en producción',
      });
    }
  });

type ParsedEnv = z.infer<typeof envSchema>;

export interface Features {
  /** Effective payment providers. `mock` is used whenever no real provider is configured. */
  payments: { mock: boolean; mercadopago: boolean; wompi: boolean };
  cloudinary: boolean;
  email: boolean;
  turnstile: boolean;
  sentry: boolean;
}

export type Env = ParsedEnv & { features: Features };

function computeFeatures(env: ParsedEnv): Features {
  const live = env.PAYMENTS_MODE === 'live';
  const mpBase = Boolean(env.MP_WEBHOOK_SECRET && env.MP_PUBLIC_KEY);
  const mpReady =
    env.MP_MODE === 'direct'
      ? mpBase && Boolean(env.MP_ACCESS_TOKEN)
      : mpBase && Boolean(env.MP_CLIENT_ID && env.MP_CLIENT_SECRET && env.MP_REDIRECT_URI);
  const wompiReady = Boolean(
    env.WOMPI_PUBLIC_KEY &&
    env.WOMPI_PRIVATE_KEY &&
    env.WOMPI_INTEGRITY_SECRET &&
    env.WOMPI_EVENTS_SECRET,
  );
  const mercadopago = live && mpReady;
  const wompi = live && wompiReady;
  return {
    payments: { mercadopago, wompi, mock: !mercadopago && !wompi },
    cloudinary: Boolean(
      env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
    ),
    email: Boolean(env.RESEND_API_KEY),
    turnstile: Boolean(env.TURNSTILE_SECRET_KEY),
    sentry: Boolean(env.SENTRY_DSN),
  };
}

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuración inválida de variables de entorno:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Parses and validates the environment. Throws EnvValidationError listing every problem. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.');
      return issue.message.includes(key) ? issue.message : `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return { ...result.data, features: computeFeatures(result.data) };
}
