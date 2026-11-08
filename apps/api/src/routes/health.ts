import { Router, type Router as ExpressRouter } from 'express';

export interface HealthDeps {
  /** Resolves when the database answers; rejects otherwise. */
  checkDatabase: () => Promise<void>;
}

export function healthRouter(deps: HealthDeps): ExpressRouter {
  const router = Router();
  router.get('/health', async (req, res) => {
    const started = Date.now();
    try {
      await deps.checkDatabase();
      res.json({
        status: 'ok',
        database: 'ok',
        dbLatencyMs: Date.now() - started,
        uptime: Math.round(process.uptime()),
      });
    } catch (error) {
      req.log.error({ err: error }, 'health check: database unreachable');
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });
  return router;
}
