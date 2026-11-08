import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEncryptor } from './encryption.js';

const key = randomBytes(32).toString('base64');

describe('createEncryptor', () => {
  it('cifra y descifra, con IV distinto en cada llamada', () => {
    const enc = createEncryptor(key);
    const a = enc.encrypt('APP_USR-token-secreto');
    const b = enc.encrypt('APP_USR-token-secreto');
    expect(a).not.toBe(b);
    expect(a).not.toContain('token-secreto');
    expect(enc.decrypt(a)).toBe('APP_USR-token-secreto');
  });

  it('falla con otra clave o con datos alterados', () => {
    const enc = createEncryptor(key);
    const payload = enc.encrypt('hola');
    expect(() => createEncryptor(randomBytes(32).toString('base64')).decrypt(payload)).toThrow();
    const parts = payload.split('.');
    parts[3] = Buffer.from('otra cosa').toString('base64url');
    expect(() => enc.decrypt(parts.join('.'))).toThrow();
  });
});
