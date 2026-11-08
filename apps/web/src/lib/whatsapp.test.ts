import { describe, expect, it } from 'vitest';
import { whatsappLink } from './whatsapp';

describe('whatsappLink', () => {
  it('returns null when the number is empty', () => {
    expect(whatsappLink('')).toBeNull();
    expect(whatsappLink(undefined)).toBeNull();
  });

  it('normalizes the number and encodes the message', () => {
    expect(whatsappLink('+57 300 123 4567', 'Hola, Sol y Luna')).toBe(
      'https://wa.me/573001234567?text=Hola%2C%20Sol%20y%20Luna',
    );
  });
});
