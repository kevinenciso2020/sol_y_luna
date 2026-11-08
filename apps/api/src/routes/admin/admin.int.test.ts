import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCloudinaryService } from '../../services/cloudinary.js';
import { bearer, seedCatalog } from '../../test/catalog-fixtures.js';
import {
  TEST_PASSWORD,
  buildTestApp,
  createUser,
  getTestDb,
  hasTestDatabase,
  resetDatabase,
} from '../../test/integration.js';

const productBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Colágeno Hidrolizado',
  slug: 'colageno-hidrolizado',
  shortDescription: 'Colágeno en polvo.',
  benefits: ['Fácil de mezclar', 'Sin sabor'],
  audience: 'UNISEX',
  invimaStatus: 'IN_PROCESS',
  status: 'ACTIVE',
  variants: [
    { name: '300 g', sku: 'col-300', retailPrice: 89_900, wholesalePrice: 69_900, stock: 20 },
    { name: '600 g', sku: 'col-600', retailPrice: 159_900, stock: 5 },
  ],
  images: [{ publicId: '/placeholders/frasco.svg', alt: 'Colágeno' }],
  ...overrides,
});

describe.skipIf(!hasTestDatabase)('admin (integración)', () => {
  let admin: { Authorization: string };
  let adminId: string;
  let app: ReturnType<typeof buildTestApp>['app'];
  let email: ReturnType<typeof buildTestApp>['email'];

  beforeEach(async () => {
    await resetDatabase();
    ({ app, email } = buildTestApp());
    adminId = (await createUser({ email: 'admin@example.com', role: 'ADMIN', name: 'Kevin' })).id;
    admin = await bearer(app, 'admin@example.com', TEST_PASSWORD);
  });

  const auditActions = async () =>
    (await getTestDb().auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((a) => a.action);

  describe('permisos', () => {
    it('solo ADMIN usa la API de administración', async () => {
      await createUser({ email: 'cliente@example.com' });
      await createUser({ email: 'operador@example.com', role: 'OPERATOR' });
      const customer = await bearer(app, 'cliente@example.com', TEST_PASSWORD);
      const operator = await bearer(app, 'operador@example.com', TEST_PASSWORD);
      expect((await request(app).get('/api/admin/products')).status).toBe(401);
      expect((await request(app).get('/api/admin/products').set(customer)).status).toBe(403);
      expect((await request(app).get('/api/admin/products').set(operator)).status).toBe(403);
      expect((await request(app).get('/api/admin/users').set(operator)).status).toBe(403);
      expect((await request(app).get('/api/admin/products').set(admin)).status).toBe(200);
      // Operators can upload images, customers cannot.
      expect((await request(app).get('/api/uploads/status').set(operator)).status).toBe(200);
      expect((await request(app).get('/api/uploads/status').set(customer)).status).toBe(403);
    });
  });

  describe('productos', () => {
    it('crea un producto con presentaciones e imágenes y lo publica en el catálogo', async () => {
      const res = await request(app).post('/api/admin/products').set(admin).send(productBody());
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        minRetailPrice: 89_900,
        status: 'ACTIVE',
        benefits: ['Fácil de mezclar', 'Sin sabor'],
      });
      expect(res.body.data.variants.map((v: { sku: string }) => v.sku)).toEqual([
        'COL-300',
        'COL-600',
      ]);

      const store = await request(app).get('/api/catalog/products/colageno-hidrolizado');
      expect(store.status).toBe(200);
      expect(await auditActions()).toContain('product.create');
      const movements = await getTestDb().inventoryMovement.findMany();
      expect(movements.map((m) => m.delta).sort()).toEqual([20, 5]);
    });

    it('exige el número INVIMA si el estado es REGISTERED', async () => {
      const res = await request(app)
        .post('/api/admin/products')
        .set(admin)
        .send(productBody({ invimaStatus: 'REGISTERED' }));
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({
        path: ['invimaCode'],
        message: 'Escribe el número de registro INVIMA',
      });
    });

    it('responde 409 con slug o SKU repetidos', async () => {
      await request(app).post('/api/admin/products').set(admin).send(productBody());
      const slug = await request(app)
        .post('/api/admin/products')
        .set(admin)
        .send(
          productBody({ variants: [{ name: 'x', sku: 'otro-1', retailPrice: 1000, stock: 1 }] }),
        );
      expect(slug.status).toBe(409);
      expect(slug.body.error.message).toBe('Ya existe un registro con ese slug');
      const sku = await request(app)
        .post('/api/admin/products')
        .set(admin)
        .send(productBody({ slug: 'otro' }));
      expect(sku.status).toBe(409);
      expect(sku.body.error.message).toBe('Ya existe una presentación con ese SKU');
    });

    it('rechaza imágenes que no son de la tienda', async () => {
      const res = await request(app)
        .post('/api/admin/products')
        .set(admin)
        .send(productBody({ images: [{ publicId: 'otra-cuenta/foto', alt: 'x' }] }));
      expect(res.status).toBe(400);
    });

    it('edita precios y stock dejando auditoría y movimientos de inventario', async () => {
      const created = (
        await request(app).post('/api/admin/products').set(admin).send(productBody())
      ).body.data;
      const [v300, v600] = created.variants;
      const res = await request(app)
        .put(`/api/admin/products/${created.id}`)
        .set(admin)
        .send(
          productBody({
            name: 'Colágeno Premium',
            variants: [
              { ...v300, retailPrice: 79_900, stock: 25 },
              { name: '1 kg', sku: 'col-1000', retailPrice: 249_900, stock: 3 },
            ],
            images: [
              { publicId: '/placeholders/gotero.svg', alt: 'Nueva' },
              { id: created.images[0].id, publicId: created.images[0].publicId, alt: 'Primera' },
            ],
          }),
        );
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Colágeno Premium');
      expect(res.body.data.minRetailPrice).toBe(79_900);
      expect(res.body.data.variants.map((v: { sku: string }) => v.sku)).toEqual([
        'COL-300',
        'COL-1000',
      ]);
      expect(res.body.data.images.map((i: { alt: string }) => i.alt)).toEqual(['Nueva', 'Primera']);
      expect(await getTestDb().productVariant.findUnique({ where: { id: v600.id } })).toBeNull();

      const actions = await auditActions();
      expect(actions).toEqual(
        expect.arrayContaining([
          'product.update',
          'variant.price.update',
          'variant.stock.update',
          'variant.create',
          'variant.delete',
        ]),
      );
      const priceLog = await getTestDb().auditLog.findFirstOrThrow({
        where: { action: 'variant.price.update' },
      });
      expect(priceLog.diff).toMatchObject({ retailPrice: { from: 89_900, to: 79_900 } });
      expect(priceLog.actorId).toBe(adminId);
      const adjustment = await getTestDb().inventoryMovement.findFirstOrThrow({
        where: { reason: 'ADJUSTMENT' },
      });
      expect(adjustment.delta).toBe(5);
    });

    it('no deja el stock por debajo de lo reservado', async () => {
      const created = (
        await request(app).post('/api/admin/products').set(admin).send(productBody())
      ).body.data;
      await getTestDb().productVariant.update({
        where: { id: created.variants[0].id },
        data: { reservedStock: 4 },
      });
      const res = await request(app)
        .put(`/api/admin/products/${created.id}`)
        .set(admin)
        .send(
          productBody({ variants: [{ ...created.variants[0], stock: 2 }, created.variants[1]] }),
        );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STOCK_BELOW_RESERVED');
    });

    it('archiva y borra (soft delete) liberando el slug', async () => {
      const created = (
        await request(app).post('/api/admin/products').set(admin).send(productBody())
      ).body.data;
      const archived = await request(app)
        .patch(`/api/admin/products/${created.id}/status`)
        .set(admin)
        .send({ status: 'ARCHIVED' });
      expect(archived.body.data.status).toBe('ARCHIVED');
      expect((await request(app).get('/api/catalog/products/colageno-hidrolizado')).status).toBe(
        404,
      );

      expect(
        (await request(app).delete(`/api/admin/products/${created.id}`).set(admin)).status,
      ).toBe(204);
      expect((await request(app).get(`/api/admin/products/${created.id}`).set(admin)).status).toBe(
        404,
      );
      const row = await getTestDb().product.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.deletedAt).not.toBeNull();
      // The slug is free again (SKUs are not: they belong to the stored variants).
      const again = await request(app)
        .post('/api/admin/products')
        .set(admin)
        .send(
          productBody({
            variants: [{ name: '300 g', sku: 'col-300-b', retailPrice: 89_900, stock: 1 }],
          }),
        );
      expect(again.status).toBe(201);
      expect(await auditActions()).toEqual(
        expect.arrayContaining(['product.status.update', 'product.delete']),
      );
    });

    it('lista y filtra productos sin categoría', async () => {
      await seedCatalog();
      const res = await request(app).get('/api/admin/products?categoryId=none').set(admin);
      expect(res.body.data.map((p: { slug: string }) => p.slug).sort()).toEqual([
        'borrador',
        'gel-18',
        'mentas',
      ]);
      const search = await request(app).get('/api/admin/products?q=TURKESTERONE').set(admin);
      expect(search.body.data).toHaveLength(1);
    });
  });

  describe('categorías', () => {
    it('crea subcategorías y evita ciclos', async () => {
      const parent = (
        await request(app)
          .post('/api/admin/categories')
          .set(admin)
          .send({ name: 'Bienestar', slug: 'bienestar' })
      ).body.data;
      const child = await request(app)
        .post('/api/admin/categories')
        .set(admin)
        .send({ name: 'Vitaminas', slug: 'vitaminas', parentId: parent.id });
      expect(child.status).toBe(201);
      const cycle = await request(app)
        .put(`/api/admin/categories/${parent.id}`)
        .set(admin)
        .send({ name: 'Bienestar', slug: 'bienestar', parentId: child.body.data.id });
      expect(cycle.status).toBe(400);
      expect(cycle.body.error.message).toMatch(/dentro de sí misma/);
    });

    it('al borrar una categoría sus productos quedan sin categoría', async () => {
      const fx = await seedCatalog();
      const res = await request(app).delete(`/api/admin/categories/${fx.bienestar.id}`).set(admin);
      expect(res.status).toBe(204);
      const sauco = await getTestDb().product.findUniqueOrThrow({ where: { id: fx.sauco.id } });
      expect(sauco.categoryId).toBeNull();
      expect(sauco.deletedAt).toBeNull();
      const vitaminas = await getTestDb().category.findUniqueOrThrow({
        where: { id: fx.vitaminas.id },
      });
      expect(vitaminas.parentId).toBeNull();
      const list = await request(app).get('/api/admin/categories').set(admin);
      expect(list.body.meta.uncategorizedProducts).toBe(4); // 3 sin categoría + Saúco; Vitamina C sigue en su subcategoría
      expect(await auditActions()).toContain('category.delete');
    });
  });

  describe('marcas y cupones', () => {
    it('CRUD de marcas con tema validado', async () => {
      const bad = await request(app)
        .post('/api/admin/brands')
        .set(admin)
        .send({ name: 'WILD', slug: 'wild', theme: { accent: 'verde' } });
      expect(bad.status).toBe(400);
      const created = await request(app)
        .post('/api/admin/brands')
        .set(admin)
        .send({ name: 'WILD', slug: 'wild', theme: { mode: 'dark', accent: '#39ff14' } });
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      const updated = await request(app)
        .put(`/api/admin/brands/${id}`)
        .set(admin)
        .send({ name: 'WILD Energy', slug: 'wild' });
      expect(updated.body.data.name).toBe('WILD Energy');
      expect((await request(app).delete(`/api/admin/brands/${id}`).set(admin)).status).toBe(204);
    });

    it('CRUD de cupones', async () => {
      expect(
        (
          await request(app)
            .post('/api/admin/coupons')
            .set(admin)
            .send({ code: 'MEGA', type: 'PERCENT', value: 150 })
        ).status,
      ).toBe(400);
      const created = await request(app)
        .post('/api/admin/coupons')
        .set(admin)
        .send({ code: 'verano15', type: 'PERCENT', value: 15, minSubtotal: 50_000 });
      expect(created.status).toBe(201);
      expect(created.body.data.code).toBe('VERANO15');
      const dup = await request(app)
        .post('/api/admin/coupons')
        .set(admin)
        .send({ code: 'VERANO15', type: 'FIXED', value: 5000 });
      expect(dup.status).toBe(409);
      const id = created.body.data.id;
      const updated = await request(app)
        .put(`/api/admin/coupons/${id}`)
        .set(admin)
        .send({ code: 'VERANO15', type: 'FIXED', value: 10_000, isActive: false });
      expect(updated.body.data).toMatchObject({ type: 'FIXED', value: 10_000, isActive: false });
      expect((await request(app).delete(`/api/admin/coupons/${id}`).set(admin)).status).toBe(204);
    });
  });

  describe('usuarios', () => {
    it('cambia roles con auditoría y protege al último admin', async () => {
      const customer = await createUser({ email: 'cliente@example.com', name: 'Laura' });
      const res = await request(app)
        .put(`/api/admin/users/${customer.id}`)
        .set(admin)
        .send({ name: 'Laura', role: 'OPERATOR' });
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('OPERATOR');
      const log = await getTestDb().auditLog.findFirstOrThrow({
        where: { action: 'user.role.update' },
      });
      expect(log.diff).toMatchObject({ role: { from: 'CUSTOMER', to: 'OPERATOR' } });

      const self = await request(app)
        .put(`/api/admin/users/${adminId}`)
        .set(admin)
        .send({ name: 'Kevin', role: 'CUSTOMER' });
      expect(self.status).toBe(400);
      expect((await request(app).delete(`/api/admin/users/${adminId}`).set(admin)).status).toBe(
        400,
      );
    });

    it('crea un usuario y le envía el enlace para crear su contraseña', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set(admin)
        .send({ name: 'Bodega', email: 'bodega@example.com', role: 'OPERATOR' });
      expect(res.status).toBe(201);
      expect(email.sent.at(-1)?.to).toBe('bodega@example.com');
      const search = await request(app).get('/api/admin/users?q=bodega&role=OPERATOR').set(admin);
      expect(search.body.data).toHaveLength(1);
      expect(
        (await request(app).delete(`/api/admin/users/${res.body.data.id}`).set(admin)).status,
      ).toBe(204);
    });
  });

  describe('configuración y auditoría', () => {
    it('guarda la configuración de la tienda y registra qué cambió', async () => {
      const current = (await request(app).get('/api/admin/settings').set(admin)).body.data;
      const res = await request(app)
        .put('/api/admin/settings')
        .set(admin)
        .send({ ...current, whatsappNumber: '573001234567', legalTerms: '# Términos nuevos' });
      expect(res.status).toBe(200);
      const log = await getTestDb().auditLog.findFirstOrThrow({
        where: { action: 'settings.update' },
      });
      expect(log.diff).toMatchObject({
        whatsappNumber: { to: '573001234567' },
        legalTextsChanged: ['legalTerms'],
      });
      const audit = await request(app).get('/api/admin/audit?entity=StoreSettings').set(admin);
      expect(audit.body.data[0].actor.email).toBe('admin@example.com');
    });
  });

  describe('subida de imágenes', () => {
    it('sin Cloudinary la subida queda deshabilitada con un mensaje claro', async () => {
      const res = await request(app).post('/api/uploads/signature').set(admin).send({});
      expect(res.status).toBe(503);
      expect(res.body.error.message).toMatch(/faltan las credenciales de Cloudinary/);
    });

    it('firma en el servidor y verifica tipo, tamaño y carpeta', async () => {
      const calls: { url: string; method: string }[] = [];
      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET' });
        const big = String(url).includes('grande');
        return new Response(
          JSON.stringify({
            format: 'jpg',
            bytes: big ? 6 * 1024 * 1024 : 200_000,
            width: 800,
            height: 800,
          }),
          {
            status: 200,
          },
        );
      }) as typeof fetch;
      const cloudinary = createCloudinaryService(
        { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret', folder: 'sol-y-luna' },
        fakeFetch,
      );
      const built = buildTestApp({ cloudinary });
      const headers = await bearer(built.app, 'admin@example.com', TEST_PASSWORD);

      const sig = (
        await request(built.app)
          .post('/api/uploads/signature')
          .set(headers)
          .send({ kind: 'products' })
      ).body.data;
      const expected = createHash('sha1')
        .update(
          `allowed_formats=${sig.allowedFormats}&folder=sol-y-luna/products&timestamp=${sig.timestamp}secret`,
        )
        .digest('hex');
      expect(sig.signature).toBe(expected);
      expect(sig.maxBytes).toBe(5 * 1024 * 1024);
      expect(JSON.stringify(sig)).not.toContain('"secret"');

      const ok = await request(built.app)
        .post('/api/uploads/verify')
        .set(headers)
        .send({ publicId: 'sol-y-luna/products/foto' });
      expect(ok.status).toBe(200);
      const foreign = await request(built.app)
        .post('/api/uploads/verify')
        .set(headers)
        .send({ publicId: 'otra/foto' });
      expect(foreign.status).toBe(400);
      const big = await request(built.app)
        .post('/api/uploads/verify')
        .set(headers)
        .send({ publicId: 'sol-y-luna/products/grande' });
      expect(big.status).toBe(400);
      expect(big.body.error.message).toMatch(/5 MB/);
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });
});
