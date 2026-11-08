/** Starts the API for E2E tests against the test database. */
import { applyE2eEnv } from './e2e-env.js';

applyE2eEnv();
await import('../src/server.js');
