import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE, SESSION_COOKIE } from '@sol-y-luna/shared';
import { INVALID_CREDENTIALS_MESSAGE, REFRESH_REUSE_GRACE_MS } from '../services/auth.service.js';
import {
  TEST_PASSWORD,
  buildTestApp,
  cookiesFrom,
  createUser,
  getTestDb,
  hasTestDatabase,
  resetDatabase,
  tokenFromEmail,
} from '../test/integration.js';

const CSRF = { 'x-syl-csrf': '1' };

async function login(app: Parameters<typeof request>[0], email: string, password = TEST_PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  const cookies = cookiesFrom(res.headers['set-cookie']);
  return {
    res,
    accessToken: res.body.accessToken as string,
    refresh: cookies[REFRESH_COOKIE] ?? '',
    session: cookies[SESSION_COOKIE] ?? '',
  };
}

const refreshWith = (app: Parameters<typeof request>[0], token: string) =>
  request(app).post('/api/auth/refresh').set(CSRF).set('Cookie', `${REFRESH_COOKIE}=${token}`);

describe.skipIf(!hasTestDatabase)('auth (integración)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('registro', () => {
    it('crea la cuenta y envía el correo de verificación', async () => {
      const { app, email } = buildTestApp();
      const res = await request(app).post('/api/auth/register').send({
        name: 'Ana Pérez',
        email: 'Ana@Example.com',
        password: 'mi-clave-123',
        acceptTerms: true,
      });
      expect(res.status).toBe(201);
      const user = await getTestDb().user.findUnique({ where: { email: 'ana@example.com' } });
      expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(email.sent[0]?.subject).toMatch(/Confirma tu correo/);
    });

    it('responde igual si el correo ya existe (no revela cuentas)', async () => {
      const { app, email } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const body = {
        name: 'Otra',
        email: 'ana@example.com',
        password: 'otra-clave-123',
        acceptTerms: true,
      };
      const res = await request(app).post('/api/auth/register').send(body);
      expect(res.status).toBe(201);
      expect(email.sent[0]?.subject).toMatch(/Ya tienes una cuenta/);
      expect(await getTestDb().user.count()).toBe(1);
    });

    it('valida en español la contraseña débil y los términos', async () => {
      const { app } = buildTestApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: 'corta', acceptTerms: false });
      expect(res.status).toBe(400);
      const messages = res.body.error.details.map((d: { message: string }) => d.message).join(' ');
      expect(messages).toMatch(/al menos 10 caracteres/);
      expect(messages).toMatch(/aceptar los términos/);
    });

    it('rechaza cuando Turnstile falla', async () => {
      const { app } = buildTestApp({ turnstileOk: false });
      const res = await request(app).post('/api/auth/register').send({
        name: 'Ana',
        email: 'ana@example.com',
        password: 'mi-clave-123',
        acceptTerms: true,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TURNSTILE_FAILED');
    });
  });

  describe('login', () => {
    it('entrega access token y cookies seguras', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const { res } = await login(app, 'ana@example.com');
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('ana@example.com');
      expect(res.body.expiresIn).toBe(900);
      const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(raw).toMatch(
        new RegExp(`${REFRESH_COOKIE}=[^;]+;.*Path=/api/auth;.*HttpOnly;.*SameSite=Lax`),
      );
      expect(raw).toMatch(new RegExp(`${SESSION_COOKIE}=[^;]+;.*Path=/;.*HttpOnly`));
      // Only the hash is stored.
      const stored = await getTestDb().refreshToken.findFirstOrThrow();
      expect(raw).not.toContain(stored.tokenHash);
    });

    it('usa el mismo mensaje genérico para correo inexistente y contraseña incorrecta', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const unknown = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nadie@example.com', password: 'x' });
      const wrong = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: 'x' });
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body.error.message).toBe(INVALID_CREDENTIALS_MESSAGE);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    it('bloquea la cuenta tras 5 intentos fallidos, incluso con la contraseña correcta', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: 'ana@example.com', password: 'mala-123' });
        expect(res.status).toBe(401);
      }
      const user = await getTestDb().user.findUniqueOrThrow({
        where: { email: 'ana@example.com' },
      });
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

      const blocked = await login(app, 'ana@example.com');
      expect(blocked.res.status).toBe(401);
      expect(blocked.res.body.error.message).toBe(INVALID_CREDENTIALS_MESSAGE);

      // Once the lock expires, the correct password works and the counter resets.
      await getTestDb().user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      const ok = await login(app, 'ana@example.com');
      expect(ok.res.status).toBe(200);
      const after = await getTestDb().user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.failedLoginCount).toBe(0);
      expect(after.lockedUntil).toBeNull();
    });

    it('un login correcto reinicia el contador de intentos', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'ana@example.com', password: 'mala-123' });
      }
      expect((await login(app, 'ana@example.com')).res.status).toBe(200);
      const user = await getTestDb().user.findUniqueOrThrow({
        where: { email: 'ana@example.com' },
      });
      expect(user.failedLoginCount).toBe(0);
    });
  });

  describe('refresh con rotación', () => {
    it('rota el token: entrega uno nuevo y revoca el anterior', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const first = await login(app, 'ana@example.com');

      const res = await refreshWith(app, first.refresh);
      expect(res.status).toBe(200);
      const next = cookiesFrom(res.headers['set-cookie'])[REFRESH_COOKIE];
      expect(next).toBeTruthy();
      expect(next).not.toBe(first.refresh);
      expect(res.body.accessToken).toBeTruthy();

      const tokens = await getTestDb().refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.revokedAt).not.toBeNull();
      expect(tokens[0]!.replacedById).toBe(tokens[1]!.id);
      expect(tokens[1]!.familyId).toBe(tokens[0]!.familyId);
    });

    it('detecta la reutilización y revoca toda la familia', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const first = await login(app, 'ana@example.com');
      const rotated = await refreshWith(app, first.refresh);
      const current = cookiesFrom(rotated.headers['set-cookie'])[REFRESH_COOKIE]!;
      const currentAccess = rotated.body.accessToken as string;

      // An attacker replays the old (already rotated) token after the grace window.
      await getTestDb().refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
      });
      const replay = await refreshWith(app, first.refresh);
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('SESSION_REVOKED');

      // The legitimate, newest token of the family is dead too.
      expect((await refreshWith(app, current)).status).toBe(401);
      // And so is the access token issued for that family.
      const me = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${currentAccess}`);
      expect(me.status).toBe(401);

      const live = await getTestDb().refreshToken.count({ where: { revokedAt: null } });
      expect(live).toBe(0);
    });

    it('no afecta otras sesiones del mismo usuario', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const phone = await login(app, 'ana@example.com');
      const laptop = await login(app, 'ana@example.com');
      await refreshWith(app, phone.refresh);
      await getTestDb().refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
      });
      expect((await refreshWith(app, phone.refresh)).status).toBe(401); // reuse → revokes only the phone family
      expect((await refreshWith(app, laptop.refresh)).status).toBe(200);
    });

    it('tolera un refresh repetido dentro del margen (respuesta perdida o pestañas en paralelo)', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const first = await login(app, 'ana@example.com');
      const lost = await refreshWith(app, first.refresh); // the browser never stored this answer
      expect(lost.status).toBe(200);
      const retry = await refreshWith(app, first.refresh); // retries with the old cookie
      expect(retry.status).toBe(200);
      const fresh = cookiesFrom(retry.headers['set-cookie'])[REFRESH_COOKIE]!;
      // Only one token stays alive, and the session keeps working.
      expect(await getTestDb().refreshToken.count({ where: { revokedAt: null } })).toBe(1);
      expect((await refreshWith(app, fresh)).status).toBe(200);
      // The undelivered token is no longer valid.
      const undelivered = cookiesFrom(lost.headers['set-cookie'])[REFRESH_COOKIE]!;
      await getTestDb().refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
      });
      expect((await refreshWith(app, undelivered)).status).toBe(401);
    });

    it('exige la cabecera anti-CSRF y un Origin permitido', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const { refresh } = await login(app, 'ana@example.com');
      const noHeader = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${refresh}`);
      expect(noHeader.status).toBe(403);
      const badOrigin = await refreshWith(app, refresh).set('Origin', 'https://evil.example');
      expect(badOrigin.status).toBe(403);
    });

    it('rechaza un refresh token vencido', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const { refresh } = await login(app, 'ana@example.com');
      await getTestDb().refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await refreshWith(app, refresh)).status).toBe(401);
    });
  });

  describe('logout y sesión de páginas', () => {
    it('logout revoca la sesión y la cookie de páginas deja de servir', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const { refresh, session } = await login(app, 'ana@example.com');

      const ok = await request(app)
        .get('/api/auth/session')
        .set('Cookie', `${SESSION_COOKIE}=${session}`);
      expect(ok.status).toBe(200);
      expect(ok.body.user.role).toBe('CUSTOMER');

      const out = await request(app)
        .post('/api/auth/logout')
        .set(CSRF)
        .set('Cookie', `${REFRESH_COOKIE}=${refresh}`);
      expect(out.status).toBe(204);
      expect((await refreshWith(app, refresh)).status).toBe(401);
      const after = await request(app)
        .get('/api/auth/session')
        .set('Cookie', `${SESSION_COOKIE}=${session}`);
      expect(after.status).toBe(401);
    });

    it('la cookie de páginas no sirve como Bearer (audiencia distinta)', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const { session } = await login(app, 'ana@example.com');
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session}`);
      expect(res.status).toBe(401);
    });
  });

  describe('roles', () => {
    it('aplica los permisos en el servidor', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'cliente@example.com' });
      await createUser({ email: 'operador@example.com', role: 'OPERATOR' });
      await createUser({ email: 'admin@example.com', role: 'ADMIN' });
      const customer = await login(app, 'cliente@example.com');
      const operator = await login(app, 'operador@example.com');
      const admin = await login(app, 'admin@example.com');
      const get = (path: string, token: string) =>
        request(app).get(path).set('Authorization', `Bearer ${token}`);

      expect((await request(app).get('/api/admin/status')).status).toBe(401);
      expect((await get('/api/admin/status', customer.accessToken)).status).toBe(403);
      expect((await get('/api/operator/status', customer.accessToken)).status).toBe(403);
      expect((await get('/api/admin/status', operator.accessToken)).status).toBe(403);
      expect((await get('/api/operator/status', operator.accessToken)).status).toBe(200);
      expect((await get('/api/admin/status', admin.accessToken)).status).toBe(200);
      expect((await get('/api/operator/status', admin.accessToken)).status).toBe(200);
    });

    it('un cambio de rol se aplica de inmediato aunque el token diga otra cosa', async () => {
      const { app } = buildTestApp();
      const user = await createUser({ email: 'admin@example.com', role: 'ADMIN' });
      const { accessToken } = await login(app, 'admin@example.com');
      await getTestDb().user.update({ where: { id: user.id }, data: { role: 'CUSTOMER' } });
      const res = await request(app)
        .get('/api/admin/status')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(403);
    });

    it('rechaza tokens manipulados', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const { accessToken } = await login(app, 'ana@example.com');
      const [header, payload, signature] = accessToken.split('.');
      const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...claims, role: 'ADMIN' })).toString(
        'base64url',
      );
      const res = await request(app)
        .get('/api/admin/status')
        .set('Authorization', `Bearer ${header}.${forged}.${signature}`);
      expect(res.status).toBe(401);
    });
  });

  describe('IDOR: direcciones', () => {
    const address = {
      recipientName: 'Ana Pérez',
      phone: '3001234567',
      departmentCode: '05',
      municipalityCode: '05001',
      addressLine: 'Calle 10 # 43-20',
    };

    it('un usuario no puede ver, editar ni borrar direcciones ajenas', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      await createUser({ email: 'beto@example.com' });
      const ana = await login(app, 'ana@example.com');
      const beto = await login(app, 'beto@example.com');
      const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

      const created = await request(app)
        .post('/api/account/addresses')
        .set(auth(ana.accessToken))
        .send(address);
      expect(created.status).toBe(201);
      expect(created.body.data.municipalityName).toBe('Medellín');
      const id = created.body.data.id as string;

      expect(
        (await request(app).get(`/api/account/addresses/${id}`).set(auth(beto.accessToken))).status,
      ).toBe(404);
      const put = await request(app)
        .put(`/api/account/addresses/${id}`)
        .set(auth(beto.accessToken))
        .send({ ...address, addressLine: 'Hackeada 123' });
      expect(put.status).toBe(404);
      expect(
        (await request(app).delete(`/api/account/addresses/${id}`).set(auth(beto.accessToken)))
          .status,
      ).toBe(404);

      const list = await request(app).get('/api/account/addresses').set(auth(beto.accessToken));
      expect(list.body.data).toEqual([]);

      const stored = await getTestDb().address.findUniqueOrThrow({ where: { id } });
      expect(stored.addressLine).toBe(address.addressLine);
      expect(
        (await request(app).get(`/api/account/addresses/${id}`).set(auth(ana.accessToken))).status,
      ).toBe(200);
    });

    it('rechaza un municipio que no pertenece al departamento', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const ana = await login(app, 'ana@example.com');
      const res = await request(app)
        .post('/api/account/addresses')
        .set('Authorization', `Bearer ${ana.accessToken}`)
        .send({ ...address, departmentCode: '76' });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].message).toMatch(/no pertenece al departamento/);
    });
  });

  describe('recuperación y cambio de contraseña', () => {
    it('el enlace de recuperación sirve una sola vez y cierra todas las sesiones', async () => {
      const { app, email } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const old = await login(app, 'ana@example.com');

      const forgot = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'ana@example.com' });
      expect(forgot.status).toBe(200);
      const token = tokenFromEmail(email.sent.at(-1)!.text);
      const stored = await getTestDb().emailToken.findFirstOrThrow({ where: { type: 'RESET' } });
      expect(stored.tokenHash).not.toBe(token);
      expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);

      const reset = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'nueva-clave-456' });
      expect(reset.status).toBe(200);
      const again = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'otra-clave-789' });
      expect(again.status).toBe(400);

      expect((await refreshWith(app, old.refresh)).status).toBe(401);
      expect(
        (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${old.accessToken}`))
          .status,
      ).toBe(401);
      expect((await login(app, 'ana@example.com')).res.status).toBe(401);
      expect((await login(app, 'ana@example.com', 'nueva-clave-456')).res.status).toBe(200);
    });

    it('olvidé mi contraseña responde igual con un correo inexistente', async () => {
      const { app, email } = buildTestApp();
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nadie@example.com' });
      expect(res.status).toBe(200);
      expect(email.sent).toHaveLength(0);
    });

    it('cambiar la contraseña revoca las demás sesiones y deja viva la actual', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const other = await login(app, 'ana@example.com');
      const current = await login(app, 'ana@example.com');

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${current.accessToken}`)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'nueva-clave-456' });
      expect(res.status).toBe(200);
      const fresh = cookiesFrom(res.headers['set-cookie'])[REFRESH_COOKIE]!;

      expect((await refreshWith(app, other.refresh)).status).toBe(401);
      expect((await refreshWith(app, fresh)).status).toBe(200);
      const me = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`);
      expect(me.status).toBe(200);
    });
  });

  describe('verificación de correo', () => {
    it('confirma el correo con el enlace y no permite reutilizarlo', async () => {
      const { app, email } = buildTestApp();
      await request(app).post('/api/auth/register').send({
        name: 'Ana',
        email: 'ana@example.com',
        password: 'mi-clave-123',
        acceptTerms: true,
      });
      const token = tokenFromEmail(email.sent[0]!.text);
      expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(200);
      expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
      const user = await getTestDb().user.findUniqueOrThrow({
        where: { email: 'ana@example.com' },
      });
      expect(user.emailVerifiedAt).not.toBeNull();
    });
  });

  describe('rate limit', () => {
    it('limita los intentos de login por IP', async () => {
      const { app } = buildTestApp({
        rateLimits: {
          global: { limit: 0, windowMs: 60_000 },
          login: { limit: 3, windowMs: 60_000 },
          register: { limit: 0, windowMs: 60_000 },
          passwordReset: { limit: 0, windowMs: 60_000 },
          refresh: { limit: 0, windowMs: 60_000 },
          sensitive: { limit: 0, windowMs: 60_000 },
          webhooks: { limit: 0, windowMs: 60_000 },
          reviews: { limit: 0, windowMs: 60_000 },
        },
      });
      const attempt = () =>
        request(app).post('/api/auth/login').send({ email: 'x@example.com', password: 'x' });
      for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
      const limited = await attempt();
      expect(limited.status).toBe(429);
      expect(limited.body.error.message).toMatch(/demasiadas solicitudes/);
    });
  });
});
