import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.js';
import { validEnvSource } from '../test/fixtures.js';

describe('loadEnv', () => {
  it('parses a valid environment and defaults to demo mode', () => {
    const env = loadEnv({ ...validEnvSource });
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4321']);
    expect(env.features.payments).toEqual({ mock: true, mercadopago: false, wompi: false });
    expect(env.features.cloudinary).toBe(false);
    expect(env.CLOUDINARY_FOLDER).toBe('sol-y-luna');
  });

  it('names the missing variable', () => {
    const { JWT_ACCESS_SECRET: _omit, ...rest } = validEnvSource;
    expect(() => loadEnv(rest)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('treats empty strings as missing', () => {
    expect(() => loadEnv({ ...validEnvSource, DATABASE_URL: '' })).toThrow(
      /Falta la variable de entorno DATABASE_URL/,
    );
  });

  it('lists every problem at once', () => {
    try {
      loadEnv({ ...validEnvSource, JWT_ACCESS_SECRET: 'short', ENCRYPTION_KEY: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const messages = (error as EnvValidationError).issues.join('\n');
      expect(messages).toMatch(/JWT_ACCESS_SECRET/);
      expect(messages).toMatch(/ENCRYPTION_KEY/);
    }
  });

  it('requires Turnstile in production', () => {
    expect(() => loadEnv({ ...validEnvSource, NODE_ENV: 'production' })).toThrow(
      /TURNSTILE_SECRET_KEY/,
    );
  });

  it('stays in mock payments when live mode lacks credentials', () => {
    const env = loadEnv({ ...validEnvSource, PAYMENTS_MODE: 'live' });
    expect(env.features.payments.mock).toBe(true);
  });

  it('enables Wompi in live mode when all its keys exist', () => {
    const env = loadEnv({
      ...validEnvSource,
      PAYMENTS_MODE: 'live',
      WOMPI_PUBLIC_KEY: 'pub_test_x',
      WOMPI_PRIVATE_KEY: 'prv_test_x',
      WOMPI_INTEGRITY_SECRET: 'test_integrity_x',
      WOMPI_EVENTS_SECRET: 'test_events_x',
    });
    expect(env.features.payments).toEqual({ mock: false, mercadopago: false, wompi: true });
  });
});
