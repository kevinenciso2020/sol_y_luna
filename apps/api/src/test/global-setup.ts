import { execFileSync } from 'node:child_process';

/** Applies migrations to the test database once per run (skipped when there is no test DB). */
export default function setup() {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    console.warn(
      '\n⚠️  TEST_DATABASE_URL no está definida: se omiten las pruebas de integración.\n',
    );
    return;
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
