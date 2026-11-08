import { describe, expect, it } from 'vitest';
import { buildDownstreamHeaders, buildUpstreamHeaders, buildUpstreamUrl } from './bff';

const API = 'https://api.internal.example';

describe('buildUpstreamUrl', () => {
  it('reenvía la ruta y la query a /api/ de la API', () => {
    expect(buildUpstreamUrl(API, 'auth/login', '?a=1')?.toString()).toBe(
      `${API}/api/auth/login?a=1`,
    );
  });

  it.each([
    ['../health'],
    ['auth/../../admin'],
    ['..%2fhealth'],
    ['auth/%2e%2e/x'],
    ['a\\b'],
    ['https://evil.example/x'],
  ])('rechaza rutas que intentan salir de /api/: %s', (path) => {
    expect(buildUpstreamUrl(API, path, '')).toBeNull();
  });
});

describe('buildUpstreamHeaders', () => {
  it('solo reenvía cabeceras permitidas y agrega la IP con el secreto', () => {
    const incoming = new Headers({
      cookie: 'syl_refresh=abc',
      authorization: 'Bearer x',
      'x-syl-csrf': '1',
      'x-bff-secret': 'spoofed',
      'x-client-ip': '1.1.1.1',
      host: 'evil',
    });
    const headers = buildUpstreamHeaders(incoming, {
      clientIp: '181.50.1.2',
      sharedSecret: 's3cret',
    });
    expect(headers.get('cookie')).toBe('syl_refresh=abc');
    expect(headers.get('authorization')).toBe('Bearer x');
    expect(headers.get('x-syl-csrf')).toBe('1');
    expect(headers.get('host')).toBeNull();
    expect(headers.get('x-bff-secret')).toBe('s3cret');
    expect(headers.get('x-client-ip')).toBe('181.50.1.2');
  });

  it('nunca reenvía un x-bff-secret enviado por el navegador', () => {
    const headers = buildUpstreamHeaders(
      new Headers({ 'x-bff-secret': 'spoofed', 'x-client-ip': '1.1.1.1' }),
      {
        clientIp: '181.50.1.2',
        sharedSecret: undefined,
      },
    );
    expect(headers.get('x-bff-secret')).toBeNull();
    expect(headers.get('x-client-ip')).toBeNull();
  });
});

describe('buildDownstreamHeaders', () => {
  it('conserva todas las cookies y quita cabeceras hop-by-hop', () => {
    const upstream = new Headers({
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      connection: 'close',
    });
    upstream.append('set-cookie', 'syl_refresh=a; Path=/api/auth; HttpOnly');
    upstream.append('set-cookie', 'syl_session=b; Path=/; HttpOnly');
    const headers = buildDownstreamHeaders(upstream);
    expect(headers.getSetCookie()).toHaveLength(2);
    expect(headers.get('content-encoding')).toBeNull();
    expect(headers.get('connection')).toBeNull();
    expect(headers.get('content-type')).toBe('application/json');
  });
});
