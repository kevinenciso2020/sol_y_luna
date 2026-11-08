import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter, type HealthDeps } from './routes/health.js';

export type AppDeps = HealthDeps;

export function createApp(env: Env, logger: Logger, deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  // Railway sits behind a single proxy hop.
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin / server-to-server requests (BFF) have no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(healthRouter(deps));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ exposeStack: env.NODE_ENV !== 'production' }));

  return app;
}
