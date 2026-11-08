import { expect, test, type Page } from '@playwright/test';
import { acceptAndPay, addToCart, expectNoHorizontalScroll, fillGuestCheckout } from './helpers';

const availableOf = async (page: Page) =>
  (await (await page.request.get('/api/catalog/products/sauco-negro-vitamina-c-zinc')).json()).data
    .variants[0].available as number;

test.describe('compra completa en modo demo', () => {
  test('invitado: carrito, cupón, checkout con DIVIPOLA y pago aprobado', async ({
    page,
  }, testInfo) => {
    const before = await availableOf(page);
    await addToCart(page, 2);

    await page.goto('/carrito');
    await expect(page.getByRole('heading', { name: 'Tu carrito' })).toBeVisible();
    await expect(page.getByText('$129.800').first()).toBeVisible();
    await page.getByLabel('Cupón de descuento').fill('bienvenida10');
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect(page.getByText('Cupón BIENVENIDA10 aplicado.')).toBeVisible();
    await expect(page.getByText('$116.820').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('link', { name: /Continuar al pago/ }).click();

    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByText('Modo demo:', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('Envío gratis', { exact: true })).toBeVisible();
    // Validation in Spanish before filling anything.
    await page.getByRole('button', { name: /^Pagar \$/ }).click();
    await expect(page.getByText('Escribe tu nombre')).toBeVisible();

    await fillGuestCheckout(page, `invitado-${testInfo.project.name}@example.com`);
    // Fixed fields drop their old error messages.
    await expect(page.getByText('Escribe tu nombre')).toHaveCount(0);
    await expect(page.getByText('Selecciona un departamento')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: testInfo.outputPath('checkout.png'), fullPage: true });
    await acceptAndPay(page);

    await expect(page.getByRole('heading', { name: 'Pago de prueba' })).toBeVisible();
    await page.getByRole('button', { name: 'Aprobar pago' }).click();
    await expect(page).toHaveURL(/\/pago\/aprobado\?ref=SYL-/);
    await expect(page.getByRole('heading', { name: '¡Pago aprobado!' })).toBeVisible();
    await expect(page.getByText(/Tu pedido SYL-\d{6} ya está pago/)).toBeVisible();
    await expect(page.getByText('$116.820').first()).toBeVisible();
    expect(await availableOf(page)).toBe(before - 2);
  });

  test('pago rechazado libera el stock y se puede reintentar', async ({ page }, testInfo) => {
    const before = await availableOf(page);
    await addToCart(page, 1);
    await page.goto('/checkout');
    await fillGuestCheckout(page, `rechazo-${testInfo.project.name}@example.com`);
    await acceptAndPay(page);
    expect(await availableOf(page)).toBe(before - 1); // reserved

    await page.getByRole('button', { name: 'Rechazar pago' }).click();
    await expect(page).toHaveURL(/\/pago\/rechazado/);
    await expect(page.getByRole('heading', { name: 'El pago no se aprobó' })).toBeVisible();
    expect(await availableOf(page)).toBe(before); // released

    await page.getByRole('button', { name: /Intentar de nuevo/ }).click();
    await expect(page).toHaveURL(/\/pago\/simulado/);
    await page.getByRole('button', { name: 'Dejar pendiente' }).click();
    await expect(page.getByRole('heading', { name: 'Tu pago está pendiente' })).toBeVisible();
  });

  test('cliente con cuenta compra con su dirección guardada', async ({ page }) => {
    await page.goto('/cuenta/ingresar?next=/productos');
    await page.getByLabel('Correo').fill('cliente@solyluna.test');
    await page.getByLabel('Contraseña').fill(process.env['CUSTOMER_SEED_PASSWORD'] ?? '');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL((url) => url.pathname === '/productos');

    await addToCart(page, 1);
    await expect(page.locator('[data-cart-count]').first()).not.toHaveText('0');
    await page.goto('/checkout');
    await expect(page.locator('#email')).toHaveValue('cliente@solyluna.test');
    await expect(page.getByText(/Calle 10 # 43-20, apto 502/)).toBeVisible();
    await acceptAndPay(page);
    await page.getByRole('button', { name: 'Aprobar pago' }).click();
    await expect(page.getByRole('heading', { name: '¡Pago aprobado!' })).toBeVisible();
  });
});
