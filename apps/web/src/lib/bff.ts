/**
 * Pure helpers for the BFF proxy (/api/[...path]). Kept framework-free so they are easy to test.
 */

/** Request headers the browser may forward to the API. Everything else is dropped. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'user-agent',
  'x-request-id',
  'x-syl-csrf',
];

/** Response headers that must not be copied back (hop-by-hop or recomputed by the runtime). */
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'set-cookie', // copied one by one with getSetCookie()
  'access-control-allow-origin',
  'access-control-allow-credentials',
]);

export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Builds the upstream URL, refusing anything that could escape /api/ (".." segments, encoded slashes,
 * backslashes or absolute URLs).
 */
export function buildUpstreamUrl(
  apiBase: string,
  path: string | undefined,
  search: string,
): URL | null {
  const raw = path ?? '';
  if (raw.length > 512) return null;
  const segments = raw.split('/');
  if (
    segments.some((s) => s === '..' || s === '.' || s.includes('\\') || /%2f|%5c|%2e/i.test(s)) ||
    raw.includes('://')
  ) {
    return null;
  }
  const target = new URL(`/api/${raw}`, apiBase);
  if (!target.pathname.startsWith('/api/') || target.origin !== new URL(apiBase).origin)
    return null;
  target.search = search;
  return target;
}

export function buildUpstreamHeaders(
  incoming: Headers,
  extra: { clientIp: string | undefined; sharedSecret: string | undefined },
): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (extra.sharedSecret && extra.clientIp) {
    headers.set('x-bff-secret', extra.sharedSecret);
    headers.set('x-client-ip', extra.clientIp);
  }
  return headers;
}

export function buildDownstreamHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  upstream.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  for (const cookie of upstream.getSetCookie()) headers.append('set-cookie', cookie);
  return headers;
}
