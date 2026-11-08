import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site, url }) => {
  const base = site ?? new URL(url.origin);
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /operador',
    'Disallow: /cuenta',
    'Disallow: /api/',
    'Disallow: /*?*q=',
    '',
    `Sitemap: ${new URL('/sitemap.xml', base).toString()}`,
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
