import type { Prisma, Role } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

export interface AuditActor {
  userId: string;
  role: Role;
  ip: string;
  userAgent: string | undefined;
}

export interface AuditEntry {
  action: string; // e.g. product.update, variant.price.update, user.role.update
  entity: string;
  entityId: string;
  diff?: Record<string, unknown> | null;
}

/** Writes an audit log row inside the caller's transaction. */
export async function audit(tx: Tx, actor: AuditActor, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId: actor.userId,
      actorRole: actor.role,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      diff: (entry.diff ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: actor.ip,
      userAgent: actor.userAgent?.slice(0, 255) ?? null,
    },
  });
}

/** Returns { field: { from, to } } for the keys whose value changed. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  keys: readonly (keyof T)[],
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes[String(key)] = { from: from ?? null, to: to ?? null };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}
