import { expect, test } from '@playwright/test';
import {
  acceptAndPay,
  addToCart,
  expectNoHorizontalScroll,
  fillGuestCheckout,
  loginAsOperator,
} from './helpers';

const OPERATOR_PAGES = ['/operador', '/operador/stock', '/operador/liquidaciones'];

test.describe('panel del operador', () => {
  test('despacha un pedido pagado: prepara, registra la guía y lo entrega', async ({
    page,
  }, testInfo) => {
    // A guest buys and pays in demo mode.
    await addToCart(page, 1);
    await page.goto('/checkout');
    await fillGuestCheckout(page, `despacho-${testInfo.project.name}@example.com`);
    await acceptAndPay(page);
    await page.getByRole('button', { name: 'Aprobar pago' }).click();
    await expect(page).toHaveURL(/\/pago\/aprobado\?ref=SYL-/);
    const number = (await page.getByText(/Tu pedido SYL-\d{6}/).textContent())!.match(
      /SYL-\d{6}/,
    )![0];

    // The operator finds it in the dispatch queue.
    await page.context().clearCookies();
    await loginAsOperator(page);
    await page.getByLabel('Buscar').fill(number);
    await page.getByLabel('Buscar').press('Enter');
    await page.getByRole('link', { name: number }).first().click();
    await expect(page).toHaveURL(new RegExp(`/operador/pedidos/${number}$`));
    await expect(page.getByRole('heading', { name: `Pedido ${number}` })).toBeVisible();
    await expect(page.getByText(/Empaque discreto: caja sin logos/)).toBeVisible();
    await expect(page.getByText('Medellín, Antioquia')).toBeVisible();
    // The operator never sees the platform commission.
    await expect(page.getByText('Comisión de la plataforma')).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Empezar a preparar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Empezar a preparar' }).click();
    await expect(page.getByText('Pedido marcado como "Preparando".')).toBeVisible();

    await page.locator('#carrier').selectOption('Servientrega');
    await page.locator('#tracking').fill(`E2E${testInfo.project.name.toUpperCase()}123`);
    await page.getByRole('button', { name: 'Despachar y avisar al cliente' }).click();
    await expect(
      page.getByText('Pedido despachado. Le enviamos la guía al cliente.'),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('despacho.png'), fullPage: true });

    await page.getByRole('button', { name: 'Marcar como entregado' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Marcar como entregado' }).click();
    await expect(page.getByText('Pedido marcado como "Entregado".')).toBeVisible();
    await expect(page.getByRole('main').getByText('Entregado').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('las páginas del operador se adaptan a la pantalla', async ({ page }, testInfo) => {
    await loginAsOperator(page);
    for (const path of OPERATOR_PAGES) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(page.getByText('Cargando…')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await page.screenshot({
        path: testInfo.outputPath(`${path.replaceAll('/', '_')}.png`),
        fullPage: true,
      });
    }
    // The operator cannot open the admin: the server answers 403.
    const forbidden = await page.goto('/admin/comisiones');
    expect(forbidden?.status()).toBe(403);
  });
});
