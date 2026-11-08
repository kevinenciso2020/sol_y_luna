import { expect, type Page } from '@playwright/test';

export const ADMIN = {
  email: process.env['ADMIN_SEED_EMAIL'] ?? '',
  password: process.env['ADMIN_SEED_PASSWORD'] ?? '',
};

export async function loginAsAdmin(page: Page) {
  await page.goto('/cuenta/ingresar?next=/admin');
  await page.getByLabel('Correo').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // Match the path, not the whole URL: the login page itself carries ?next=/admin.
  await page.waitForURL((url) => url.pathname === '/admin');
}

/** Fails if the page scrolls horizontally (responsive check). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'la página no debe tener scroll horizontal').toBeLessThanOrEqual(1);
}
