import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEncryptor } from '../lib/encryption.js';
import { createLogger } from '../lib/logger.js';
import { CART_COOKIE } from '../services/cart.service.js';
import { createMercadoPago } from '../services/payments/mercadopago.js';
import { bearer, seedCatalog } from '../test/catalog-fixtures.js';
import { validEnvSource } from '../test/fixtures.js';
import {
  TEST_PASSWORD,
  buildTestApp,
  cookiesFrom,
  createUser,
  getTestDb,
  hasTestDatabase,
  resetDatabase,
} from '../test/integration.js';
import { ORDER_COOKIE } from './checkout.js';

type App = ReturnType<typeof buildTestApp>['app'];

const address = {
  recipientName: 'Laura Gómez',
  phone: '3001234567',
  departmentCode: '05',
  municipalityCode: '05001',
  addressLine: 'Calle 10 # 43-20',
};
const contact = { name: 'Laura Gómez', email: 'laura@example.com', phone: '3001234567' };
const checkoutBody = (over: Record<string, unknown> = {}) => ({
  contact,
  address,
  discreetPackaging: true,
  paymentProvider: 'MOCK',
  acceptTerms: true,
  acceptDataPolicy: true,
  ...over,
});

/** Adds to a guest cart and returns the cookie header to keep using it. */
async function guestCart(app: App, variantId: string, quantity: number) {
  const res = await request(app).post('/api/cart/items').send({ variantId, quantity });
  expect(res.status).toBe(201);
  return `${CART_COOKIE}=${cookiesFrom(res.headers['set-cookie'])[CART_COOKIE]}`;
}

async function placeOrder(
  app: App,
  variantId: string,
  quantity = 2,
  over: Record<string, unknown> = {},
) {
  const cookie = await guestCart(app, variantId, quantity);
  const res = await request(app)
    .post('/api/checkout')
    .set('Cookie', cookie)
    .send(checkoutBody(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const orderCookie = `${ORDER_COOKIE}=${cookiesFrom(res.headers['set-cookie'])[ORDER_COOKIE]}`;
  return { ...res.body.data, orderCookie, cartCookie: cookie } as {
    orderNumber: string;
    reference: string;
    redirectUrl: string;
    orderCookie: string;
    cartCookie: string;
  };
}

const variantOf = async (slug: string) =>
  getTestDb().productVariant.findFirstOrThrow({ where: { product: { slug } } });

describe.skipIf(!hasTestDatabase)('compra (integración)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    await getTestDb().commissionRule.create({ data: { scope: 'GLOBAL', rateBps: 1000 } });
  });

  describe('carrito', () => {
    it('crea un carrito de invitado con cookie httpOnly y precios del servidor', async () => {
      const { app } = buildTestApp();
      const v = await variantOf('sauco');
      const res = await request(app)
        .post('/api/cart/items')
        .send({ variantId: v.id, quantity: 2, unitPrice: 1 });
      expect(res.status).toBe(201);
      expect(String(res.headers['set-cookie'])).toMatch(/syl_cart=.+HttpOnly/);
      expect(res.body.data.totals).toEqual({
        subtotal: 129_800,
        discount: 0,
        shipping: 0,
        total: 129_800,
        priceTier: 'RETAIL',
      });
    });

    it('no deja agregar más de lo disponible', async () => {
      const { app } = buildTestApp();
      const v = await variantOf('sauco');
      const res = await request(app)
        .post('/api/cart/items')
        .send({ variantId: v.id, quantity: 11 });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('Solo quedan 10 unidades disponibles');
    });

    it('aplica precio mayorista solo a mayoristas aprobados que cumplen el mínimo', async () => {
      const { app } = buildTestApp();
      const user = await createUser({ email: 'mayorista@example.com' });
      await getTestDb().user.update({
        where: { id: user.id },
        data: { wholesaleStatus: 'APPROVED' },
      });
      const headers = await bearer(app, 'mayorista@example.com', TEST_PASSWORD);
      const v = await variantOf('sauco'); // wholesale 48.900 from 6 units
      await request(app)
        .post('/api/cart/items')
        .set(headers)
        .send({ variantId: v.id, quantity: 5 });
      let cart = (await request(app).get('/api/cart').set(headers)).body.data;
      expect(cart.lines[0]).toMatchObject({ unitPrice: 64_900, priceTier: 'RETAIL' });
      await request(app).patch(`/api/cart/items/${v.id}`).set(headers).send({ quantity: 6 });
      cart = (await request(app).get('/api/cart').set(headers)).body.data;
      expect(cart.lines[0]).toMatchObject({
        unitPrice: 48_900,
        priceTier: 'WHOLESALE',
        lineTotal: 293_400,
      });
    });

    it('une el carrito de invitado con el del usuario al iniciar sesión', async () => {
      const { app } = buildTestApp();
      await createUser({ email: 'ana@example.com' });
      const sauco = await variantOf('sauco');
      const mentas = await variantOf('mentas');
      const headers = await bearer(app, 'ana@example.com', TEST_PASSWORD);
      await request(app)
        .post('/api/cart/items')
        .set(headers)
        .send({ variantId: sauco.id, quantity: 1 });

      const cookie = await guestCart(app, sauco.id, 2);
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', cookie)
        .send({ variantId: mentas.id, quantity: 3 });
      const login = await request(app)
        .post('/api/auth/login')
        .set('Cookie', cookie)
        .send({ email: 'ana@example.com', password: TEST_PASSWORD });
      expect(String(login.headers['set-cookie'])).toMatch(/syl_cart=;/);

      const cart = (
        await request(app)
          .get('/api/cart')
          .set({ Authorization: `Bearer ${login.body.accessToken}` })
      ).body.data;
      const qty = Object.fromEntries(
        cart.lines.map((l: { sku: string; quantity: number }) => [l.sku, l.quantity]),
      );
      expect(qty).toEqual({ SAUCO: 3, MENTAS: 3 });
      expect(await getTestDb().cart.count()).toBe(1);
    });
  });

  describe('checkout y pago simulado', () => {
    it('crea el pedido, reserva stock, vacía el carrito y redirige al pago', async () => {
      const { app, email } = buildTestApp();
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 2);
      expect(order.orderNumber).toMatch(/^SYL-\d{6}$/);
      expect(order.redirectUrl).toContain('/pago/simulado?ref=');

      const stored = await getTestDb().order.findFirstOrThrow({ include: { items: true } });
      expect(stored).toMatchObject({
        status: 'PENDING_PAYMENT',
        subtotal: 129_800,
        total: 129_800,
        shippingCost: 0,
        discreetPackaging: true,
        shipMunicipalityName: 'Medellín',
      });
      expect(stored.items[0]).toMatchObject({
        productName: 'Saúco Negro',
        unitPrice: 64_900,
        quantity: 2,
      });
      expect(stored.reservationExpiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
      expect((await variantOf('sauco')).reservedStock).toBe(2);
      expect(await getTestDb().cartItem.count()).toBe(0);
      expect(email.sent.at(-1)?.subject).toBe(`Recibimos tu pedido ${order.orderNumber}`);
    });

    it('al aprobar: PAID, descuenta stock, libera la reserva y fija la comisión del 10%', async () => {
      const { app, email } = buildTestApp();
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 2);
      const res = await request(app)
        .post('/api/payments/mock/complete')
        .set('Cookie', order.orderCookie)
        .send({ reference: order.reference, outcome: 'approve' });
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('paid');

      const paid = await getTestDb().order.findFirstOrThrow({ include: { statusHistory: true } });
      expect(paid).toMatchObject({
        status: 'PAID',
        commissionRateBps: 1000,
        commissionAmount: 12_980,
        merchantNetAmount: 116_820,
        reservationExpiresAt: null,
      });
      expect(paid.statusHistory.map((h) => h.toStatus)).toEqual(['PENDING_PAYMENT', 'PAID']);
      const variant = await variantOf('sauco');
      expect(variant).toMatchObject({ stock: 8, reservedStock: 0 });
      const reasons = (await getTestDb().inventoryMovement.findMany({ where: { variantId: v.id } }))
        .map((m) => m.reason)
        .sort();
      expect(reasons).toEqual(['RELEASE', 'RESERVATION', 'SALE']);
      expect(email.sent.at(-1)?.subject).toBe(`Pago confirmado: pedido ${order.orderNumber}`);

      // The commission stays frozen even if the rule changes later.
      await getTestDb().commissionRule.updateMany({ data: { rateBps: 2000 } });
      expect((await getTestDb().order.findFirstOrThrow()).commissionAmount).toBe(12_980);
    });

    it('al rechazar libera la reserva y permite reintentar el pago', async () => {
      const { app } = buildTestApp();
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 3);
      await request(app)
        .post('/api/payments/mock/complete')
        .set('Cookie', order.orderCookie)
        .send({ reference: order.reference, outcome: 'decline' });
      expect((await getTestDb().order.findFirstOrThrow()).status).toBe('PAYMENT_FAILED');
      expect((await variantOf('sauco')).reservedStock).toBe(0);

      const retry = await request(app)
        .post(`/api/orders/${order.orderNumber}/retry`)
        .set('Cookie', order.orderCookie)
        .send({});
      expect(retry.status).toBe(200);
      expect((await getTestDb().order.findFirstOrThrow()).status).toBe('PENDING_PAYMENT');
      expect((await variantOf('sauco')).reservedStock).toBe(3);
    });

    it('aplica el cupón con el descuento calculado en el servidor', async () => {
      const { app } = buildTestApp();
      await getTestDb().coupon.create({
        data: {
          code: 'BIENVENIDA10',
          type: 'PERCENT',
          value: 10,
          minSubtotal: 80_000,
          maxUsesPerUser: 1,
        },
      });
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 2, { couponCode: 'bienvenida10' });
      const stored = await getTestDb().order.findFirstOrThrow({
        where: { number: Number(order.orderNumber.slice(4)) },
      });
      expect(stored).toMatchObject({
        subtotal: 129_800,
        discount: 12_980,
        total: 116_820,
        couponCode: 'BIENVENIDA10',
      });
      expect((await getTestDb().coupon.findFirstOrThrow()).usedCount).toBe(1);

      // Same email again: the per-customer limit applies to guests too.
      const cookie = await guestCart(app, v.id, 2);
      const again = await request(app)
        .post('/api/checkout')
        .set('Cookie', cookie)
        .send(checkoutBody({ couponCode: 'BIENVENIDA10' }));
      expect(again.status).toBe(400);
      expect(again.body.error.message).toBe('Ya usaste este cupón');
    });

    it('nunca vende más unidades de las que hay (checkouts en paralelo)', async () => {
      const { app } = buildTestApp();
      const v = await variantOf('turkesterone');
      await getTestDb().productVariant.update({ where: { id: v.id }, data: { stock: 1 } });
      const cookies = await Promise.all([
        guestCart(app, v.id, 1),
        guestCart(app, v.id, 1),
        guestCart(app, v.id, 1),
      ]);
      const results = await Promise.all(
        cookies.map((c) =>
          request(app).post('/api/checkout').set('Cookie', c).send(checkoutBody()),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect((await variantOf('turkesterone')).reservedStock).toBe(1);
    });

    it('exige Turnstile al invitado y valida en español', async () => {
      const { app } = buildTestApp({ turnstileOk: false });
      const v = await variantOf('sauco');
      const cookie = await guestCart(app, v.id, 1);
      const res = await request(app)
        .post('/api/checkout')
        .set('Cookie', cookie)
        .send(checkoutBody());
      expect(res.body.error.code).toBe('TURNSTILE_FAILED');
      const invalid = await request(app)
        .post('/api/checkout')
        .set('Cookie', cookie)
        .send(
          checkoutBody({ acceptTerms: false, address: { ...address, municipalityCode: '76001' } }),
        );
      expect(invalid.status).toBe(400);
      const messages = invalid.body.error.details
        .map((d: { message: string }) => d.message)
        .join(' ');
      expect(messages).toMatch(/aceptar los términos/);
      expect(messages).toMatch(/no pertenece al departamento/);
    });

    it('un pedido solo lo ve su dueño o quien tiene su token', async () => {
      const { app } = buildTestApp();
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 1);
      expect((await request(app).get(`/api/orders/${order.orderNumber}`)).status).toBe(404);
      expect(
        (
          await request(app)
            .get(`/api/orders/${order.orderNumber}`)
            .set('Cookie', `${ORDER_COOKIE}=${order.orderNumber}.otro-token`)
        ).status,
      ).toBe(404);
      const ok = await request(app)
        .get(`/api/orders/${order.orderNumber}`)
        .set('Cookie', order.orderCookie);
      expect(ok.status).toBe(200);
      expect(ok.body.data.items[0].productName).toBe('Saúco Negro');
      // Nobody else can approve it with the simulated payment either.
      expect(
        (
          await request(app)
            .post('/api/payments/mock/complete')
            .send({ reference: order.reference, outcome: 'approve' })
        ).status,
      ).toBe(404);
    });

    it('el job libera las reservas vencidas y cancela el pedido', async () => {
      const { app } = buildTestApp();
      const v = await variantOf('sauco');
      await placeOrder(app, v.id, 2);
      await getTestDb().order.updateMany({
        data: { reservationExpiresAt: new Date(Date.now() - 1000) },
      });
      const { createOrdersService } = await import('../services/orders.service.js');
      const { createCartService } = await import('../services/cart.service.js');
      const { createMemoryEmailSender } = await import('../services/email.js');
      const db = getTestDb();
      const orders = createOrdersService({
        db,
        cart: createCartService({ db, pepper: validEnvSource.REFRESH_TOKEN_PEPPER }),
        email: createMemoryEmailSender(),
        logger: createLogger({ level: 'silent', pretty: false }),
        pepper: validEnvSource.REFRESH_TOKEN_PEPPER,
        webUrl: 'http://localhost:4321',
        providers: {},
      });
      expect(await orders.expireReservations()).toBe(1);
      expect((await db.order.findFirstOrThrow()).status).toBe('CANCELLED');
      expect((await variantOf('sauco')).reservedStock).toBe(0);
      expect(await orders.expireReservations()).toBe(0);
    });
  });

  describe('webhooks de Wompi', () => {
    const wompiEnv = {
      PAYMENTS_MODE: 'live',
      WOMPI_PUBLIC_KEY: 'pub_test_x',
      WOMPI_PRIVATE_KEY: 'prv_test_x',
      WOMPI_INTEGRITY_SECRET: 'test_integrity_secret',
      WOMPI_EVENTS_SECRET: 'test_events_secret',
    };
    const event = (
      reference: string,
      amountInCents: number,
      status = 'APPROVED',
      secret = 'test_events_secret',
    ) => {
      const transaction = {
        id: `tx-${reference}`,
        status,
        amount_in_cents: amountInCents,
        reference,
        currency: 'COP',
      };
      const timestamp = 1_731_000_000;
      const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
      const checksum = createHash('sha256')
        .update(`${transaction.id}${status}${amountInCents}${timestamp}${secret}`)
        .digest('hex');
      return {
        event: 'transaction.updated',
        data: { transaction },
        signature: { properties, checksum },
        timestamp,
        environment: 'test',
      };
    };

    it('genera el checkout con la firma de integridad correcta', async () => {
      const { app } = buildTestApp({ env: wompiEnv });
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 1, { paymentProvider: 'WOMPI' });
      const url = new URL(order.redirectUrl);
      expect(url.origin).toBe('https://checkout.wompi.co');
      expect(url.searchParams.get('amount-in-cents')).toBe('6490000');
      const expected = createHash('sha256')
        .update(`${order.reference}6490000COPtest_integrity_secret`)
        .digest('hex');
      expect(url.searchParams.get('signature:integrity')).toBe(expected);
    });

    it('procesa un evento firmado una sola vez', async () => {
      const { app } = buildTestApp({ env: wompiEnv });
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 1, { paymentProvider: 'WOMPI' });
      const body = event(order.reference, 6_490_000);
      const first = await request(app).post('/api/webhooks/wompi').send(body);
      expect(first.status).toBe(200);
      expect(first.body.outcome).toBe('paid');
      const again = await request(app).post('/api/webhooks/wompi').send(body);
      expect(again.body).toMatchObject({ duplicate: true });
      expect((await variantOf('sauco')).stock).toBe(9); // deducted once
      expect(await getTestDb().webhookEvent.count()).toBe(1);
    });

    it('rechaza firmas inválidas o alteradas', async () => {
      const { app } = buildTestApp({ env: wompiEnv });
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 1, { paymentProvider: 'WOMPI' });
      const forged = event(order.reference, 6_490_000, 'APPROVED', 'otro-secreto');
      expect((await request(app).post('/api/webhooks/wompi').send(forged)).status).toBe(401);
      const tampered = event(order.reference, 6_490_000);
      tampered.data.transaction.amount_in_cents = 100;
      expect((await request(app).post('/api/webhooks/wompi').send(tampered)).status).toBe(401);
      expect((await request(app).post('/api/webhooks/wompi').send({ hola: 'mundo' })).status).toBe(
        401,
      );
      expect((await getTestDb().order.findFirstOrThrow()).status).toBe('PENDING_PAYMENT');
    });

    it('si el monto no coincide, el pedido queda en revisión y no se aprueba', async () => {
      const { app } = buildTestApp({ env: wompiEnv });
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 1, { paymentProvider: 'WOMPI' });
      const res = await request(app)
        .post('/api/webhooks/wompi')
        .send(event(order.reference, 100_000));
      expect(res.body.outcome).toBe('needs_review');
      const stored = await getTestDb().order.findFirstOrThrow();
      expect(stored).toMatchObject({ status: 'PENDING_PAYMENT', needsReview: true });
      expect(stored.reviewReason).toMatch(/no coincide/);
      expect((await variantOf('sauco')).stock).toBe(10);
    });
  });

  describe('webhooks de Mercado Pago', () => {
    const secret = 'mp-webhook-secret';
    const sign = (dataId: string, requestId: string, ts = '1731000000') =>
      `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`;

    function mpApp(paymentStatus = 'approved', amount = 64_900) {
      const calls: string[] = [];
      let reference = '';
      const fakeFetch = (async (url: string | URL) => {
        calls.push(String(url));
        if (String(url).includes('/checkout/preferences'))
          return new Response(JSON.stringify({ init_point: 'https://mp.example/checkout' }));
        return new Response(
          JSON.stringify({
            id: 987,
            status: paymentStatus,
            transaction_amount: amount,
            external_reference: reference,
            fee_details: [{ type: 'mercadopago_fee', amount: 2_500 }],
          }),
        );
      }) as typeof fetch;
      const env = {
        PAYMENTS_MODE: 'live',
        MP_MODE: 'direct',
        MP_ACCESS_TOKEN: 'TEST-token',
        MP_PUBLIC_KEY: 'TEST-pk',
        MP_WEBHOOK_SECRET: secret,
      };
      const mercadoPago = createMercadoPago({
        config: {
          mode: 'direct',
          accessToken: 'TEST-token',
          webhookSecret: secret,
          apiUrl: 'http://localhost:4000',
        },
        db: getTestDb(),
        encryptor: createEncryptor(validEnvSource.ENCRYPTION_KEY),
        logger: createLogger({ level: 'silent', pretty: false }),
        fetchImpl: fakeFetch,
      });
      const app = buildTestApp({ env, mercadoPago }).app;
      return { app, calls, setReference: (r: string) => (reference = r) };
    }

    it('verifica x-signature, consulta el pago en Mercado Pago y lo aprueba con la comisión de la pasarela', async () => {
      const { app, calls, setReference } = mpApp();
      const v = await variantOf('sauco');
      const order = await placeOrder(app, v.id, 1, { paymentProvider: 'MERCADOPAGO' });
      expect(order.redirectUrl).toBe('https://mp.example/checkout');
      setReference(order.reference);

      const res = await request(app)
        .post('/api/webhooks/mercadopago?data.id=987&type=payment')
        .set('x-signature', sign('987', 'req-1'))
        .set('x-request-id', 'req-1')
        .send({ type: 'payment', data: { id: '987' } });
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('paid');
      expect(calls.some((c) => c.endsWith('/v1/payments/987'))).toBe(true);
      const paid = await getTestDb().order.findFirstOrThrow();
      expect(paid).toMatchObject({
        status: 'PAID',
        commissionAmount: 6_490,
        gatewayFeeAmount: 2_500,
        merchantNetAmount: 64_900 - 6_490 - 2_500,
      });
    });

    it('rechaza una firma inválida sin consultar a Mercado Pago', async () => {
      const { app, calls } = mpApp();
      const res = await request(app)
        .post('/api/webhooks/mercadopago?data.id=987&type=payment')
        .set('x-signature', 'ts=1731000000,v1=deadbeef')
        .set('x-request-id', 'req-1')
        .send({});
      expect(res.status).toBe(401);
      expect(calls.filter((c) => c.includes('/v1/payments'))).toHaveLength(0);
    });
  });
});
