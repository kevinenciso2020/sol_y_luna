import type { Role } from '@sol-y-luna/shared';

declare global {
  namespace Express {
    interface Request {
      /** Real client IP (forwarded by the BFF when trusted, otherwise req.ip). */
      clientIp: string;
      /** Set by requireAuth. */
      auth?: { userId: string; role: Role; familyId: string };
    }
  }
}

export {};
