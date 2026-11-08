import argon2 from 'argon2';
import type { Role } from '@sol-y-luna/shared';
import { createApp } from '../app.js';
import { createLogger } from '../lib/logger.js';
import { createPrismaClient, type Db } from '../lib/prisma.js';
import { DEFAULT_RATE_LIMITS, type RateLimits } from '../middleware/rate-limit.js';
import type { CloudinaryService } from '../services/cloudinary.js';
import type { MercadoPago } from '../services/payments/mercadopago.js';
import { createMemoryEmailSender } from '../services/email.js';
import { testEnv } from './fixtures.js';

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

let db: Db | undefined;
export function getTestDb(): Db {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL no está definida');
  db ??= createPrismaClient(TEST_DATABASE_URL);
  return db;
}

/** Empties every table except Prisma's migration history. */
export async function resetDatabase() {
  const client = getTestDb();
  const tables = await client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '')}"`).join(', ');
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

const noLimits: RateLimits = Object.fromEntries(
  Object.keys(DEFAULT_RATE_LIMITS).map((key) => [key, { limit: 0, windowMs: 60_000 }]),
) as unknown as RateLimits;

export function buildTestApp(
  options: {
    rateLimits?: RateLimits;
    turnstileOk?: boolean;
    cloudinary?: CloudinaryService;
    env?: Record<string, string>;
    mercadoPago?: MercadoPago | null;
  } = {},
) {
  const email = createMemoryEmailSender();
  const env = testEnv(options.env);
  const app = createApp(env, createLogger({ level: 'silent', pretty: false }), {
    db: getTestDb(),
    email,
    turnstile: { verify: async () => options.turnstileOk ?? true },
    checkDatabase: async () => {},
    rateLimits: options.rateLimits ?? noLimits,
    ...(options.cloudinary ? { cloudinary: options.cloudinary } : {}),
    ...(options.mercadoPago !== undefined ? { mercadoPago: options.mercadoPago } : {}),
  });
  return { app, email, env };
}

export const TEST_PASSWORD = 'clave-segura-123';

export async function createUser(input: {
  email: string;
  role?: Role;
  name?: string;
  password?: string;
}) {
  return getTestDb().user.create({
    data: {
      email: input.email,
      name: input.name ?? 'Usuario de prueba',
      role: input.role ?? 'CUSTOMER',
      passwordHash: await argon2.hash(input.password ?? TEST_PASSWORD, { type: argon2.argon2id }),
    },
  });
}

/** Extracts a token from an email link (…?token=XYZ). */
export function tokenFromEmail(text: string): string {
  const match = text.match(/[?&]token=([\w%-]+)/);
  if (!match?.[1]) throw new Error('El email no contiene un token');
  return decodeURIComponent(match[1]);
}

/** Parses Set-Cookie headers into name -> value. */
export function cookiesFrom(setCookie: string | string[] | undefined): Record<string, string> {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return Object.fromEntries(
    list.map((c) => {
      const [pair = ''] = c.split(';');
      const index = pair.indexOf('=');
      return [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
    }),
  );
}
