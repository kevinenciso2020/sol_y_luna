import type { CookieOptions, Response } from 'express';
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_DAYS,
  SESSION_COOKIE,
} from '@sol-y-luna/shared';

const maxAge = REFRESH_TOKEN_TTL_DAYS * 86_400_000;

function base(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax' };
}

export function setAuthCookies(
  res: Response,
  tokens: { refreshToken: string; sessionToken: string },
  secure: boolean,
) {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(secure),
    path: REFRESH_COOKIE_PATH,
    maxAge,
  });
  res.cookie(SESSION_COOKIE, tokens.sessionToken, { ...base(secure), path: '/', maxAge });
}

export function clearAuthCookies(res: Response, secure: boolean) {
  res.clearCookie(REFRESH_COOKIE, { ...base(secure), path: REFRESH_COOKIE_PATH });
  res.clearCookie(SESSION_COOKIE, { ...base(secure), path: '/' });
}
