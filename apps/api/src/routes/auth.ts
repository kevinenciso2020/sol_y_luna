import { Router, type Router as ExpressRouter, type Request } from 'express';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@sol-y-luna/shared';
import { handler } from '../lib/async.js';
import { clearAuthCookies, setAuthCookies } from '../lib/cookies.js';
import { HttpError } from '../lib/http-error.js';
import { InvalidTokenError, type TokenService } from '../lib/tokens.js';
import { requireAuth, requireSameSiteRequest } from '../middleware/auth.js';
import { limiter, type RateLimits } from '../middleware/rate-limit.js';
import { toUserDto, type AuthService, type IssuedSession } from '../services/auth.service.js';
import type { TurnstileVerifier } from '../services/turnstile.js';

export interface AuthRouterDeps {
  auth: AuthService;
  tokens: TokenService;
  turnstile: TurnstileVerifier;
  rateLimits: RateLimits;
  secureCookies: boolean;
  allowedOrigins: string[];
}

const ctx = (req: Request) => ({ ip: req.clientIp, userAgent: req.header('user-agent') });

const readCookie = (req: Request, name: string): string | undefined => {
  const value: unknown = req.cookies?.[name];
  return typeof value === 'string' && value.length > 0 && value.length < 2048 ? value : undefined;
};

export function authRouter(deps: AuthRouterDeps): ExpressRouter {
  const router = Router();
  const { auth, tokens, turnstile, rateLimits, secureCookies } = deps;
  const authenticated = requireAuth({ tokens, auth });
  const sameSite = requireSameSiteRequest(deps.allowedOrigins);

  async function assertHuman(req: Request, token: string | undefined) {
    if (!(await turnstile.verify(token, req.clientIp))) {
      throw new HttpError(
        400,
        'No pudimos verificar que eres una persona. Intenta de nuevo.',
        'TURNSTILE_FAILED',
      );
    }
  }

  const sendSession = (
    res: Parameters<Parameters<typeof handler>[0]>[1],
    session: IssuedSession,
    status = 200,
  ) => {
    setAuthCookies(res, session, secureCookies);
    res
      .status(status)
      .json({ accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user });
  };

  router.post(
    '/register',
    limiter(rateLimits.register),
    handler(async (req, res) => {
      const input = registerSchema.parse(req.body);
      await assertHuman(req, input.turnstileToken);
      await auth.register(input);
      // Same answer whether or not the email already had an account.
      res.status(201).json({
        message: 'Listo. Te enviamos un correo para confirmar tu cuenta. Ya puedes ingresar.',
      });
    }),
  );

  router.post(
    '/login',
    limiter(rateLimits.login),
    handler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      await assertHuman(req, input.turnstileToken);
      sendSession(res, await auth.login(input, ctx(req)));
    }),
  );

  router.post(
    '/refresh',
    limiter(rateLimits.refresh),
    sameSite,
    handler(async (req, res) => {
      const presented = readCookie(req, REFRESH_COOKIE);
      if (!presented)
        throw new HttpError(401, 'Tu sesión expiró. Ingresa de nuevo.', 'SESSION_EXPIRED');
      try {
        sendSession(res, await auth.refresh(presented, ctx(req)));
      } catch (error) {
        clearAuthCookies(res, secureCookies);
        throw error;
      }
    }),
  );

  router.post(
    '/logout',
    sameSite,
    handler(async (req, res) => {
      await auth.logout(readCookie(req, REFRESH_COOKIE));
      clearAuthCookies(res, secureCookies);
      res.status(204).end();
    }),
  );

  /** Used by the Astro middleware to gate /admin, /operador and /cuenta pages server side. */
  router.get(
    '/session',
    handler(async (req, res) => {
      const token = readCookie(req, SESSION_COOKIE);
      if (!token) throw new HttpError(401, 'Debes iniciar sesión', 'UNAUTHORIZED');
      try {
        const claims = await tokens.verifySessionToken(token);
        const user = await auth.getUser(claims.userId);
        if (!user || !(await auth.isFamilyActive(claims.familyId))) {
          throw new HttpError(401, 'Debes iniciar sesión', 'UNAUTHORIZED');
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ user: toUserDto(user) });
      } catch (error) {
        if (error instanceof InvalidTokenError)
          throw new HttpError(401, 'Debes iniciar sesión', 'UNAUTHORIZED');
        throw error;
      }
    }),
  );

  router.get(
    '/me',
    authenticated,
    handler(async (req, res) => {
      const user = await auth.getUser(req.auth!.userId);
      if (!user) throw new HttpError(401, 'Debes iniciar sesión', 'UNAUTHORIZED');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ user: toUserDto(user) });
    }),
  );

  router.post(
    '/verify-email',
    limiter(rateLimits.passwordReset),
    handler(async (req, res) => {
      const { token } = verifyEmailSchema.parse(req.body);
      await auth.verifyEmail(token);
      res.json({ message: 'Tu correo quedó confirmado.' });
    }),
  );

  router.post(
    '/resend-verification',
    limiter(rateLimits.passwordReset),
    authenticated,
    handler(async (req, res) => {
      await auth.resendVerification(req.auth!.userId);
      res.json({ message: 'Te enviamos un nuevo correo de confirmación.' });
    }),
  );

  router.post(
    '/forgot-password',
    limiter(rateLimits.passwordReset),
    handler(async (req, res) => {
      const input = forgotPasswordSchema.parse(req.body);
      await assertHuman(req, input.turnstileToken);
      await auth.forgotPassword(input.email);
      res.json({
        message:
          'Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña. Vence en 30 minutos.',
      });
    }),
  );

  router.post(
    '/reset-password',
    limiter(rateLimits.passwordReset),
    handler(async (req, res) => {
      const input = resetPasswordSchema.parse(req.body);
      await auth.resetPassword(input.token, input.password);
      clearAuthCookies(res, secureCookies);
      res.json({ message: 'Tu contraseña cambió. Ingresa con la nueva.' });
    }),
  );

  router.post(
    '/change-password',
    limiter(rateLimits.passwordReset),
    authenticated,
    handler(async (req, res) => {
      const input = changePasswordSchema.parse(req.body);
      sendSession(res, await auth.changePassword(req.auth!.userId, input, ctx(req)));
    }),
  );

  return router;
}
