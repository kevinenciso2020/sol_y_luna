import request from 'supertest';
import type { Express } from 'express';
import { getTestDb } from './integration.js';

/** Small catalog: parent/child categories, one uncategorized product, a draft and an adult product. */
export async function seedCatalog() {
  const db = getTestDb();
  const bienestar = await db.category.create({
    data: { name: 'Bienestar', slug: 'bienestar', sortOrder: 1 },
  });
  const vitaminas = await db.category.create({
    data: { name: 'Vitaminas', slug: 'vitaminas', parentId: bienestar.id, sortOrder: 1 },
  });
  const paraEl = await db.category.create({
    data: { name: 'Para él', slug: 'para-el', sortOrder: 2 },
  });
  const wild = await db.brand.create({ data: { name: 'WILD', slug: 'wild' } });

  const make = async (input: {
    slug: string;
    name: string;
    price: number;
    categoryId?: string | null;
    brandId?: string | null;
    audience?: 'HIM' | 'HER' | 'UNISEX';
    status?: 'ACTIVE' | 'DRAFT';
    invima?: boolean;
    isAdult?: boolean;
    wholesalePrice?: number;
    featured?: boolean;
  }) =>
    db.product.create({
      data: {
        slug: input.slug,
        name: input.name,
        status: input.status ?? 'ACTIVE',
        categoryId: input.categoryId ?? null,
        brandId: input.brandId ?? null,
        audience: input.audience ?? 'UNISEX',
        isAdult: input.isAdult ?? false,
        featured: input.featured ?? false,
        invimaStatus: input.invima ? 'REGISTERED' : 'NOT_REGISTERED',
        invimaCode: input.invima ? 'DEMO-SD-1' : null,
        minRetailPrice: input.price,
        variants: {
          create: [
            {
              name: 'Única',
              sku: input.slug.toUpperCase(),
              retailPrice: input.price,
              wholesalePrice: input.wholesalePrice ?? null,
              wholesaleMinQty: 6,
              stock: 10,
            },
          ],
        },
        images: { create: [{ publicId: '/placeholders/frasco.svg', alt: input.name }] },
      },
    });

  const sauco = await make({
    slug: 'sauco',
    name: 'Saúco Negro',
    price: 64_900,
    categoryId: bienestar.id,
    invima: true,
    featured: true,
    wholesalePrice: 48_900,
  });
  const vitaminaC = await make({
    slug: 'vitamina-c',
    name: 'Vitamina C',
    price: 39_900,
    categoryId: vitaminas.id,
  });
  const turk = await make({
    slug: 'turkesterone',
    name: 'Turkesterone',
    price: 159_900,
    categoryId: paraEl.id,
    audience: 'HIM',
  });
  const mentas = await make({
    slug: 'mentas',
    name: 'Mentas WILD',
    price: 12_900,
    brandId: wild.id,
    categoryId: null,
  });
  const borrador = await make({
    slug: 'borrador',
    name: 'Borrador',
    price: 10_000,
    status: 'DRAFT',
  });
  const adulto = await make({ slug: 'gel-18', name: 'Gel +18', price: 54_900, isAdult: true });
  return { bienestar, vitaminas, paraEl, wild, sauco, vitaminaC, turk, mentas, borrador, adulto };
}

export async function bearer(app: Express, email: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login falló para ${email}: ${res.status}`);
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}
