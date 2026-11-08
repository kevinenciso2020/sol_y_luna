import { Router, type Router as ExpressRouter } from 'express';
import { wholesaleDecisionSchema, wholesaleQuerySchema } from '@sol-y-luna/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { handler } from '../../lib/async.js';
import { HttpError } from '../../lib/http-error.js';
import type { Logger } from '../../lib/logger.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit } from '../../services/audit.js';
import type { EmailSender } from '../../services/email.js';
import { wholesaleResponseTemplate } from '../../services/email-templates.js';
import { idParams } from './params.js';

const select = {
  id: true,
  name: true,
  email: true,
  phone: true,
  wholesaleStatus: true,
  wholesaleBusinessName: true,
  wholesaleNote: true,
  wholesaleRequestedAt: true,
} satisfies Prisma.UserSelect;
type Row = Prisma.UserGetPayload<{ select: typeof select }>;

const toDto = (u: Row) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  status: u.wholesaleStatus,
  businessName: u.wholesaleBusinessName,
  note: u.wholesaleNote,
  requestedAt: u.wholesaleRequestedAt,
});

/**
 * Wholesale requests (ADMIN). Approving lets the customer see wholesale prices; the price itself
 * is still only applied by the server when the quantity reaches each presentation's minimum.
 */
export function adminWholesaleRouter(deps: {
  db: Db;
  email: EmailSender;
  logger: Logger;
  webUrl: string;
}): ExpressRouter {
  const { db, email, logger, webUrl } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (req, res) => {
      const query = wholesaleQuerySchema.parse(req.query);
      const where: Prisma.UserWhereInput =
        query.status === 'ALL'
          ? { role: 'CUSTOMER', wholesaleStatus: { not: 'NONE' } }
          : { role: 'CUSTOMER', wholesaleStatus: query.status };
      const [total, users] = await Promise.all([
        db.user.count({ where }),
        db.user.findMany({
          where,
          select,
          orderBy: { wholesaleRequestedAt: 'asc' },
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      res.json({ data: users.map(toDto), meta: pageMeta(query.page, query.pageSize, total) });
    }),
  );

  /** Approve or reject (also used to revoke an approved account). */
  router.post(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const { decision } = wholesaleDecisionSchema.parse(req.body);
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({ where: { id, role: 'CUSTOMER' }, select });
        if (!existing || existing.wholesaleStatus === 'NONE')
          throw new HttpError(404, 'Solicitud no encontrada', 'NOT_FOUND');
        if (existing.wholesaleStatus === decision)
          throw new HttpError(409, 'La solicitud ya tiene esa respuesta', 'ALREADY_DECIDED');
        const user = await tx.user.update({
          where: { id },
          data: { wholesaleStatus: decision },
          select,
        });
        await audit(tx, actorFrom(req), {
          action: 'user.wholesale.decide',
          entity: 'User',
          entityId: id,
          diff: { wholesaleStatus: { from: existing.wholesaleStatus, to: decision } },
        });
        return user;
      });
      try {
        await email.send({
          to: updated.email,
          ...wholesaleResponseTemplate({
            name: updated.name,
            approved: decision === 'APPROVED',
            link: `${webUrl.replace(/\/$/, '')}/productos`,
          }),
        });
      } catch (error) {
        logger.error({ err: error }, 'no se pudo enviar el email de mayorista');
      }
      res.json({ data: toDto(updated) });
    }),
  );

  return router;
}
