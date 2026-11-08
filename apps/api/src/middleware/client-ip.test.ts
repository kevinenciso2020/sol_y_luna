import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip.js';

const SECRET = 'x'.repeat(40);

function appWith(secret: string | undefined) {
  const app = express();
  app.use(clientIp(secret));
  app.get('/', (req, res) => {
    res.json({ ip: req.clientIp });
  });
  return app;
}

describe('clientIp', () => {
  it('confía en x-client-ip solo con el secreto correcto del BFF', async () => {
    const app = appWith(SECRET);
    const trusted = await request(app)
      .get('/')
      .set('x-bff-secret', SECRET)
      .set('x-client-ip', '181.50.1.2');
    expect(trusted.body.ip).toBe('181.50.1.2');

    const spoofed = await request(app)
      .get('/')
      .set('x-bff-secret', 'wrong')
      .set('x-client-ip', '181.50.1.2');
    expect(spoofed.body.ip).not.toBe('181.50.1.2');
  });

  it('ignora valores que no son IP', async () => {
    const res = await request(appWith(SECRET))
      .get('/')
      .set('x-bff-secret', SECRET)
      .set('x-client-ip', 'not-an-ip');
    expect(res.body.ip).not.toBe('not-an-ip');
  });

  it('sin secreto configurado nunca confía en la cabecera', async () => {
    const res = await request(appWith(undefined))
      .get('/')
      .set('x-bff-secret', SECRET)
      .set('x-client-ip', '181.50.1.2');
    expect(res.body.ip).not.toBe('181.50.1.2');
  });
});
