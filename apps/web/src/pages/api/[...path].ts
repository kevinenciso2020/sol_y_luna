import type { APIRoute } from 'astro';
import { API_INTERNAL_URL, BFF_SHARED_SECRET } from 'astro:env/server';
import {
  MAX_BODY_BYTES,
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  buildUpstreamUrl,
} from '../../lib/bff';

/**
 * BFF: the browser only talks to its own origin. Every /api/* request is forwarded to the API
 * (API_INTERNAL_URL) with its cookies, so auth cookies stay first-party on *.workers.dev today
 * and on the custom domain later.
 */
const jsonError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const ALL: APIRoute = async ({ request, params, url, clientAddress }) => {
  const target = buildUpstreamUrl(API_INTERNAL_URL, params.path, url.search);
  if (!target) return jsonError(400, 'BAD_PATH', 'Ruta no válida');

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES)
      return jsonError(413, 'PAYLOAD_TOO_LARGE', 'La petición es demasiado grande');
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES)
      return jsonError(413, 'PAYLOAD_TOO_LARGE', 'La petición es demasiado grande');
  }

  const clientIp = request.headers.get('cf-connecting-ip') ?? clientAddress;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: buildUpstreamHeaders(request.headers, { clientIp, sharedSecret: BFF_SHARED_SECRET }),
      body: body && body.byteLength > 0 ? body : null,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return jsonError(
      502,
      'UPSTREAM_UNAVAILABLE',
      'No pudimos conectar con el servidor. Intenta de nuevo en un momento.',
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildDownstreamHeaders(upstream.headers),
  });
};
