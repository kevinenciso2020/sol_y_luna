import { defineMiddleware } from 'astro:middleware';
import { API_INTERNAL_URL } from 'astro:env/server';
import { requiredRoles, type Role } from './lib/route-guard';
import { applySecurityHeaders } from './lib/security-headers';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  wholesaleStatus: string;
}

async function fetchSessionUser(cookie: string | null): Promise<SessionUser | null> {
  if (!cookie?.includes('syl_session=')) return null;
  try {
    const res = await fetch(new URL('/api/auth/session', API_INTERNAL_URL), {
      headers: { cookie },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: SessionUser };
    return data.user ?? null;
  } catch {
    return null;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  const https = url.protocol === 'https:';
  context.locals.user = null;

  const roles = requiredRoles(url.pathname);
  if (roles) {
    const user = await fetchSessionUser(request.headers.get('cookie'));
    if (!user) {
      const next = encodeURIComponent(`${url.pathname}${url.search}`);
      const redirect = context.redirect(`/cuenta/ingresar?next=${next}`, 302);
      applySecurityHeaders(redirect.headers, { https });
      return redirect;
    }
    if (!roles.includes(user.role)) {
      const forbidden = await context.rewrite('/sin-permiso');
      const response = new Response(forbidden.body, { status: 403, headers: forbidden.headers });
      applySecurityHeaders(response.headers, { https });
      return response;
    }
    context.locals.user = user;
  }

  const response = await next();
  if (roles) response.headers.set('Cache-Control', 'private, no-store');
  applySecurityHeaders(response.headers, { https });
  return response;
});
