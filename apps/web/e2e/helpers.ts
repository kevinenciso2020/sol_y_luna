import { expect, type Page } from '@playwright/test';

export const ADMIN = {
  email: process.env['ADMIN_SEED_EMAIL'] ?? '',
  password: process.env['ADMIN_SEED_PASSWORD'] ?? '',
};

export const OPERATOR = {
  email: process.env['OPERATOR_SEED_EMAIL'] ?? '',
  password: process.env['OPERATOR_SEED_PASSWORD'] ?? '',
};

async function loginAs(page: Page, user: { email: string; password: string }, home: string) {
  await page.goto(`/cuenta/ingresar?next=${home}`);
  await page.getByLabel('Correo').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // Match the path, not the whole URL: the login page itself carries ?next=.
  await page.waitForURL((url) => url.pathname === home);
}

export const loginAsAdmin = (page: Page) => loginAs(page, ADMIN, '/admin');
export const loginAsOperator = (page: Page) => loginAs(page, OPERATOR, '/operador');

/** Fails if the page scrolls horizontally (responsive check). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'la página no debe tener scroll horizontal').toBeLessThanOrEqual(1);
}

// ─── Purchase flow (demo mode) ───

export const PRODUCT = '/productos/sauco-negro-vitamina-c-zinc';

export async function addToCart(page: Page, quantity: number) {
  await page.goto(PRODUCT);
  await page.getByLabel('Cantidad').fill(String(quantity));
  await page.getByRole('button', { name: /Agregar al carrito/ }).click();
  await expect(page.getByText('Listo, lo agregamos.')).toBeVisible();
}

export async function fillGuestCheckout(page: Page, email: string) {
  await page.locator('#name').fill('Laura Gómez');
  await page.locator('#email').fill(email);
  await page.locator('#phone').fill('3001234567');
  await page.locator('#departmentCode').selectOption({ label: 'Antioquia' });
  await page.locator('#municipalityCode').selectOption({ label: 'Medellín' });
  await page.locator('#addressLine').fill('Calle 10 # 43-20, apto 502');
  await page.getByLabel('Empaque discreto').check();
}

export async function acceptAndPay(page: Page) {
  await page.getByRole('checkbox', { name: /términos y condiciones/ }).check();
  await page.getByRole('checkbox', { name: /tratamiento de mis datos/ }).check();
  await page.getByRole('button', { name: /^Pagar \$/ }).click();
  await expect(page).toHaveURL(/\/pago\/simulado\?ref=SYL-/);
}
