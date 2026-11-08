import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { bearer, seedCatalog } from '../test/catalog-fixtures.js';
import {
  TEST_PASSWORD,
  buildTestApp,
  createUser,
  getTestDb,
  hasTestDatabase,
  resetDatabase,
} from '../test/integration.js';
import { checkoutAddress, variantBySlug } from '../test/order-fixtures.js';

type App = ReturnType<typeof buildTestApp>['app'];
type Headers = Awaited<ReturnType<typeof bearer>>;

/** Signed-in purchase through the real API, approved with the mock provider. */
async function buyAsUser(app: App, headers: Headers, variantId: string, quantity: number) {
  const add = await request(app).post('/api/cart/items').set(headers).send({ variantId, quantity });
  expect(add.status, JSON.stringify(add.body)).toBe(201);
  const checkout = await request(app)
    .post('/api/checkout')
    .set(headers)
    .send({
      contact: { name: 'Cliente Prueba', email: 'ignorado@example.com', phone: '3001234567' },
      address: checkoutAddress,
      paymentProvider: 'MOCK',
      acceptTerms: true,
      acceptDataPolicy: true,
    });
  expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
  const paid = await request(app)
    .post('/api/payments/mock/complete')
    .set(headers)
    .send({ reference: checkout.body.data.reference, outcome: 'approve' });
  expect(paid.status).toBe(200);
  return checkout.body.data.orderNumber as string;
}

const markDelivered = (number: string) =>
  getTestDb().order.update({
    where: { number: Number(number.slice(4)) },
    data: { status: 'DELIVERED' },
  });

async function customers(app: App) {
  await createUser({ email: 'ana@example.com', name: 'Ana Gómez' });
  await createUser({ email: 'beto@example.com', name: 'Beto Ruiz' });
  return {
    ana: await bearer(app, 'ana@example.com', TEST_PASSWORD),
    beto: await bearer(app, 'beto@example.com', TEST_PASSWORD),
  };
}

describe.skipIf(!hasTestDatabase)('mi cuenta (integración)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    await getTestDb().commissionRule.create({ data: { scope: 'GLOBAL', rateBps: 1000 } });
  });

  it('exige sesión', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/api/account/profile')).status).toBe(401);
  });

  describe('perfil', () => {
    it('edita nombre, teléfono y documento, pero nunca el correo', async () => {
      const { app } = buildTestApp();
      const { ana } = await customers(app);
      const res = await request(app).put('/api/account/profile').set(ana).send({
        name: 'Ana María Gómez',
        phone: '3109876543',
        documentNumber: '1020304050',
        email: 'otro@example.com',
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Ana María Gómez',
        phone: '3109876543',
        documentNumber: '1020304050',
        email: 'ana@example.com',
        wholesaleStatus: 'NONE',
      });

      const bad = await request(app).put('/api/account/profile').set(ana).send({ name: 'A' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details[0].message).toBe('Escribe tu nombre');
    });
  });

  describe('pedidos', () => {
    it('cada cliente ve solo sus pedidos, con el seguimiento', async () => {
      const { app } = buildTestApp();
      const { ana, beto } = await customers(app);
      const v = await variantBySlug('sauco');
      const number = await buyAsUser(app, ana, v.id, 1);
      await getTestDb().shipment.create({
        data: {
          order: { connect: { number: Number(number.slice(4)) } },
          carrier: 'Servientrega',
          trackingNumber: '123456789',
          trackingUrl: 'https://www.servientrega.com/rastreo',
          shippedAt: new Date(),
        },
      });

      const list = await request(app).get('/api/account/orders').set(ana);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ number, status: 'PAID', total: 64_900 });

      const detail = await request(app).get(`/api/account/orders/${number}`).set(ana);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        number,
        shipment: { carrier: 'Servientrega', trackingNumber: '123456789' },
      });
      expect(detail.body.data.items[0]).toMatchObject({
        productSlug: 'sauco',
        reviewable: false, // not delivered yet
      });
      expect(detail.body.data.commission).toBeUndefined();

      expect((await request(app).get('/api/account/orders').set(beto)).body.data).toHaveLength(0);
      expect((await request(app).get(`/api/account/orders/${number}`).set(beto)).status).toBe(404);
    });
  });

  describe('lista de deseos', () => {
    it('agrega, lista y quita productos publicados', async () => {
      const { app } = buildTestApp();
      const { ana, beto } = await customers(app);
      const sauco = await getTestDb().product.findFirstOrThrow({ where: { slug: 'sauco' } });
      const draft = await getTestDb().product.findFirstOrThrow({ where: { status: 'DRAFT' } });

      expect(
        (await request(app).post('/api/account/wishlist').set(ana).send({ productId: sauco.id }))
          .status,
      ).toBe(201);
      // Adding twice is harmless.
      expect(
        (await request(app).post('/api/account/wishlist').set(ana).send({ productId: sauco.id }))
          .status,
      ).toBe(201);
      expect(
        (await request(app).post('/api/account/wishlist').set(ana).send({ productId: draft.id }))
          .status,
      ).toBe(404);

      const list = await request(app).get('/api/account/wishlist').set(ana);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ slug: 'sauco', name: 'Saúco Negro' });
      expect((await request(app).get('/api/account/wishlist').set(beto)).body.data).toHaveLength(0);

      const ids = await request(app).get('/api/account/wishlist/ids').set(ana);
      expect(ids.body.data).toEqual([sauco.id]);

      expect((await request(app).delete(`/api/account/wishlist/${sauco.id}`).set(ana)).status).toBe(
        204,
      );
      expect((await request(app).get('/api/account/wishlist').set(ana)).body.data).toHaveLength(0);
    });
  });

  describe('reseñas', () => {
    it('solo quien recibió el producto reseña; se publica tras moderación', async () => {
      const { app } = buildTestApp();
      const { ana, beto } = await customers(app);
      await createUser({ email: 'admin@example.com', role: 'ADMIN' });
      await createUser({ email: 'operador@example.com', role: 'OPERATOR' });
      const admin = await bearer(app, 'admin@example.com', TEST_PASSWORD);
      const operator = await bearer(app, 'operador@example.com', TEST_PASSWORD);
      const sauco = await getTestDb().product.findFirstOrThrow({ where: { slug: 'sauco' } });
      const v = await variantBySlug('sauco');
      const number = await buyAsUser(app, ana, v.id, 1);
      const review = {
        productId: sauco.id,
        rating: 5,
        title: 'Me encantó',
        comment: 'Llegó rápido.',
      };

      // Paid but not delivered yet: not allowed.
      const early = await request(app).post('/api/account/reviews').set(ana).send(review);
      expect(early.status).toBe(403);
      expect(early.body.error.message).toMatch(/recibiste/);
      // Never bought it.
      expect((await request(app).post('/api/account/reviews').set(beto).send(review)).status).toBe(
        403,
      );

      await markDelivered(number);
      const detail = await request(app).get(`/api/account/orders/${number}`).set(ana);
      expect(detail.body.data.items[0].reviewable).toBe(true);

      const created = await request(app).post('/api/account/reviews').set(ana).send(review);
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ status: 'PENDING', rating: 5 });

      // Not public until approved.
      const before = await request(app).get('/api/catalog/products/sauco/reviews');
      expect(before.body.data).toHaveLength(0);
      expect(before.body.meta).toMatchObject({ count: 0, average: null });

      // Only the admin moderates.
      const id = created.body.data.id as string;
      expect(
        (
          await request(app)
            .post(`/api/admin/reviews/${id}/moderate`)
            .set(operator)
            .send({ status: 'APPROVED' })
        ).status,
      ).toBe(403);
      const pending = await request(app).get('/api/admin/reviews').set(admin);
      expect(pending.body.data).toHaveLength(1);
      expect(pending.body.data[0]).toMatchObject({
        authorName: 'Ana Gómez',
        productName: 'Saúco Negro',
      });
      const approved = await request(app)
        .post(`/api/admin/reviews/${id}/moderate`)
        .set(admin)
        .send({ status: 'APPROVED' });
      expect(approved.status).toBe(200);
      expect(await getTestDb().auditLog.count({ where: { action: 'review.moderate' } })).toBe(1);

      const after = await request(app).get('/api/catalog/products/sauco/reviews');
      expect(after.body.data).toHaveLength(1);
      expect(after.body.data[0]).toMatchObject({ rating: 5, authorName: 'Ana G.', verified: true });
      expect(after.body.data[0].email).toBeUndefined();
      expect(after.body.meta).toMatchObject({ count: 1, average: 5 });
      const product = await request(app).get('/api/catalog/products/sauco');
      expect(product.body.data.rating).toEqual({ average: 5, count: 1 });

      // Editing sends it back to moderation (one review per product).
      const edited = await request(app)
        .post('/api/account/reviews')
        .set(ana)
        .send({ ...review, rating: 3 });
      expect(edited.status).toBe(201);
      expect(edited.body.data).toMatchObject({ id, status: 'PENDING', rating: 3 });
      expect(
        (await request(app).get('/api/catalog/products/sauco/reviews')).body.data,
      ).toHaveLength(0);

      const mine = await request(app).get('/api/account/reviews').set(ana);
      expect(mine.body.data).toHaveLength(1);
      expect((await request(app).get('/api/account/reviews').set(beto)).body.data).toHaveLength(0);
    });
  });

  describe('mayoristas', () => {
    it('solicitud, aprobación con correo y precio mayorista solo desde el mínimo', async () => {
      const { app, email } = buildTestApp();
      const { ana } = await customers(app);
      await createUser({ email: 'admin@example.com', role: 'ADMIN' });
      const admin = await bearer(app, 'admin@example.com', TEST_PASSWORD);

      const asked = await request(app)
        .post('/api/account/wholesale')
        .set(ana)
        .send({ businessName: 'Droguería La Esquina', note: 'Tienda en Envigado' });
      expect(asked.status).toBe(200);
      expect(asked.body.data).toMatchObject({ wholesaleStatus: 'PENDING' });
      expect(
        (await request(app).post('/api/account/wholesale').set(ana).send({ businessName: 'Otra' }))
          .status,
      ).toBe(409);

      // Pending is not approved: still retail.
      const v = await variantBySlug('sauco'); // retail 64.900, wholesale 48.900 from 6
      const productBefore = await request(app).get('/api/catalog/products/sauco').set(ana);
      expect(productBefore.body.data.variants[0].wholesalePrice).toBeNull();

      const requests = await request(app).get('/api/admin/wholesale').set(admin);
      expect(requests.body.data).toHaveLength(1);
      expect(requests.body.data[0]).toMatchObject({
        name: 'Ana Gómez',
        businessName: 'Droguería La Esquina',
      });
      const userId = requests.body.data[0].id as string;
      const decided = await request(app)
        .post(`/api/admin/wholesale/${userId}`)
        .set(admin)
        .send({ decision: 'APPROVED' });
      expect(decided.status).toBe(200);
      expect(email.sent.at(-1)?.subject).toBe('Tu cuenta mayorista fue aprobada');
      expect(await getTestDb().auditLog.count({ where: { action: 'user.wholesale.decide' } })).toBe(
        1,
      );

      const productAfter = await request(app).get('/api/catalog/products/sauco').set(ana);
      expect(productAfter.body.data.variants[0]).toMatchObject({
        wholesalePrice: 48_900,
        wholesaleMinQty: 6,
      });

      // Below the minimum pays retail; at the minimum pays wholesale, computed on the server.
      const retailOrder = await buyAsUser(app, ana, v.id, 2);
      const wholesaleOrder = await buyAsUser(app, ana, v.id, 6);
      const db = getTestDb();
      expect(
        await db.order.findUniqueOrThrow({ where: { number: Number(retailOrder.slice(4)) } }),
      ).toMatchObject({ priceTier: 'RETAIL', total: 129_800 });
      expect(
        await db.order.findUniqueOrThrow({ where: { number: Number(wholesaleOrder.slice(4)) } }),
      ).toMatchObject({ priceTier: 'WHOLESALE', total: 293_400 });
    });

    it('el rechazo avisa al cliente y le deja volver a solicitar', async () => {
      const { app, email } = buildTestApp();
      const { ana } = await customers(app);
      await createUser({ email: 'admin@example.com', role: 'ADMIN' });
      const admin = await bearer(app, 'admin@example.com', TEST_PASSWORD);
      await request(app)
        .post('/api/account/wholesale')
        .set(ana)
        .send({ businessName: 'Droguería La Esquina' });
      const user = await getTestDb().user.findUniqueOrThrow({
        where: { email: 'ana@example.com' },
      });
      await request(app)
        .post(`/api/admin/wholesale/${user.id}`)
        .set(admin)
        .send({ decision: 'REJECTED' });
      expect(email.sent.at(-1)?.subject).toBe('Respuesta a tu solicitud de cuenta mayorista');
      const again = await request(app)
        .post('/api/account/wholesale')
        .set(ana)
        .send({ businessName: 'Droguería La Esquina SAS' });
      expect(again.body.data.wholesaleStatus).toBe('PENDING');
    });
  });
});
