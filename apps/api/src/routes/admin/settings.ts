import { Router, type Router as ExpressRouter } from 'express';
import { storeSettingsInputSchema } from '@sol-y-luna/shared';
import { handler } from '../../lib/async.js';
import type { Db } from '../../lib/prisma.js';
import { actorFrom } from '../../middleware/actor.js';
import { audit, diffFields } from '../../services/audit.js';

const TRACKED = [
  'storeName',
  'whatsappNumber',
  'contactEmail',
  'supportEmail',
  'instagramUrl',
  'settlementFrequency',
  'lowStockThreshold',
] as const;
const LEGAL = [
  'legalTerms',
  'legalPrivacy',
  'legalWithdrawal',
  'legalShipping',
  'legalReturns',
] as const;

export function adminSettingsRouter(deps: { db: Db }): ExpressRouter {
  const { db } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (_req, res) => {
      const settings = await db.storeSettings.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      });
      res.json({ data: settings });
    }),
  );

  router.put(
    '/',
    handler(async (req, res) => {
      const input = storeSettingsInputSchema.parse(req.body);
      const data = {
        ...input,
        whatsappNumber: input.whatsappNumber ?? null,
        contactEmail: input.contactEmail ?? null,
        supportEmail: input.supportEmail ?? null,
        instagramUrl: input.instagramUrl ?? null,
      };
      const updated = await db.$transaction(async (tx) => {
        const existing = await tx.storeSettings.upsert({
          where: { id: 1 },
          update: {},
          create: { id: 1 },
        });
        const settings = await tx.storeSettings.update({ where: { id: 1 }, data });
        const diff =
          diffFields(existing as unknown as Record<string, unknown>, data, TRACKED) ?? {};
        // Legal texts are long: record which ones changed, not their full content.
        const legalChanged = LEGAL.filter((k) => existing[k] !== data[k]);
        if (Object.keys(diff).length || legalChanged.length) {
          await audit(tx, actorFrom(req), {
            action: 'settings.update',
            entity: 'StoreSettings',
            entityId: '1',
            diff: { ...diff, ...(legalChanged.length ? { legalTextsChanged: legalChanged } : {}) },
          });
        }
        return settings;
      });
      res.json({ data: updated });
    }),
  );

  return router;
}
