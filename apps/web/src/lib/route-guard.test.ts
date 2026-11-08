import { describe, expect, it } from 'vitest';
import { homeForRole, requiredRoles, safeNextPath } from './route-guard';

describe('requiredRoles', () => {
  it('protege /admin solo para ADMIN', () => {
    expect(requiredRoles('/admin')).toEqual(['ADMIN']);
    expect(requiredRoles('/admin/productos/1')).toEqual(['ADMIN']);
    expect(requiredRoles('/administrador')).toBeNull();
  });

  it('protege /operador para ADMIN y OPERATOR', () => {
    expect(requiredRoles('/operador/')).toEqual(['ADMIN', 'OPERATOR']);
  });

  it('protege /cuenta excepto las páginas de acceso', () => {
    expect(requiredRoles('/cuenta')).toHaveLength(3);
    expect(requiredRoles('/cuenta/pedidos')).toHaveLength(3);
    expect(requiredRoles('/cuenta/ingresar')).toBeNull();
    expect(requiredRoles('/cuenta/restablecer')).toBeNull();
  });

  it('deja públicas las demás páginas', () => {
    expect(requiredRoles('/')).toBeNull();
    expect(requiredRoles('/productos/x')).toBeNull();
  });
});

describe('safeNextPath', () => {
  it.each([
    ['https://evil.example', '/cuenta'],
    ['//evil.example', '/cuenta'],
    ['/\\evil.example', '/cuenta'],
    ['javascript:alert(1)', '/cuenta'],
    [null, '/cuenta'],
  ])('bloquea redirecciones abiertas: %s', (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  it('acepta rutas internas', () => {
    expect(safeNextPath('/admin/pedidos?estado=PAID')).toBe('/admin/pedidos?estado=PAID');
  });
});

describe('homeForRole', () => {
  it('envía cada rol a su panel', () => {
    expect(homeForRole('ADMIN')).toBe('/admin');
    expect(homeForRole('OPERATOR')).toBe('/operador');
    expect(homeForRole('CUSTOMER')).toBe('/cuenta');
  });
});
