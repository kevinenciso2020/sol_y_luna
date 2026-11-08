import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS, type Role } from '@sol-y-luna/shared';
import { randomToken } from './crypto.js';

export const JWT_ISSUER = 'sol-y-luna-api';
/** Audience of access tokens (Bearer, used by the browser through the BFF). */
export const ACCESS_AUDIENCE = 'sol-y-luna-web';
/** Audience of the page-session cookie (only used to gate SSR pages). Never valid as Bearer. */
export const SESSION_AUDIENCE = 'sol-y-luna-pages';

export interface TokenClaims {
  userId: string;
  role: Role;
  familyId: string;
  issuedAt: number; // seconds
}

export class InvalidTokenError extends Error {
  constructor(message = 'invalid token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

export interface TokenService {
  signAccessToken(input: { userId: string; role: Role; familyId: string }): Promise<string>;
  verifyAccessToken(token: string): Promise<TokenClaims>;
  signSessionToken(input: { userId: string; role: Role; familyId: string }): Promise<string>;
  verifySessionToken(token: string): Promise<TokenClaims>;
}

export function createTokenService(secret: string): TokenService {
  const key = new TextEncoder().encode(secret);

  async function sign(
    input: { userId: string; role: Role; familyId: string },
    audience: string,
    ttlSeconds: number,
  ) {
    return new SignJWT({ role: input.role, fam: input.familyId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(JWT_ISSUER)
      .setAudience(audience)
      .setSubject(input.userId)
      .setJti(randomToken(16))
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(key);
  }

  async function verify(token: string, audience: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: JWT_ISSUER,
        audience,
        algorithms: ['HS256'],
      });
      const role = payload['role'];
      const fam = payload['fam'];
      if (
        typeof payload.sub !== 'string' ||
        typeof fam !== 'string' ||
        (role !== 'ADMIN' && role !== 'OPERATOR' && role !== 'CUSTOMER') ||
        typeof payload.iat !== 'number' ||
        typeof payload.jti !== 'string'
      ) {
        throw new InvalidTokenError('malformed claims');
      }
      return { userId: payload.sub, role, familyId: fam, issuedAt: payload.iat };
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      if (error instanceof joseErrors.JOSEError) throw new InvalidTokenError(error.code);
      throw error;
    }
  }

  return {
    signAccessToken: (input) => sign(input, ACCESS_AUDIENCE, ACCESS_TOKEN_TTL_SECONDS),
    verifyAccessToken: (token) => verify(token, ACCESS_AUDIENCE),
    signSessionToken: (input) => sign(input, SESSION_AUDIENCE, REFRESH_TOKEN_TTL_DAYS * 86_400),
    verifySessionToken: (token) => verify(token, SESSION_AUDIENCE),
  };
}
