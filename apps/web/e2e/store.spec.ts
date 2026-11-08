import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

const PAGES = [
  '/',
  '/productos',
  '/productos?audience=HIM',
  '/categorias/bienestar-y-defensas',
  '/productos/sauco-negro-vitamina-c-zinc',
  '/marcas',
  '/marcas/wild',
  '/legal/privacidad',
  '/no-existe',
];

test.describe('tienda', () => {
  test('el inicio muestra el hero, categorías, destacados y confianza', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Bienestar que llega a tu puerta' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Categorías' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Los más pedidos' })).toBeVisible();
    await expect(page.getByText('Envío gratis').first()).toBeVisible();
    // Structured data for the store.
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld ?? '{}')['@type']).toBe('Store');
  });

  test('el catálogo filtra con URLs compartibles e incluye productos sin categoría', async ({
    page,
  }) => {
    await page.goto('/productos?q=blood');
    await expect(page.getByRole('heading', { name: 'Blood Sugar Complex' })).toBeVisible();
    await page.goto('/productos?invima=1&sort=price_asc');
    await expect(page.getByRole('status').first()).toContainText('productos');
    await expect(page.getByRole('heading', { name: 'Turkesterone con Tongkat Ali' })).toHaveCount(
      0,
    );
    await page.goto('/productos?q=zzzz-nada');
    await expect(page.getByText('No encontramos productos con esos filtros')).toBeVisible();
  });

  test('la ficha muestra precio, presentaciones, INVIMA, disclaimer y datos estructurados', async ({
    page,
  }) => {
    await page.goto('/productos/wild-mentas-energia');
    await expect(
      page.getByRole('heading', { level: 1, name: 'WILD mentas energía' }),
    ).toBeVisible();
    await expect(page.locator('[data-price-display]')).toHaveText('$12.900');
    await page.getByText('Sandía', { exact: true }).click();
    await expect(page.locator('input[name="variante"]:checked')).toHaveCount(1);
    await page.goto('/productos/sauco-negro-vitamina-c-zinc');
    await expect(page.getByText('DEMO-SD-0005')).toBeVisible();
    await expect(page.getByText(/no es un medicamento/)).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = ld.map((t) => JSON.parse(t)).find((d) => d['@type'] === 'Product');
    expect(product.offers.priceCurrency).toBe('COP');
    expect(product.offers.price).toBe(64_900);
  });

  test('los productos +18 piden verificación de edad en el servidor', async ({ page }) => {
    await page.goto('/productos?q=gel');
    await expect(page.getByRole('main').getByText('+18', { exact: true }).first()).toBeVisible();
    await page.goto('/productos/gel-potenciador-intimo');
    await expect(
      page.getByRole('heading', { name: 'Este contenido es para mayores de 18 años' }),
    ).toBeVisible();
    await expect(page.getByText('Producto de ejemplo marcado como +18')).toHaveCount(0);

    await page.getByLabel('Fecha de nacimiento').fill('2015-05-05');
    await page.getByRole('button', { name: 'Tengo 18 años o más' }).click();
    await expect(page.getByText('Debes tener 18 años o más')).toBeVisible();

    await page.getByLabel('Fecha de nacimiento').fill('1990-05-05');
    await page.getByRole('button', { name: 'Tengo 18 años o más' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Gel potenciador/ })).toBeVisible();
  });

  test('la página de WILD usa su tema oscuro', async ({ page }) => {
    await page.goto('/marcas/wild');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('heading', { level: 1, name: 'WILD' })).toBeVisible();
  });

  test('legales, sitemap, robots y 404', async ({ page, request }) => {
    await page.goto('/legal/privacidad');
    await expect(page.getByRole('heading', { name: /Política de privacidad/ })).toBeVisible();
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/productos/sauco-negro-vitamina-c-zinc');
    expect(sitemap).not.toContain('gel-potenciador-intimo');
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /admin');
    const missing = await page.goto('/productos/no-existe');
    expect(missing?.status()).toBe(404);
  });

  for (const width of [360, 768, 1440]) {
    test(`responsive a ${width}px sin scroll horizontal`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'el ancho se fija aquí; basta un proyecto');
      await page.setViewportSize({ width, height: 900 });
      for (const path of PAGES) {
        await page.goto(path);
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: testInfo.outputPath(`${width}${path.replace(/[/?=&]/g, '_')}.png`),
          fullPage: true,
        });
      }
    });
  }
});
