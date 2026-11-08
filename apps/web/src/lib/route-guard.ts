export type Role = 'ADMIN' | 'OPERATOR' | 'CUSTOMER';

/** Public pages under /cuenta (sign in, sign up, password recovery, email verification). */
const PUBLIC_ACCOUNT_PAGES = ['ingresar', 'registro', 'recuperar', 'restablecer', 'verificar'];

/**
 * Which roles may open a page. null = public. Checked server side by the Astro middleware;
 * the API enforces the same rules again on every request.
 */
export function requiredRoles(pathname: string): Role[] | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin' || path.startsWith('/admin/')) return ['ADMIN'];
  if (path === '/operador' || path.startsWith('/operador/')) return ['ADMIN', 'OPERATOR'];
  if (path === '/cuenta' || path.startsWith('/cuenta/')) {
    const page = path.split('/')[2];
    if (page && PUBLIC_ACCOUNT_PAGES.includes(page)) return null;
    return ['ADMIN', 'OPERATOR', 'CUSTOMER'];
  }
  return null;
}

/** Only same-site relative paths are accepted as post-login destinations (no open redirects). */
export function safeNextPath(value: string | null | undefined, fallback = '/cuenta'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return fallback;
  try {
    const url = new URL(value, 'https://placeholder.invalid');
    if (url.origin !== 'https://placeholder.invalid') return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export function homeForRole(role: Role): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'OPERATOR') return '/operador';
  return '/cuenta';
}
