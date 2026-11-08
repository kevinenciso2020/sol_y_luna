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
      // --ignore-lock keeps astro in the foreground (Astro 7 backgrounds itself when run by agents).
      command: 'pnpm exec astro dev --port 4400 --ignore-lock',
      url: WEB,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_INTERNAL_URL: 'http://localhost:4100', E2E: '1' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
