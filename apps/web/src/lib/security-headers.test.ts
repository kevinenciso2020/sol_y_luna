import { describe, expect, it } from 'vitest';
import { applySecurityHeaders } from './security-headers';

describe('applySecurityHeaders', () => {
  it('agrega frame-ancestors sin borrar la CSP de Astro', () => {
    const headers = new Headers({
      'Content-Security-Policy': "script-src 'self' 'sha256-abc'; style-src 'self'",
    });
    applySecurityHeaders(headers, { https: true });
    const csp = headers.get('Content-Security-Policy')!;
    expect(csp).toContain("script-src 'self' 'sha256-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers.get('Strict-Transport-Security')).toMatch(/max-age=31536000/);
  });

  it('pone una CSP mínima cuando no hay ninguna (respuestas JSON del BFF)', () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { https: false });
    expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Strict-Transport-Security')).toBeNull();
  });
});
