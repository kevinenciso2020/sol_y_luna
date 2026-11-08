import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';
import { testEnv } from './test/fixtures.js';

const app = createApp(testEnv(), createLogger({ level: 'silent', pretty: false }));

describe('app', () => {
  it('GET /health responds ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
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
