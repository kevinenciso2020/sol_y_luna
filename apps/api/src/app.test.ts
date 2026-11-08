import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';
import type { Db } from './lib/prisma.js';
import { createMemoryEmailSender } from './services/email.js';
import { testEnv } from './test/fixtures.js';

const logger = createLogger({ level: 'silent', pretty: false });
// Health and middleware tests never touch the database.
const baseDeps = {
  db: {} as Db,
  email: createMemoryEmailSender(),
  turnstile: { verify: async () => true },
};
const app = createApp(testEnv(), logger, { ...baseDeps, checkDatabase: async () => {} });

describe('app', () => {
  it('GET /health responds ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('ok');
  });

  it('GET /health returns 503 when the database is unreachable', async () => {
    const broken = createApp(testEnv(), logger, {
      ...baseDeps,
      checkDatabase: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await request(broken).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', database: 'unreachable' });
  });

  it('sets security headers and a request id', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/[\w-]{8,}/);
  });

  it('returns a Spanish 404 with request id', async () => {
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Recurso no encontrado');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('allows configured origins and rejects others for CORS', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:4321');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:4321');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized bodies', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.stack).toBeUndefined();
  });
});
