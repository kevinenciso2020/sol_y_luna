import { Router, type Router as ExpressRouter } from 'express';

/** Minimal role-gated endpoints. Phase 3 and 6 mount the real admin/operator APIs here. */
export function panelRouter(): ExpressRouter {
  const router = Router();
  router.get('/status', (req, res) => {
    res.json({ ok: true, role: req.auth!.role });
  });
  return router;
}
