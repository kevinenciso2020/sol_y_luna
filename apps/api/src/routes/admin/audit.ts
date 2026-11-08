import { Router, type Router as ExpressRouter } from 'express';
import { auditQuerySchema } from '@sol-y-luna/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { handler } from '../../lib/async.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import type { Db } from '../../lib/prisma.js';

export function adminAuditRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (req, res) => {
      const query = auditQuerySchema.parse(req.query);
      const where: Prisma.AuditLogWhereInput = {};
      if (query.entity) where.entity = query.entity;
      if (query.entityId) where.entityId = query.entityId;
      if (query.actorId) where.actorId = query.actorId;
      const [total, rows] = await Promise.all([
        db.auditLog.count({ where }),
        db.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { name: true, email: true } } },
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      res.json({ data: rows, meta: pageMeta(query.page, query.pageSize, total) });
    }),
  );

  return router;
}
