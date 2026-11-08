import { describe, expect, it } from 'vitest';
import { ageFromBirthDate, isAgeVerified } from './age';

const today = new Date(Date.UTC(2026, 10, 8)); // 8 nov 2026

describe('ageFromBirthDate', () => {
  it('calcula la edad exacta alrededor del cumpleaños', () => {
    expect(ageFromBirthDate('2008-11-08', today)).toBe(18);
    expect(ageFromBirthDate('2008-11-09', today)).toBe(17);
    expect(ageFromBirthDate('1990-01-15', today)).toBe(36);
  });

  it('rechaza fechas inválidas o futuras', () => {
    expect(ageFromBirthDate('2008-02-30', today)).toBeNull();
    expect(ageFromBirthDate('2030-01-01', today)).toBeNull();
    expect(ageFromBirthDate('ayer', today)).toBeNull();
  });
});

describe('isAgeVerified', () => {
  it('solo acepta el valor esperado de la cookie', () => {
    expect(isAgeVerified('18')).toBe(true);
    expect(isAgeVerified('1')).toBe(false);
    expect(isAgeVerified(undefined)).toBe(false);
  });
});
