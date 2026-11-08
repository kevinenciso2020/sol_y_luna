import { loadEnv } from '../config/env.js';

/** A complete, valid environment for tests. Values are dummies, never real secrets. */
export const validEnvSource = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/sol_y_luna_test',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-chars',
  REFRESH_TOKEN_PEPPER: 'test-refresh-pepper-that-is-at-least-32-chars',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CORS_ORIGINS: 'http://localhost:4321',
  WEB_URL: 'http://localhost:4321',
  API_URL: 'http://localhost:4000',
  LOG_LEVEL: 'silent',
} satisfies NodeJS.ProcessEnv;

export const testEnv = () => loadEnv({ ...validEnvSource });
