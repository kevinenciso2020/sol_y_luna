import { describe, expect, it } from 'vitest';
import { catalogQuerySchema, couponInputSchema, productInputSchema, slugify } from './catalog.js';

const baseProduct = {
  name: 'Saúco Negro',
  slug: 'sauco-negro',
  invimaStatus: 'NOT_REGISTERED' as const,
  variants: [{ name: '60 cápsulas', sku: 'syl-sauco-60', retailPrice: 64_900, stock: 10 }],
};

describe('productInputSchema', () => {
  it('acepta un producto mínimo y normaliza el SKU', () => {
    const parsed = productInputSchema.parse(baseProduct);
    expect(parsed.variants[0]!.sku).toBe('SYL-SAUCO-60');
    expect(parsed.status).toBe('DRAFT');
  });

  it('exige el número INVIMA cuando el estado es REGISTERED', () => {
    const result = productInputSchema.safeParse({ ...baseProduct, invimaStatus: 'REGISTERED' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Escribe el número de registro INVIMA');
  });

  it('exige al menos una presentación y precios coherentes', () => {
    expect(productInputSchema.safeParse({ ...baseProduct, variants: [] }).success).toBe(false);
    const wrong = productInputSchema.safeParse({
      ...baseProduct,
      variants: [{ ...baseProduct.variants[0], wholesalePrice: 99_000 }],
    });
    expect(wrong.error?.issues[0]?.message).toMatch(/mayorista no puede ser mayor/);
  });

  it('rechaza precios con decimales', () => {
    const result = productInputSchema.safeParse({
      ...baseProduct,
      variants: [{ ...baseProduct.variants[0], retailPrice: 64_900.5 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('couponInputSchema', () => {
  it('limita el porcentaje a 100', () => {
    expect(couponInputSchema.safeParse({ code: 'x10', type: 'PERCENT', value: 120 }).success).toBe(
      false,
    );
    expect(couponInputSchema.parse({ code: 'bienvenida10', type: 'PERCENT', value: 10 }).code).toBe(
      'BIENVENIDA10',
    );
  });
});

describe('catalogQuerySchema', () => {
  it('aplica valores por defecto y convierte la URL', () => {
    const q = catalogQuerySchema.parse({ minPrice: '50000', invima: '1', page: '2' });
    expect(q).toMatchObject({
      minPrice: 50_000,
      invima: true,
      page: 2,
      pageSize: 12,
      sort: 'relevance',
    });
  });
});

describe('slugify', () => {
  it('quita tildes y símbolos', () => {
    expect(slugify('Saúco Negro + Vitamina C & Zinc')).toBe('sauco-negro-vitamina-c-zinc');
  });
});
