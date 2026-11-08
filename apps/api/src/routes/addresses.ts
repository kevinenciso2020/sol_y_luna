import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { addressInputSchema, getDepartmentName, getMunicipalityName } from '@sol-y-luna/shared';
import type { Address } from '../generated/prisma/client.js';
import { handler } from '../lib/async.js';
import { HttpError } from '../lib/http-error.js';
import type { Db } from '../lib/prisma.js';

const idParams = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9]+$/, { error: 'Identificador inválido' }),
});
const MAX_ADDRESSES = 10;

const toDto = (a: Address) => ({
  id: a.id,
  recipientName: a.recipientName,
  phone: a.phone,
  departmentCode: a.departmentCode,
  departmentName: getDepartmentName(a.departmentCode) ?? null,
  municipalityCode: a.municipalityCode,
  municipalityName: getMunicipalityName(a.municipalityCode) ?? null,
  addressLine: a.addressLine,
  neighborhood: a.neighborhood,
  instructions: a.instructions,
  isDefault: a.isDefault,
});

const notFound = () => new HttpError(404, 'Dirección no encontrada', 'NOT_FOUND');

/**
 * Addresses of the signed-in user. Every query is scoped by userId (IDOR protection):
 * someone else's address answers 404, never 403, so ids cannot be probed.
 */
export function addressesRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (req, res) => {
      const addresses = await db.address.findMany({
        where: { userId: req.auth!.userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      res.json({ data: addresses.map(toDto) });
    }),
  );

  router.post(
    '/',
    handler(async (req, res) => {
      const userId = req.auth!.userId;
      const input = addressInputSchema.parse(req.body);
      const created = await db.$transaction(async (tx) => {
        const count = await tx.address.count({ where: { userId } });
        if (count >= MAX_ADDRESSES) {
          throw new HttpError(
            400,
            `Puedes guardar hasta ${MAX_ADDRESSES} direcciones`,
            'LIMIT_REACHED',
          );
        }
        const makeDefault = input.isDefault === true || count === 0;
        if (makeDefault)
          await tx.address.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        return tx.address.create({
          data: {
            userId,
            recipientName: input.recipientName,
            phone: input.phone,
            departmentCode: input.departmentCode,
            municipalityCode: input.municipalityCode,
            addressLine: input.addressLine,
            neighborhood: input.neighborhood ?? null,
            instructions: input.instructions ?? null,
            isDefault: makeDefault,
          },
        });
      });
      res.status(201).json({ data: toDto(created) });
    }),
  );

  router.get(
    '/:id',
    handler(async (req, res) => {
      const { id } = idParams.parse(req.params);
      const address = await db.address.findFirst({ where: { id, userId: req.auth!.userId } });
      if (!address) throw notFound();
      res.json({ data: toDto(address) });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const userId = req.auth!.userId;
      const { id } = idParams.parse(req.params);
      const input = addressInputSchema.parse(req.body);
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.address.findFirst({ where: { id, userId } });
        if (!existing) throw notFound();
        if (input.isDefault === true) {
          await tx.address.updateMany({
            where: { userId, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }
        return tx.address.update({
          where: { id },
          data: {
            recipientName: input.recipientName,
            phone: input.phone,
            departmentCode: input.departmentCode,
            municipalityCode: input.municipalityCode,
            addressLine: input.addressLine,
            neighborhood: input.neighborhood ?? null,
            instructions: input.instructions ?? null,
            ...(input.isDefault === true ? { isDefault: true } : {}),
          },
        });
      });
      res.json({ data: toDto(updated) });
    }),
  );

  router.delete(
    '/:id',
    handler(async (req, res) => {
      const userId = req.auth!.userId;
      const { id } = idParams.parse(req.params);
      const deleted = await db.address.deleteMany({ where: { id, userId } });
      if (deleted.count === 0) throw notFound();
      res.status(204).end();
    }),
  );

  return router;
}
