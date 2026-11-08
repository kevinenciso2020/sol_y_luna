import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Admin credentials come from the API env (the e2e seed uses them).
if (existsSync('../api/.env')) process.loadEnvFile('../api/.env');

const WEB = 'http://localhost:4400';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  // Dev server compiles each page on first visit: give navigations some room.
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: WEB,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @sol-y-luna/api e2e:server',
      url: 'http://localhost:4100/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Production build served by workerd (same runtime as Cloudflare), not the dev server.
      command: 'node e2e/serve-web.mjs',
      url: WEB,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
