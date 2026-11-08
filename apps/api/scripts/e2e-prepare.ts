/** Prepares the test database for E2E: migrations, empty tables, seed. Used by Playwright's globalSetup. */
import { execFileSync } from 'node:child_process';
import { createPrismaClient } from '../src/lib/prisma.js';
import { applyE2eEnv } from './e2e-env.js';

applyE2eEnv();
const run = (args: string[]) => execFileSync('pnpm', args, { stdio: 'inherit', env: process.env });

run(['exec', 'prisma', 'migrate', 'deploy']);

const db = createPrismaClient(process.env['DATABASE_URL']!);
const tables = await db.$queryRaw<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
if (tables.length) {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename.replace(/"/g, '')}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}
await db.$disconnect();

run(['exec', 'tsx', 'prisma/seed.ts']);
