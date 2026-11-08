import argon2 from 'argon2';
import { Router, type Router as ExpressRouter } from 'express';
import {
  adminUserCreateSchema,
  adminUserQuerySchema,
  adminUserUpdateSchema,
} from '@sol-y-luna/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { handler } from '../../lib/async.js';
import { randomToken } from '../../lib/crypto.js';
import { HttpError } from '../../lib/http-error.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit } from '../../services/audit.js';
import type { AuthService } from '../../services/auth.service.js';
import { idParams } from './params.js';

const userSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  emailVerifiedAt: true,
  wholesaleStatus: true,
  lockedUntil: true,
  createdAt: true,
  _count: { select: { orders: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const toDto = ({ _count, ...u }: UserRow) => ({
  ...u,
  emailVerified: u.emailVerifiedAt !== null,
  locked: u.lockedUntil !== null && u.lockedUntil > new Date(),
  orderCount: _count.orders,
});

export function adminUsersRouter(deps: { db: Db; auth: AuthService }): ExpressRouter {
  const { db, auth } = deps;
  const router = Router();

  async function assertNotLastAdmin(tx: Prisma.TransactionClient, userId: string) {
    const admins = await tx.user.count({ where: { role: 'ADMIN', id: { not: userId } } });
    if (admins === 0)
      throw new HttpError(400, 'Debe quedar al menos un administrador', 'LAST_ADMIN');
  }

  router.get(
    '/',
    handler(async (req, res) => {
      const query = adminUserQuerySchema.parse(req.query);
      const where: Prisma.UserWhereInput = {};
      if (query.role !== 'ALL') where.role = query.role;
      if (query.q) {
        where.OR = [
          { name: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { phone: { contains: query.q } },
        ];
      }
      const [total, users] = await Promise.all([
        db.user.count({ where }),
        db.user.findMany({
          where,
          select: userSelect,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      res.json({ data: users.map(toDto), meta: pageMeta(query.page, query.pageSize, total) });
    }),
  );

  router.get(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const user = await db.user.findUnique({ where: { id }, select: userSelect });
      if (!user) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
      res.json({ data: toDto(user) });
    }),
  );

  /** Creates the account with an unusable random password and emails a link to set one. */
  router.post(
    '/',
    handler(async (req, res) => {
      const input = adminUserCreateSchema.parse(req.body);
      const created = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            phone: input.phone ?? null,
            role: input.role,
            passwordHash: await argon2.hash(randomToken(), { type: argon2.argon2id }),
          },
          select: userSelect,
        });
        await audit(tx, actorFrom(req), {
          action: 'user.create',
          entity: 'User',
          entityId: user.id,
          diff: { email: user.email, role: user.role },
        });
        return user;
      });
      await auth.forgotPassword(created.email);
      res.status(201).json({ data: toDto(created) });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const input = adminUserUpdateSchema.parse(req.body);
      const actor = actorFrom(req);
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
        if (existing.role !== input.role) {
          if (id === actor.userId)
            throw new HttpError(400, 'No puedes cambiar tu propio rol', 'SELF_ROLE_CHANGE');
          if (existing.role === 'ADMIN') await assertNotLastAdmin(tx, id);
        }
        const user = await tx.user.update({
          where: { id },
          data: { name: input.name, phone: input.phone ?? null, role: input.role },
          select: userSelect,
        });
        if (existing.role !== input.role) {
          await audit(tx, actor, {
            action: 'user.role.update',
            entity: 'User',
            entityId: id,
            diff: { email: existing.email, role: { from: existing.role, to: input.role } },
          });
        }
        if (existing.name !== input.name || (existing.phone ?? null) !== (input.phone ?? null)) {
          await audit(tx, actor, {
            action: 'user.update',
            entity: 'User',
            entityId: id,
            diff: {
              name: { from: existing.name, to: input.name },
              phone: { from: existing.phone, to: input.phone ?? null },
            },
          });
        }
        return user;
      });
      res.json({ data: toDto(updated) });
    }),
  );

  router.post(
    '/:id/unlock',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
        await audit(tx, actorFrom(req), { action: 'user.unlock', entity: 'User', entityId: id });
      });
      res.status(204).end();
    }),
  );

  /** Orders survive (user set to null); sessions and personal data are removed. */
  router.delete(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const actor = actorFrom(req);
      if (id === actor.userId)
        throw new HttpError(400, 'No puedes eliminar tu propia cuenta', 'SELF_DELETE');
      await db.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
        if (existing.role === 'ADMIN') await assertNotLastAdmin(tx, id);
        await tx.user.delete({ where: { id } });
        await audit(tx, actor, {
          action: 'user.delete',
          entity: 'User',
          entityId: id,
          diff: { email: existing.email, role: existing.role },
        });
      });
      res.status(204).end();
    }),
  );

  return router;
}
