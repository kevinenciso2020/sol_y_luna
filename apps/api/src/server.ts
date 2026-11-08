import { EnvValidationError, loadEnv, type Env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createApp } from './app.js';
import { createLogEmailSender, createResendEmailSender } from './services/email.js';
import { createTurnstileVerifier } from './services/turnstile.js';
import { startScheduler } from './jobs/scheduler.js';
import { DEFAULT_RATE_LIMITS, type RateLimits } from './middleware/rate-limit.js';

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(
      `\n❌ ${error.message}\n\nRevisa apps/api/.env (plantilla en apps/api/.env.example).\n`,
    );
    process.exit(1);
  }
  throw error;
}

const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' });
const prisma = createPrismaClient(env.DATABASE_URL);
const email = env.RESEND_API_KEY
  ? createResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, logger })
  : createLogEmailSender(logger);

const app = createApp(env, logger, {
  db: prisma,
  email,
  turnstile: createTurnstileVerifier({ secret: env.TURNSTILE_SECRET_KEY, logger }),
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  // E2E runs (NODE_ENV=test) hammer the API from one IP: relax the limits there only.
  ...(env.NODE_ENV === 'test'
    ? {
        rateLimits: Object.fromEntries(
          Object.entries(DEFAULT_RATE_LIMITS).map(([k, v]) => [k, { ...v, limit: v.limit * 50 }]),
        ) as unknown as RateLimits,
      }
    : {}),
  onReady: ({ orders }) => {
    startScheduler({ orders, logger });
  },
});

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, features: env.features },
    'Sol y Luna API escuchando',
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, 'cerrando servidor');
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
