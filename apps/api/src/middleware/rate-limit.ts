import { rateLimit, type Options } from 'express-rate-limit';
import type { RequestHandler } from 'express';

export interface RateLimitConfig {
  /** Max requests per window; 0 disables the limiter (tests). */
  limit: number;
  windowMs: number;
}

export interface RateLimits {
  global: RateLimitConfig;
  login: RateLimitConfig;
  register: RateLimitConfig;
  passwordReset: RateLimitConfig;
  refresh: RateLimitConfig;
  /** Used later by checkout, reviews and webhooks. */
  sensitive: RateLimitConfig;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  global: { limit: 300, windowMs: 60_000 },
  login: { limit: 20, windowMs: 15 * 60_000 },
  register: { limit: 10, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 15 * 60_000 },
  refresh: { limit: 60, windowMs: 15 * 60_000 },
  sensitive: { limit: 30, windowMs: 15 * 60_000 },
};

/**
 * In-memory store: correct for a single Railway instance. With several replicas, switch to a
 * shared store (Redis/Postgres) — see docs/DECISIONS.md.
 */
export function limiter(config: RateLimitConfig, extra: Partial<Options> = {}): RequestHandler {
  if (config.limit === 0) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.clientIp,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Hiciste demasiadas solicitudes. Espera unos minutos e intenta de nuevo.',
          requestId: String(req.id ?? ''),
        },
      });
    },
    ...extra,
  });
}
