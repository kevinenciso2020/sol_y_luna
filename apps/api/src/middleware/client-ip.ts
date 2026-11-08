import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { safeEqual } from '../lib/crypto.js';

/**
 * Resolves the real client IP. Requests that come through the web BFF carry the browser IP in
 * `x-client-ip`, which is trusted only when `x-bff-secret` matches BFF_SHARED_SECRET.
 * Otherwise the IP comes from Express (`trust proxy` = 1 hop, Railway's edge).
 */
export function clientIp(sharedSecret: string | undefined): RequestHandler {
  return (req, _res, next) => {
    req.clientIp = req.ip ?? 'unknown';
    if (sharedSecret) {
      const presented = req.header('x-bff-secret');
      const forwarded = req.header('x-client-ip')?.trim();
      if (presented && forwarded && isIP(forwarded) && safeEqual(presented, sharedSecret)) {
        req.clientIp = forwarded;
      }
    }
    next();
  };
}
