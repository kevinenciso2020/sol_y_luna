import { expect, test, type Page } from '@playwright/test';
import { PRODUCT, expectNoHorizontalScroll } from './helpers';

const ACCOUNT_PAGES = [
  '/cuenta',
  '/cuenta/pedidos',
  '/cuenta/direcciones',
  '/cuenta/deseos',
  '/cuenta/resenas',
  '/cuenta/mayorista',
];

async function loginAs(page: Page, email: string, next = '/cuenta') {
  await page.goto(`/cuenta/ingresar?next=${next}`);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(process.env['CUSTOMER_SEED_PASSWORD'] ?? '');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL((url) => url.pathname === next);
}

test.describe('mi cuenta', () => {
  test('las páginas de la cuenta se adaptan a la pantalla', async ({ page }, testInfo) => {
    await loginAs(page, 'cliente@solyluna.test');
    for (const path of ACCOUNT_PAGES) {
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

  test('el historial muestra los pedidos y su seguimiento', async ({ page }) => {
    await loginAs(page, 'cliente@solyluna.test', '/cuenta/pedidos');
    const first = page.getByRole('link', { name: /SYL-\d{6}/ }).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL(/\/cuenta\/pedidos\/SYL-\d{6}$/);
    await expect(page.getByRole('heading', { name: /Pedido SYL-\d{6}/ })).toBeVisible();
    await expect(page.getByText('Entrega', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('guarda una dirección con departamento y municipio', async ({ page }, testInfo) => {
    await loginAs(page, 'cliente@solyluna.test', '/cuenta/direcciones');
    await page.getByRole('button', { name: 'Agregar dirección' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Quién recibe').fill(`Casa ${testInfo.project.name}`);
    await dialog.getByLabel('Celular de quien recibe').fill('3005556677');
    await dialog.getByLabel('Departamento').selectOption({ label: 'Cundinamarca' });
    await dialog.getByLabel('Municipio').selectOption({ label: 'Chía' });
    await dialog.getByLabel('Dirección', { exact: true }).fill('Carrera 9 # 12-30');
    await dialog.getByRole('button', { name: 'Guardar dirección' }).click();
    await expect(page.getByText('Dirección guardada.')).toBeVisible();
    await expect(page.getByText(`Casa ${testInfo.project.name}`)).toBeVisible();
    await expect(page.getByText('Chía, Cundinamarca').first()).toBeVisible();
  });

  test('el mayorista ve su precio en la ficha y guarda en la lista de deseos', async ({ page }) => {
    await loginAs(page, 'mayorista@solyluna.test', '/cuenta/mayorista');
    await expect(page.getByText('Tu cuenta mayorista está activa')).toBeVisible();

    await page.goto(PRODUCT);
    await expect(
      page.getByText(/Precio mayorista: \$48\.900 c\/u desde \d+ unidades/),
    ).toBeVisible();

    const heart = page.locator('[data-wishlist]');
    await expect(heart).toHaveAttribute('aria-pressed', /true|false/);
    if ((await heart.getAttribute('aria-pressed')) === 'true') {
      await heart.click();
      await expect(heart).toHaveAttribute('aria-pressed', 'false');
    }
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/cuenta/deseos');
    await expect(page.getByRole('link', { name: /Saúco Negro/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('sin sesión, el corazón lleva a ingresar y no se ve el precio mayorista', async ({
    page,
  }) => {
    await page.goto(PRODUCT);
    await expect(page.getByText(/Precio mayorista/)).toHaveCount(0);
    await page.locator('[data-wishlist]').click();
    await expect(page).toHaveURL(/\/cuenta\/ingresar\?next=/);
  });
});
