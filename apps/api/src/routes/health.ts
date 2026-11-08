import { Router, type Router as ExpressRouter } from 'express';

export function healthRouter(): ExpressRouter {
  const router = Router();
  router.get('/health', (_req, res) => {
    // Database connectivity check is added in phase 1 (Prisma).
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });
  return router;
}
