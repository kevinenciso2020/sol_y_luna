import { EnvValidationError, loadEnv, type Env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createApp } from './app.js';

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
const app = createApp(env, logger, {
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
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
