import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import type { Db } from './lib/prisma.js';
import { createTokenService } from './lib/tokens.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { clientIp } from './middleware/client-ip.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { DEFAULT_RATE_LIMITS, limiter, type RateLimits } from './middleware/rate-limit.js';
import { addressesRouter } from './routes/addresses.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { panelRouter } from './routes/panel.js';
import { createAuthService } from './services/auth.service.js';
import type { EmailSender } from './services/email.js';
import type { TurnstileVerifier } from './services/turnstile.js';

export interface AppDeps {
  db: Db;
  email: EmailSender;
  turnstile: TurnstileVerifier;
  checkDatabase: () => Promise<void>;
  rateLimits?: RateLimits;
}

export function createApp(env: Env, logger: Logger, deps: AppDeps): Express {
  const app = express();
  const rateLimits = deps.rateLimits ?? DEFAULT_RATE_LIMITS;
  const tokens = createTokenService(env.JWT_ACCESS_SECRET);
  const auth = createAuthService({
    db: deps.db,
    tokens,
    email: deps.email,
    logger,
    pepper: env.REFRESH_TOKEN_PEPPER,
    webUrl: env.WEB_URL,
  });
  const secureCookies = env.NODE_ENV === 'production';

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
  app.use(clientIp(env.BFF_SHARED_SECRET));
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
  app.use(cookieParser());

  app.use(healthRouter({ checkDatabase: deps.checkDatabase }));

  const api = express.Router();
  api.use(limiter(rateLimits.global));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(
    '/auth',
    authRouter({
      auth,
      tokens,
      turnstile: deps.turnstile,
      rateLimits,
      secureCookies,
      allowedOrigins: env.CORS_ORIGINS,
    }),
  );

  const authenticated = requireAuth({ tokens, auth });
  api.use('/account/addresses', authenticated, addressesRouter({ db: deps.db }));
  api.use('/admin', authenticated, requireRole('ADMIN'), panelRouter());
  api.use('/operator', authenticated, requireRole('ADMIN', 'OPERATOR'), panelRouter());

  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ exposeStack: env.NODE_ENV !== 'production' }));

  return app;
}
