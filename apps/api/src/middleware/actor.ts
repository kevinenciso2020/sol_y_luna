import type { Request } from 'express';
import type { AuditActor } from '../services/audit.js';

export const actorFrom = (req: Request): AuditActor => ({
  userId: req.auth!.userId,
  role: req.auth!.role,
  ip: req.clientIp,
  userAgent: req.header('user-agent'),
});
