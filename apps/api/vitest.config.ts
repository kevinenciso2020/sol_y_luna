import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Integration tests read TEST_DATABASE_URL (Neon "test" branch locally, Postgres service in CI).
// They never read DATABASE_URL, so they cannot touch the dev or production databases.
if (!process.env['TEST_DATABASE_URL'] && existsSync('.env.test')) process.loadEnvFile('.env.test');

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Integration tests share one database: run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
