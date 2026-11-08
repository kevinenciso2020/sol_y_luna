import type { APIRoute } from 'astro';
import { AGE_COOKIE, AGE_COOKIE_MAX_AGE, ageFromBirthDate } from '../lib/age';
import { safeNextPath } from '../lib/route-guard';

/** Receives the +18 form (works without JavaScript) and returns to the gated page. */
export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData();
  const back = safeNextPath(String(form.get('volver') ?? ''), '/productos');
  const age = ageFromBirthDate(String(form.get('nacimiento') ?? ''));
  if (age === null || age < 18) {
    const target = new URL(back, url.origin);
    target.searchParams.set('edad', 'menor');
    return redirect(`${target.pathname}${target.search}`, 303);
  }
  cookies.set(AGE_COOKIE, '18', {
    path: '/',
    maxAge: AGE_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
  });
  return redirect(back, 303);
};
