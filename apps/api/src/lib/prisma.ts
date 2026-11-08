import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type Db = PrismaClient;

/**
 * Creates the Prisma client. Uses the pooled Neon connection (DATABASE_URL).
 * Instantiate once per process and pass it down; never create clients per request.
 */
export function createPrismaClient(databaseUrl: string, options: { logQueries?: boolean } = {}) {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({
    adapter,
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}
