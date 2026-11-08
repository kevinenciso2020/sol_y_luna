/**
 * E2E runs use the test database (TEST_DATABASE_URL), never the dev/prod one, and their own ports.
 */
export const E2E_API_PORT = 4100;
export const E2E_WEB_URL = 'http://localhost:4400';

export function applyE2eEnv() {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    console.error('❌ TEST_DATABASE_URL no está definida (apps/api/.env.test).');
    process.exit(1);
  }
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url,
    DIRECT_URL: url,
    PORT: String(E2E_API_PORT),
    WEB_URL: E2E_WEB_URL,
    CORS_ORIGINS: E2E_WEB_URL,
    API_URL: `http://localhost:${E2E_API_PORT}`,
    LOG_LEVEL: 'warn',
    PAYMENTS_MODE: 'demo',
  });
}
