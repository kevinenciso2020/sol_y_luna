/**
 * Security headers for every web response. The rest of the CSP (script/style hashes, sources)
 * comes from Astro's `security.csp` <meta>; frame-ancestors only works as a header.
 */
export function applySecurityHeaders(headers: Headers, options: { https: boolean }) {
  // Astro sends the page CSP (with script/style hashes) as a header on SSR pages: extend it, never replace it.
  const csp = headers.get('Content-Security-Policy');
  if (!csp) {
    headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  } else if (!/frame-ancestors/i.test(csp)) {
    headers.set('Content-Security-Policy', `${csp.replace(/;?\s*$/, '')}; frame-ancestors 'none'`);
  }
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), usb=(), magnetometer=(), gyroscope=(), payment=(self)',
  );
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (options.https) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
