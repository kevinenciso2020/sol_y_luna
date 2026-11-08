import request from 'supertest';
import { previousSettlementPeriod } from '@sol-y-luna/shared';
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
import { placeGuestOrder, placePaidOrder, variantBySlug } from '../test/order-fixtures.js';

type App = ReturnType<typeof buildTestApp>['app'];

async function staff(app: App) {
  await createUser({ email: 'admin@example.com', role: 'ADMIN' });
  await createUser({ email: 'operador@example.com', role: 'OPERATOR' });
  return {
    admin: await bearer(app, 'admin@example.com', TEST_PASSWORD),
    operator: await bearer(app, 'operador@example.com', TEST_PASSWORD),
  };
}

describe.skipIf(!hasTestDatabase)('panel de negocio (integración)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    await getTestDb().commissionRule.create({ data: { scope: 'GLOBAL', rateBps: 1000 } });
  });

  describe('pedidos del operador', () => {
    it('solo ve pedidos pagados y no ve los pendientes de pago', async () => {
      const { app } = buildTestApp();
      const { operator } = await staff(app);
      const v = await variantBySlug('sauco');
      const paid = await placePaidOrder(app, v.id, 1);
      const pending = await placeGuestOrder(app, v.id, 1, 'otro@example.com');

      const list = await request(app).get('/api/operator/orders').set(operator);
      expect(list.status).toBe(200);
      expect(list.body.data.map((o: { number: string }) => o.number)).toEqual([paid.orderNumber]);
      expect(list.body.meta.total).toBe(1);

      const hidden = await request(app)
        .get(`/api/operator/orders/${pending.orderNumber}`)
        .set(operator);
      expect(hidden.status).toBe(404);

      const detail = await request(app)
        .get(`/api/operator/orders/${paid.orderNumber}`)
        .set(operator);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        status: 'PAID',
        discreetPackaging: true,
        shipping: { municipality: 'Medellín', addressLine: 'Calle 10 # 43-20' },
      });
      // The operator never sees commission data.
      expect(detail.body.data.commission).toBeUndefined();
    });

    it('prepara, despacha con guía (email al cliente) y entrega', async () => {
      const { app, email } = buildTestApp();
      const { operator } = await staff(app);
      const v = await variantBySlug('sauco');
      const { orderNumber } = await placePaidOrder(app, v.id, 1);

      // PAID → SHIPPED skips a step: rejected.
      const early = await request(app)
        .put(`/api/operator/orders/${orderNumber}/shipment`)
        .set(operator)
        .send({ carrier: 'Servientrega', trackingNumber: '9988776655' });
      expect(early.status).toBe(409);

      const preparing = await request(app)
        .post(`/api/operator/orders/${orderNumber}/status`)
        .set(operator)
        .send({ status: 'PREPARING' });
      expect(preparing.status).toBe(200);
      expect(preparing.body.data.status).toBe('PREPARING');

      const shipped = await request(app)
        .put(`/api/operator/orders/${orderNumber}/shipment`)
        .set(operator)
        .send({
          carrier: 'Servientrega',
          trackingNumber: '9988776655',
          trackingUrl: 'https://www.servientrega.com/rastreo?guia=9988776655',
        });
      expect(shipped.status).toBe(200);
      expect(shipped.body.data).toMatchObject({
        status: 'SHIPPED',
        shipment: { carrier: 'Servientrega', trackingNumber: '9988776655' },
      });
      const mail = email.sent.at(-1)!;
      expect(mail.subject).toBe(`Tu pedido ${orderNumber} va en camino`);
      expect(mail.text).toContain('9988776655');

      // Correcting the tracking number later does not send a second email.
      const fixed = await request(app)
        .put(`/api/operator/orders/${orderNumber}/shipment`)
        .set(operator)
        .send({ carrier: 'Servientrega', trackingNumber: '9988776656' });
      expect(fixed.status).toBe(200);
      expect(email.sent.filter((m) => m.subject.includes('va en camino'))).toHaveLength(1);

      const delivered = await request(app)
        .post(`/api/operator/orders/${orderNumber}/status`)
        .set(operator)
        .send({ status: 'DELIVERED' });
      expect(delivered.status).toBe(200);
      expect(delivered.body.data.shipment.deliveredAt).toBeTruthy();

      const order = await getTestDb().order.findFirstOrThrow({
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      });
      expect(order.statusHistory.map((h) => h.toStatus)).toEqual([
        'PENDING_PAYMENT',
        'PAID',
        'PREPARING',
        'SHIPPED',
        'DELIVERED',
      ]);
      expect(order.statusHistory.at(-1)!.changedById).not.toBeNull();
      expect(
        await getTestDb().auditLog.count({ where: { action: 'order.status.change' } }),
      ).toBeGreaterThanOrEqual(3);
    });

    it('rechaza transiciones inválidas y los estados que no le corresponden', async () => {
      const { app } = buildTestApp();
      const { operator } = await staff(app);
      const v = await variantBySlug('sauco');
      const { orderNumber } = await placePaidOrder(app, v.id, 1);

      const back = await request(app)
        .post(`/api/operator/orders/${orderNumber}/status`)
        .set(operator)
        .send({ status: 'DELIVERED' });
      expect(back.status).toBe(409);
      expect(back.body.error.message).toMatch(/no puede pasar/);

      const cancel = await request(app)
        .post(`/api/operator/orders/${orderNumber}/status`)
        .set(operator)
        .send({ status: 'CANCELLED' });
      expect(cancel.status).toBe(403);
    });

    it('no puede ver comisiones ni registrar reembolsos', async () => {
      const { app } = buildTestApp();
      const { operator } = await staff(app);
      expect((await request(app).get('/api/admin/commission-rules').set(operator)).status).toBe(
        403,
      );
      expect(
        (
          await request(app)
            .post('/api/admin/orders/SYL-000001/refunds')
            .set(operator)
            .send({ amount: 1000, reason: 'x' })
        ).status,
      ).toBe(403);
      expect((await request(app).post('/api/operator/settlements').set(operator)).status).toBe(404);
    });
  });

  describe('stock', () => {
    it('ajusta con motivo, deja movimiento y auditoría, y nunca baja de lo reservado', async () => {
      const { app } = buildTestApp();
      const { operator } = await staff(app);
      const v = await variantBySlug('sauco');
      await placeGuestOrder(app, v.id, 3); // 3 reserved

      const up = await request(app)
        .post(`/api/operator/inventory/${v.id}/adjust`)
        .set(operator)
        .send({ delta: 5, reason: 'RESTOCK', note: 'Llegó pedido del proveedor' });
      expect(up.status).toBe(200);
      expect(up.body.data).toMatchObject({ stock: 15, reservedStock: 3, available: 12 });

      const tooLow = await request(app)
        .post(`/api/operator/inventory/${v.id}/adjust`)
        .set(operator)
        .send({ delta: -13, reason: 'ADJUSTMENT', note: 'conteo' });
      expect(tooLow.status).toBe(409);
      expect((await variantBySlug('sauco')).stock).toBe(15);

      const movements = await getTestDb().inventoryMovement.findMany({
        where: { variantId: v.id, reason: 'RESTOCK' },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ delta: 5, reference: 'Llegó pedido del proveedor' });
      expect(await getTestDb().auditLog.count({ where: { action: 'variant.stock.adjust' } })).toBe(
        1,
      );

      const list = await request(app).get('/api/operator/inventory?q=sauco').set(operator);
      expect(list.status).toBe(200);
      expect(list.body.data[0]).toMatchObject({ sku: v.sku, stock: 15, available: 12 });
    });
  });

  describe('reembolsos y cancelaciones (admin)', () => {
    it('parcial reversa la comisión en proporción; total la deja en cero y devuelve stock', async () => {
      const { app } = buildTestApp();
      const { admin } = await staff(app);
      const v = await variantBySlug('sauco');
      const { orderNumber } = await placePaidOrder(app, v.id, 2); // 129.800, comisión 12.980

      const partial = await request(app)
        .post(`/api/admin/orders/${orderNumber}/refunds`)
        .set(admin)
        .send({ amount: 32_450, reason: 'Un frasco llegó roto' });
      expect(partial.status).toBe(201);
      expect(partial.body.data).toMatchObject({
        status: 'PAID',
        refundedAmount: 32_450,
        commission: { amount: 12_980, refunded: 3_245, current: 9_735 },
      });

      const tooMuch = await request(app)
        .post(`/api/admin/orders/${orderNumber}/refunds`)
        .set(admin)
        .send({ amount: 100_000, reason: 'x' });
      expect(tooMuch.status).toBe(400);

      const full = await request(app)
        .post(`/api/admin/orders/${orderNumber}/refunds`)
        .set(admin)
        .send({ amount: 97_350, reason: 'Cliente desistió (retracto)', restock: true });
      expect(full.status).toBe(201);
      expect(full.body.data).toMatchObject({
        status: 'REFUNDED',
        refundedAmount: 129_800,
        commission: { amount: 12_980, refunded: 12_980, current: 0 },
      });
      expect((await variantBySlug('sauco')).stock).toBe(10);
      expect(
        await getTestDb().inventoryMovement.count({ where: { variantId: v.id, reason: 'RETURN' } }),
      ).toBe(1);
      expect(await getTestDb().auditLog.count({ where: { action: 'order.refund' } })).toBe(2);
    });

    it('cancela un pedido sin pagar y libera la reserva; uno pagado exige reembolso', async () => {
      const { app } = buildTestApp();
      const { admin } = await staff(app);
      const v = await variantBySlug('sauco');
      const pending = await placeGuestOrder(app, v.id, 2);
      const res = await request(app)
        .post(`/api/admin/orders/${pending.orderNumber}/status`)
        .set(admin)
        .send({ status: 'CANCELLED', note: 'Cliente pidió cancelar' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      expect((await variantBySlug('sauco')).reservedStock).toBe(0);

      const paid = await placePaidOrder(app, v.id, 1);
      const blocked = await request(app)
        .post(`/api/admin/orders/${paid.orderNumber}/status`)
        .set(admin)
        .send({ status: 'CANCELLED' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.message).toMatch(/reembolso/);
    });
  });

  describe('comisiones', () => {
    it('el admin crea una regla por categoría que prevalece sobre la global', async () => {
      const { app } = buildTestApp();
      const { admin } = await staff(app);
      const sauco = await getTestDb().product.findFirstOrThrow({ where: { slug: 'sauco' } });
      const created = await request(app)
        .post('/api/admin/commission-rules')
        .set(admin)
        .send({ scope: 'CATEGORY', categoryId: sauco.categoryId, rateBps: 500 });
      expect(created.status).toBe(201);
      expect(await getTestDb().auditLog.count({ where: { action: 'commission.create' } })).toBe(1);

      const list = await request(app).get('/api/admin/commission-rules').set(admin);
      expect(list.body.data).toHaveLength(2);

      const v = await variantBySlug('sauco');
      await placePaidOrder(app, v.id, 2);
      const order = await getTestDb().order.findFirstOrThrow({ where: { status: 'PAID' } });
      expect(order).toMatchObject({ commissionRateBps: 500, commissionAmount: 6_490 });

      // The last active GLOBAL rule cannot be deleted.
      const global = list.body.data.find((r: { scope: string }) => r.scope === 'GLOBAL');
      const del = await request(app).delete(`/api/admin/commission-rules/${global.id}`).set(admin);
      expect(del.status).toBe(400);
    });
  });

  describe('liquidaciones', () => {
    it('cuadra al peso con reembolsos, se cierra, se paga y se exporta a CSV', async () => {
      const { app } = buildTestApp();
      const { admin, operator } = await staff(app);
      const v = await variantBySlug('sauco');
      const a = await placePaidOrder(app, v.id, 2); // 129.800 → comisión 12.980
      await placePaidOrder(app, v.id, 1); // 64.900 → comisión 6.490
      await request(app)
        .post(`/api/admin/orders/${a.orderNumber}/refunds`)
        .set(admin)
        .send({ amount: 64_900, reason: 'Devolución de un frasco' }); // reversa 6.490

      // Move everything into the last finished period (the default one to settle).
      const past = previousSettlementPeriod(new Date(), 'BIWEEKLY');
      const inPast = new Date(past.start.getTime() + 24 * 60 * 60 * 1000);
      await getTestDb().order.updateMany({ data: { paidAt: inPast } });
      await getTestDb().orderRefund.updateMany({ data: { createdAt: inPast } });

      // A settlement of the current period can exist, but it cannot be closed before it ends.
      const current = await request(app)
        .post('/api/admin/settlements')
        .set(admin)
        .send({ date: new Date().toISOString() });
      expect(current.status).toBe(201);
      expect(current.body.data.orderCount).toBe(0);
      expect(
        (await request(app).post(`/api/admin/settlements/${current.body.data.id}/close`).set(admin))
          .status,
      ).toBe(409);

      const generated = await request(app).post('/api/admin/settlements').set(admin).send({});
      expect(generated.status).toBe(201);
      const s = generated.body.data;
      expect(s).toMatchObject({
        status: 'OPEN',
        orderCount: 2,
        grossSales: 194_700,
        refundTotal: 64_900,
        commissionTotal: 12_980,
        gatewayFeeTotal: 0,
        netTotal: 194_700 - 64_900 - 12_980,
      });

      const again = await request(app).post('/api/admin/settlements').set(admin).send({});
      expect(again.status).toBe(409);

      const forOperator = await request(app).get(`/api/operator/settlements/${s.id}`).set(operator);
      expect(forOperator.status).toBe(200);
      expect(forOperator.body.data.orders).toHaveLength(2);

      const csv = await request(app).get(`/api/admin/settlements/${s.id}/csv`).set(admin);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text.trim().split('\r\n').at(-1)).toBe(
        `Total;;;;194700;64900;12980;0;${194_700 - 64_900 - 12_980}`,
      );

      expect(
        (await request(app).post(`/api/admin/settlements/${s.id}/pay`).set(admin)).status,
      ).toBe(409); // must be closed first
      const closed = await request(app).post(`/api/admin/settlements/${s.id}/close`).set(admin);
      expect(closed.body.data.status).toBe('CLOSED');
      expect(
        (await request(app).post(`/api/admin/settlements/${s.id}/recalculate`).set(admin)).status,
      ).toBe(409);
      const paidOut = await request(app).post(`/api/admin/settlements/${s.id}/pay`).set(admin);
      expect(paidOut.body.data).toMatchObject({ status: 'PAID' });
      expect(paidOut.body.data.paidAt).toBeTruthy();
    });
  });

  describe('dashboard', () => {
    it('resume ventas, pedidos, ticket promedio, más vendidos, stock bajo y comisión', async () => {
      const { app } = buildTestApp();
      const { admin } = await staff(app);
      const v = await variantBySlug('sauco');
      await placePaidOrder(app, v.id, 2);
      await placePaidOrder(app, v.id, 1);
      await placeGuestOrder(app, v.id, 1, 'pendiente@example.com'); // not counted

      const res = await request(app).get('/api/admin/dashboard?days=30').set(admin);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        sales: 194_700,
        orders: 2,
        averageTicket: 97_350,
        commission: 19_470,
      });
      expect(res.body.data.topProducts[0]).toMatchObject({ name: 'Saúco Negro', quantity: 3 });
      expect(Array.isArray(res.body.data.lowStock)).toBe(true);
    });
  });
});
