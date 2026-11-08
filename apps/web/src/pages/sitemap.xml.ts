import type { APIRoute } from 'astro';
import { catalog, flattenCategories, type ProductCard } from '../lib/catalog';

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Dynamic sitemap: home, catalog, categories, brands, products and legal pages (no +18 content). */
export const GET: APIRoute = async ({ site, url }) => {
  const base = site ?? new URL(url.origin);
  const [tree, brands] = await Promise.all([catalog.categories(), catalog.brands()]);
  const products: ProductCard[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await catalog.products({ page, pageSize: 48, sort: 'newest' });
    products.push(...res.data);
    if (page >= res.meta.totalPages) break;
  }
  const paths = [
    '/',
    '/productos',
    '/marcas',
    ...flattenCategories(tree)
      .filter((c) => !c.isAdult && !c.parent?.isAdult)
      .map((c) => `/categorias/${c.slug}`),
    ...brands.map((b) => `/marcas/${b.slug}`),
    ...products.filter((p) => !p.isAdult).map((p) => `/productos/${p.slug}`),
    ...['terminos', 'privacidad', 'retracto', 'envios', 'devoluciones'].map((s) => `/legal/${s}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${escape(new URL(p, base).toString())}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
