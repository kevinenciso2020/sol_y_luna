import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, loginAsAdmin } from './helpers';

const ADMIN_PAGES = [
  '/admin',
  '/admin/pedidos',
  '/admin/inventario',
  '/admin/comisiones',
  '/admin/liquidaciones',
  '/admin/productos',
  '/admin/productos/nuevo',
  '/admin/categorias',
  '/admin/marcas',
  '/admin/cupones',
  '/admin/usuarios',
  '/admin/pagos',
  '/admin/configuracion',
  '/admin/auditoria',
];

test.describe('panel de administración', () => {
  test('sin sesión, /admin pide ingresar', async ({ page }) => {
    await page.goto('/admin/productos');
    await expect(page).toHaveURL(/\/cuenta\/ingresar\?next=%2Fadmin%2Fproductos/);
  });

  test('crea, edita, archiva y borra un producto', async ({ page, request }, testInfo) => {
    const suffix = testInfo.project.name;
    const name = `Colágeno E2E ${suffix}`;
    const slug = `colageno-e2e-${suffix}`;
    await loginAsAdmin(page);

    await page.goto('/admin/productos/nuevo');
    await page.locator('#name').fill(name);
    await expect(page.locator('#slug')).toHaveValue(slug);
    await page.locator('#shortDescription').fill('Colágeno hidrolizado en polvo.');
    await page.locator('#benefit-0').fill('Fácil de mezclar');
    await page.locator('#v-0-name').fill('300 g');
    await page.locator('#v-0-sku').fill(`E2E-COL-${suffix}`);
    await page.locator('#v-0-retail').fill('89900');
    await expect(page.getByText('$89.900')).toBeVisible();
    await page.locator('#v-0-stock').fill('15');
    await page.locator('#status').selectOption('ACTIVE');
    await page.locator('#invimaStatus').selectOption('REGISTERED');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    // INVIMA code is required when the product is registered.
    await expect(page.getByText('Escribe el número de registro INVIMA')).toBeVisible();
    await page.locator('#invimaCode').fill('DEMO-SD-E2E');
    await page.getByRole('button', { name: 'gotero' }).click();
    await page.getByRole('button', { name: 'Crear producto' }).click();

    await expect(page).toHaveURL(/\/admin\/productos\/[a-z0-9]+\?creado=1/);
    await expect(page.getByText('Producto creado.')).toBeVisible();
    const store = await request.get(`/api/catalog/products/${slug}`);
    expect(store.status()).toBe(200);
    expect((await store.json()).data.variants[0].retailPrice).toBe(89_900);

    // Edit the price.
    await page.locator('#v-0-retail').fill('79900');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();
    expect(
      (await (await request.get(`/api/catalog/products/${slug}`)).json()).data.variants[0]
        .retailPrice,
    ).toBe(79_900);

    // Archive from the list.
    await page.goto(`/admin/productos?q=${encodeURIComponent(name)}`);
    const archive = page.getByRole('button', { name: 'Archivar' }).locator('visible=true').first();
    await archive.click();
    await expect(page.getByText(/quedó archivado/)).toBeVisible();
    expect((await request.get(`/api/catalog/products/${slug}`)).status()).toBe(404);

    // Delete.
    await page.getByRole('button', { name: 'Borrar' }).locator('visible=true').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Borrar producto' }).click();
    await expect(page.getByText(/fue borrado/)).toBeVisible();

    // The price change is in the audit log.
    await page.goto('/admin/auditoria');
    await expect(page.getByText('Cambió un precio').locator('visible=true').first()).toBeVisible();
  });

  test('crea, edita y borra una categoría', async ({ page }, testInfo) => {
    const name = `Categoría E2E ${testInfo.project.name}`;
    await loginAsAdmin(page);
    await page.goto('/admin/categorias');
    await page.getByRole('button', { name: 'Nueva categoría' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#f-name').fill(name);
    await dialog.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Categoría creada.')).toBeVisible();

    const row = page.getByText(name).locator('visible=true').first();
    await expect(row).toBeVisible();
    await page
      .locator('li, tr')
      .filter({ hasText: name })
      .locator('visible=true')
      .getByRole('button', { name: 'Editar' })
      .click();
    await dialog.locator('#f-name').fill(`${name} editada`);
    await dialog.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(`${name} editada`).locator('visible=true').first()).toBeVisible();

    await page
      .locator('li, tr')
      .filter({ hasText: `${name} editada` })
      .locator('visible=true')
      .getByRole('button', { name: 'Borrar' })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
    await expect(page.getByText(`${name} editada`)).toHaveCount(0);
  });

  test('todas las páginas del admin se adaptan a la pantalla', async ({ page }, testInfo) => {
    await loginAsAdmin(page);
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(page.getByText('Cargando…')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await page.screenshot({
        path: testInfo.outputPath(`${path.replaceAll('/', '_')}.png`),
        fullPage: true,
      });
    }
  });
});
