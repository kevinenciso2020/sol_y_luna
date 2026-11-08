import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token (default 32 bytes of entropy). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Keyed hash used to store opaque tokens (refresh, email). The pepper never touches the DB. */
export function hashToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('base64url');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Compare against itself to keep timing uniform, then fail.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
