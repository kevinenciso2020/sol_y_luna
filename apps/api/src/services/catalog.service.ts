import type { CatalogQuery } from '@sol-y-luna/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http-error.js';
import { pageMeta, toSkipTake } from '../lib/pagination.js';
import type { Db } from '../lib/prisma.js';

/** Products visible in the store: active, not deleted, with at least one active variant. */
export const VISIBLE_PRODUCT: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  deletedAt: null,
  minRetailPrice: { not: null },
};

const listInclude = {
  brand: { select: { name: true, slug: true } },
  category: { select: { name: true, slug: true, isAdult: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { publicId: true, alt: true } },
  variants: {
    where: { isActive: true },
    orderBy: [{ retailPrice: 'asc' }, { sortOrder: 'asc' }],
    select: { retailPrice: true, compareAtPrice: true, stock: true, reservedStock: true },
  },
} satisfies Prisma.ProductInclude;

type ListProduct = Prisma.ProductGetPayload<{ include: typeof listInclude }>;

export function toProductCard(p: ListProduct) {
  const cheapest = p.variants[0];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription,
    brand: p.brand,
    category: p.category ? { name: p.category.name, slug: p.category.slug } : null,
    audience: p.audience,
    isAdult: p.isAdult || Boolean(p.category?.isAdult),
    invimaStatus: p.invimaStatus,
    invimaCode: p.invimaStatus === 'REGISTERED' ? p.invimaCode : null,
    featured: p.featured,
    price: p.minRetailPrice ?? 0,
    compareAtPrice: cheapest?.compareAtPrice ?? null,
    variantCount: p.variants.length,
    inStock: p.variants.some((v) => v.stock - v.reservedStock > 0),
    image: p.images[0] ?? null,
  };
}

/** Returns the ids of a category and all its descendants (sub-categories). */
async function categoryWithDescendants(db: Db, slug: string): Promise<string[] | null> {
  const all = await db.category.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, parentId: true },
  });
  const root = all.find((c) => c.slug === slug);
  if (!root) return null;
  const ids = [root.id];
  for (let i = 0; i < ids.length; i++) {
    for (const child of all)
      if (child.parentId === ids[i] && !ids.includes(child.id)) ids.push(child.id);
  }
  return ids;
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  isAdult: boolean;
  productCount: number;
  children: CategoryNode[];
}

export function createCatalogService(db: Db) {
  return {
    async listProducts(query: CatalogQuery) {
      const where: Prisma.ProductWhereInput = { ...VISIBLE_PRODUCT };
      const and: Prisma.ProductWhereInput[] = [];

      if (query.q) {
        const q = query.q;
        and.push({
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { shortDescription: { contains: q, mode: 'insensitive' } },
            { brand: { name: { contains: q, mode: 'insensitive' } } },
            { category: { name: { contains: q, mode: 'insensitive' } } },
          ],
        });
      }
      if (query.category) {
        const ids = await categoryWithDescendants(db, query.category);
        if (!ids) throw new HttpError(404, 'Categoría no encontrada', 'NOT_FOUND');
        and.push({ categoryId: { in: ids } });
      }
      if (query.brand) and.push({ brand: { slug: query.brand, isActive: true } });
      if (query.audience) and.push({ audience: query.audience });
      if (query.invima) and.push({ invimaStatus: 'REGISTERED' });
      if (query.featured) and.push({ featured: true });
      if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        and.push({
          minRetailPrice: {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          },
        });
      }
      if (and.length) where.AND = and;

      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        query.sort === 'price_asc'
          ? [{ minRetailPrice: 'asc' }, { name: 'asc' }]
          : query.sort === 'price_desc'
            ? [{ minRetailPrice: 'desc' }, { name: 'asc' }]
            : query.sort === 'newest'
              ? [{ createdAt: 'desc' }, { id: 'asc' }]
              : query.sort === 'name'
                ? [{ name: 'asc' }, { id: 'asc' }]
                : [{ featured: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }];

      const [total, products] = await Promise.all([
        db.product.count({ where }),
        db.product.findMany({
          where,
          orderBy,
          include: listInclude,
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      return {
        data: products.map(toProductCard),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async getProduct(slug: string, viewer: { wholesaleApproved: boolean }) {
      const product = await db.product.findFirst({
        where: { ...VISIBLE_PRODUCT, slug },
        include: {
          brand: { select: { name: true, slug: true } },
          category: { select: { id: true, name: true, slug: true, isAdult: true } },
          images: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, publicId: true, alt: true, variantId: true },
          },
          variants: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { retailPrice: 'asc' }],
          },
        },
      });
      if (!product) throw new HttpError(404, 'Producto no encontrado', 'NOT_FOUND');

      const related = await db.product.findMany({
        where: {
          ...VISIBLE_PRODUCT,
          id: { not: product.id },
          ...(product.categoryId
            ? { categoryId: product.categoryId }
            : product.brandId
              ? { brandId: product.brandId }
              : {}),
        },
        orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
        take: 4,
        include: listInclude,
      });

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        shortDescription: product.shortDescription,
        description: product.description,
        benefits: Array.isArray(product.benefits) ? (product.benefits as string[]) : [],
        usage: product.usage,
        ingredients: product.ingredients,
        warnings: product.warnings,
        disclaimer: product.disclaimer,
        brand: product.brand,
        category: product.category
          ? { name: product.category.name, slug: product.category.slug }
          : null,
        audience: product.audience,
        isAdult: product.isAdult || Boolean(product.category?.isAdult),
        invimaStatus: product.invimaStatus,
        invimaCode: product.invimaStatus === 'REGISTERED' ? product.invimaCode : null,
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
        images: product.images,
        variants: product.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          retailPrice: v.retailPrice,
          compareAtPrice: v.compareAtPrice,
          // Wholesale prices are only disclosed to approved wholesale customers.
          wholesalePrice: viewer.wholesaleApproved ? v.wholesalePrice : null,
          wholesaleMinQty: viewer.wholesaleApproved ? v.wholesaleMinQty : null,
          available: Math.max(0, v.stock - v.reservedStock),
        })),
        related: related.map(toProductCard),
      };
    },

    async categoryTree() {
      const categories = await db.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: { where: VISIBLE_PRODUCT } } } },
      });
      const nodes = new Map<string, CategoryNode>();
      for (const c of categories) {
        nodes.set(c.id, {
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          image: c.image,
          isAdult: c.isAdult,
          productCount: c._count.products,
          children: [],
        });
      }
      const roots: CategoryNode[] = [];
      for (const c of categories) {
        const node = nodes.get(c.id)!;
        const parent = c.parentId ? nodes.get(c.parentId) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      return roots;
    },

    async listBrands() {
      const brands = await db.brand.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: { where: VISIBLE_PRODUCT } } } },
      });
      return brands.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        logo: b.logo,
        description: b.description,
        theme: b.theme,
        productCount: b._count.products,
      }));
    },

    async getBrand(slug: string) {
      const brand = await db.brand.findFirst({ where: { slug, isActive: true } });
      if (!brand) throw new HttpError(404, 'Marca no encontrada', 'NOT_FOUND');
      return {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        logo: brand.logo,
        description: brand.description,
        theme: brand.theme,
      };
    },

    async getSettingsPublic() {
      const s = await db.storeSettings.findUnique({ where: { id: 1 } });
      return {
        storeName: s?.storeName ?? 'Sol y Luna Store',
        whatsappNumber: s?.whatsappNumber ?? null,
        contactEmail: s?.contactEmail ?? null,
        instagramUrl: s?.instagramUrl ?? null,
        homeBanners: s?.homeBanners ?? [],
      };
    },

    async getLegalText(key: 'terms' | 'privacy' | 'withdrawal' | 'shipping' | 'returns') {
      const s = await db.storeSettings.findUnique({ where: { id: 1 } });
      const map = {
        terms: s?.legalTerms,
        privacy: s?.legalPrivacy,
        withdrawal: s?.legalWithdrawal,
        shipping: s?.legalShipping,
        returns: s?.legalReturns,
      } as const;
      return { key, content: map[key] ?? '' };
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
