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

type Card = { slug: string; price: number };
const slugs = (body: { data: Card[] }) => body.data.map((p) => p.slug);

describe.skipIf(!hasTestDatabase)('catálogo público (integración)', () => {
  let fx: Awaited<ReturnType<typeof seedCatalog>>;
  beforeEach(async () => {
    await resetDatabase();
    fx = await seedCatalog();
  });

  it('lista solo productos activos, incluidos los que no tienen categoría', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/catalog/products?pageSize=48');
    expect(res.status).toBe(200);
    expect(slugs(res.body)).toEqual(
      expect.arrayContaining(['sauco', 'vitamina-c', 'turkesterone', 'mentas', 'gel-18']),
    );
    expect(slugs(res.body)).not.toContain('borrador');
    expect(res.body.meta.total).toBe(5);
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  it('el filtro por categoría incluye las subcategorías', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/catalog/products?category=bienestar');
    expect(slugs(res.body).sort()).toEqual(['sauco', 'vitamina-c']);
    expect((await request(app).get('/api/catalog/products?category=no-existe')).status).toBe(404);
  });

  it('filtra por audiencia, marca, INVIMA y rango de precio', async () => {
    const { app } = buildTestApp();
    expect(slugs((await request(app).get('/api/catalog/products?audience=HIM')).body)).toEqual([
      'turkesterone',
    ]);
    expect(slugs((await request(app).get('/api/catalog/products?brand=wild')).body)).toEqual([
      'mentas',
    ]);
    expect(slugs((await request(app).get('/api/catalog/products?invima=1')).body)).toEqual([
      'sauco',
    ]);
    const range = await request(app).get(
      '/api/catalog/products?minPrice=30000&maxPrice=60000&sort=price_asc',
    );
    expect(slugs(range.body)).toEqual(['vitamina-c', 'gel-18']);
  });

  it('ordena por precio y pagina con metadatos', async () => {
    const { app } = buildTestApp();
    const asc = await request(app).get('/api/catalog/products?sort=price_asc&pageSize=2');
    expect(asc.body.data.map((p: Card) => p.price)).toEqual([12_900, 39_900]);
    expect(asc.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    const desc = await request(app).get('/api/catalog/products?sort=price_desc&page=1&pageSize=1');
    expect(slugs(desc.body)).toEqual(['turkesterone']);
  });

  it('busca por texto sin distinguir mayúsculas, también por marca', async () => {
    const { app } = buildTestApp();
    expect(slugs((await request(app).get('/api/catalog/products?q=SAÚCO')).body)).toEqual([
      'sauco',
    ]);
    expect(slugs((await request(app).get('/api/catalog/products?q=wild')).body)).toEqual([
      'mentas',
    ]);
  });

  it('valida la query con mensajes en español', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/catalog/products?audience=ALIEN');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toBe('Audiencia inválida');
  });

  it('la ficha oculta el precio mayorista salvo a mayoristas aprobados', async () => {
    const { app } = buildTestApp();
    const anon = await request(app).get('/api/catalog/products/sauco');
    expect(anon.status).toBe(200);
    expect(anon.body.data.variants[0]).toMatchObject({
      retailPrice: 64_900,
      wholesalePrice: null,
      available: 10,
    });
    expect(anon.body.data.invimaCode).toBe('DEMO-SD-1');

    const user = await createUser({ email: 'mayorista@example.com' });
    await getTestDb().user.update({
      where: { id: user.id },
      data: { wholesaleStatus: 'APPROVED' },
    });
    const headers = await bearer(app, 'mayorista@example.com', TEST_PASSWORD);
    const ws = await request(app).get('/api/catalog/products/sauco').set(headers);
    expect(ws.body.data.variants[0]).toMatchObject({ wholesalePrice: 48_900, wholesaleMinQty: 6 });
    expect(ws.headers['cache-control']).toMatch(/no-store/);
  });

  it('no muestra borradores ni productos borrados', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/api/catalog/products/borrador')).status).toBe(404);
    await getTestDb().product.update({
      where: { id: fx.sauco.id },
      data: { deletedAt: new Date() },
    });
    expect((await request(app).get('/api/catalog/products/sauco')).status).toBe(404);
  });

  it('marca como +18 los productos adultos', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/catalog/products?q=gel');
    expect(res.body.data[0].isAdult).toBe(true);
  });

  it('entrega el árbol de categorías con conteos', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/catalog/categories');
    const bienestar = res.body.data.find((c: { slug: string }) => c.slug === 'bienestar');
    expect(bienestar.productCount).toBe(1);
    expect(bienestar.children[0]).toMatchObject({ slug: 'vitaminas', productCount: 1 });
  });
});
