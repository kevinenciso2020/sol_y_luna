import type { RequestHandler } from 'express';
import type { Role } from '@sol-y-luna/shared';
import { HttpError } from '../lib/http-error.js';
import { InvalidTokenError, type TokenService } from '../lib/tokens.js';
import type { AuthService } from '../services/auth.service.js';

const unauthorized = () => new HttpError(401, 'Debes iniciar sesión', 'UNAUTHORIZED');

/**
 * Verifies the Bearer access token and re-checks the user in the database on every request,
 * so role changes, password changes and revoked sessions take effect immediately.
 */
export function requireAuth(deps: { tokens: TokenService; auth: AuthService }): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.header('authorization');
      const match = header?.match(/^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/);
      if (!match?.[1]) throw unauthorized();

      const claims = await deps.tokens.verifyAccessToken(match[1]);
      const user = await deps.auth.getUser(claims.userId);
      if (!user) throw unauthorized();
      if (user.passwordChangedAt && claims.issuedAt * 1000 < user.passwordChangedAt.getTime()) {
        throw unauthorized();
      }
      if (!(await deps.auth.isFamilyActive(claims.familyId))) throw unauthorized();

      req.auth = { userId: user.id, role: user.role, familyId: claims.familyId };
      next();
    } catch (error) {
      next(error instanceof InvalidTokenError ? unauthorized() : error);
    }
  };
}

/** Must run after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new HttpError(403, 'No tienes permiso para esta acción', 'FORBIDDEN'));
      return;
    }
    next();
  };
}

/**
 * CSRF guard for endpoints authenticated by cookie (refresh, logout): requires a custom header,
 * which cross-site forms cannot send, and an allowed Origin when the browser provides one.
 */
export function requireSameSiteRequest(allowedOrigins: string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.header('origin');
    if (req.header('x-syl-csrf') !== '1' || (origin && !allowedOrigins.includes(origin))) {
      next(new HttpError(403, 'Petición no permitida', 'CSRF'));
      return;
    }
    next();
  };
}
