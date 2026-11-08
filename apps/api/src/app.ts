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
import { optionalAuth, requireAuth, requireRole } from './middleware/auth.js';
import { clientIp } from './middleware/client-ip.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { DEFAULT_RATE_LIMITS, limiter, type RateLimits } from './middleware/rate-limit.js';
import { addressesRouter } from './routes/addresses.js';
import { adminAuditRouter } from './routes/admin/audit.js';
import { adminBrandsRouter } from './routes/admin/brands.js';
import { adminCategoriesRouter } from './routes/admin/categories.js';
import { adminCouponsRouter } from './routes/admin/coupons.js';
import { adminProductsRouter } from './routes/admin/products.js';
import { adminSettingsRouter } from './routes/admin/settings.js';
import { adminUsersRouter } from './routes/admin/users.js';
import { catalogRouter } from './routes/catalog.js';
import { uploadsRouter } from './routes/uploads.js';
import { createAdminProductsService } from './services/admin-products.service.js';
import { createCatalogService } from './services/catalog.service.js';
import { createCloudinaryService, type CloudinaryService } from './services/cloudinary.js';
import { createCartService } from './services/cart.service.js';
import { createOrdersService } from './services/orders.service.js';
import { createMercadoPago, type MercadoPago } from './services/payments/mercadopago.js';
import { createMockProvider } from './services/payments/mock.js';
import type { PaymentProvider } from './services/payments/types.js';
import { createWompiProvider } from './services/payments/wompi.js';
import { createEncryptor } from './lib/encryption.js';
import { cartRouter } from './routes/cart.js';
import { checkoutRouter } from './routes/checkout.js';
import { paymentsRouter } from './routes/payments.js';
import { adminPaymentsRouter } from './routes/admin/payments.js';
import type { PaymentProvider as ProviderId } from './generated/prisma/client.js';
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
  /** Defaults to the real Cloudinary client built from the environment. */
  cloudinary?: CloudinaryService;
  /** Overrides for tests (e.g. a Mercado Pago client with a fake fetch). */
  mercadoPago?: MercadoPago | null;
  /** Receives the orders service (used by server.ts to start the scheduler). */
  onReady?: (services: { orders: ReturnType<typeof createOrdersService> }) => void;
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
  const cloudinary =
    deps.cloudinary ??
    createCloudinaryService(
      env.features.cloudinary
        ? {
            cloudName: env.CLOUDINARY_CLOUD_NAME!,
            apiKey: env.CLOUDINARY_API_KEY!,
            apiSecret: env.CLOUDINARY_API_SECRET!,
            folder: env.CLOUDINARY_FOLDER,
          }
        : null,
    );
  const catalog = createCatalogService(deps.db);
  const encryptor = createEncryptor(env.ENCRYPTION_KEY);
  const mercadoPago =
    deps.mercadoPago !== undefined
      ? deps.mercadoPago
      : env.features.payments.mercadopago
        ? createMercadoPago({
            config: {
              mode: env.MP_MODE,
              clientId: env.MP_CLIENT_ID,
              clientSecret: env.MP_CLIENT_SECRET,
              accessToken: env.MP_ACCESS_TOKEN,
              webhookSecret: env.MP_WEBHOOK_SECRET!,
              redirectUri: env.MP_REDIRECT_URI,
              apiUrl: env.API_URL,
            },
            db: deps.db,
            encryptor,
            logger,
          })
        : null;
  const providers: Partial<Record<ProviderId, PaymentProvider>> = {};
  if (env.features.payments.mock) providers.MOCK = createMockProvider(env.WEB_URL);
  if (env.features.payments.wompi) {
    providers.WOMPI = createWompiProvider({
      publicKey: env.WOMPI_PUBLIC_KEY!,
      integritySecret: env.WOMPI_INTEGRITY_SECRET!,
      eventsSecret: env.WOMPI_EVENTS_SECRET!,
      env: env.WOMPI_ENV,
    });
  }
  if (mercadoPago) providers.MERCADOPAGO = mercadoPago.provider;
  const cart = createCartService({ db: deps.db, pepper: env.REFRESH_TOKEN_PEPPER });
  const orders = createOrdersService({
    db: deps.db,
    cart,
    email: deps.email,
    logger,
    pepper: env.REFRESH_TOKEN_PEPPER,
    webUrl: env.WEB_URL,
    providers,
  });
  deps.onReady?.({ orders });
  const adminProducts = createAdminProductsService({ db: deps.db, cloudinary });

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
      cart,
    }),
  );

  const authenticated = requireAuth({ tokens, auth });
  api.use('/catalog', optionalAuth({ tokens, auth }), catalogRouter({ catalog, db: deps.db }));
  api.use('/account/addresses', authenticated, addressesRouter({ db: deps.db }));
  const maybeAuth = optionalAuth({ tokens, auth });
  api.use('/cart', maybeAuth, cartRouter({ cart, secureCookies }));
  // Optional auth only where it matters (checkout, orders, payments); webhooks never need it.
  api.use(['/checkout', '/orders', '/payments'], maybeAuth);
  api.use(
    checkoutRouter({
      orders,
      turnstile: deps.turnstile,
      db: deps.db,
      rate: rateLimits.sensitive,
      secureCookies,
      demoMode: env.PAYMENTS_MODE === 'demo',
      mercadoPagoNeedsAccount: env.MP_MODE === 'marketplace',
    }),
  );
  api.use(
    paymentsRouter({
      orders,
      logger,
      rate: rateLimits.webhooks,
      mockEnabled: Boolean(providers.MOCK),
      wompiEventsSecret: env.features.payments.wompi ? env.WOMPI_EVENTS_SECRET : undefined,
      mercadoPago,
      stateSecret: env.JWT_ACCESS_SECRET,
      webUrl: env.WEB_URL,
    }),
  );
  api.use(
    '/uploads',
    authenticated,
    requireRole('ADMIN', 'OPERATOR'),
    uploadsRouter({ cloudinary }),
  );

  const admin = express.Router();
  admin.use(authenticated, requireRole('ADMIN'));
  admin.use('/products', adminProductsRouter({ products: adminProducts }));
  admin.use('/categories', adminCategoriesRouter({ db: deps.db }));
  admin.use('/brands', adminBrandsRouter({ db: deps.db }));
  admin.use('/coupons', adminCouponsRouter({ db: deps.db }));
  admin.use('/users', adminUsersRouter({ db: deps.db, auth }));
  admin.use('/settings', adminSettingsRouter({ db: deps.db }));
  admin.use('/audit', adminAuditRouter({ db: deps.db }));
  admin.use(
    '/payments',
    adminPaymentsRouter({ db: deps.db, env, mercadoPago, stateSecret: env.JWT_ACCESS_SECRET }),
  );
  admin.use(panelRouter());
  api.use('/admin', admin);
  api.use('/operator', authenticated, requireRole('ADMIN', 'OPERATOR'), panelRouter());

  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ exposeStack: env.NODE_ENV !== 'production' }));

  return app;
}
