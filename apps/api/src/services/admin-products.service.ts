import type { ProductInput } from '@sol-y-luna/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http-error.js';
import { pageMeta, toSkipTake } from '../lib/pagination.js';
import type { Db } from '../lib/prisma.js';
import { randomToken } from '../lib/crypto.js';
import { audit, diffFields, type AuditActor } from './audit.js';
import type { CloudinaryService } from './cloudinary.js';

type Tx = Prisma.TransactionClient;

const PRODUCT_FIELDS = [
  'name',
  'slug',
  'shortDescription',
  'description',
  'benefits',
  'usage',
  'ingredients',
  'warnings',
  'categoryId',
  'brandId',
  'audience',
  'isAdult',
  'invimaStatus',
  'invimaCode',
  'disclaimer',
  'status',
  'featured',
  'seoTitle',
  'seoDescription',
] as const;

const adminInclude = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  variants: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  images: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ProductInclude;

type AdminProduct = Prisma.ProductGetPayload<{ include: typeof adminInclude }>;

export function toAdminProduct(p: AdminProduct) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription,
    description: p.description,
    benefits: Array.isArray(p.benefits) ? (p.benefits as string[]) : [],
    usage: p.usage,
    ingredients: p.ingredients,
    warnings: p.warnings,
    categoryId: p.categoryId,
    category: p.category,
    brandId: p.brandId,
    brand: p.brand,
    audience: p.audience,
    isAdult: p.isAdult,
    invimaStatus: p.invimaStatus,
    invimaCode: p.invimaCode,
    disclaimer: p.disclaimer,
    status: p.status,
    featured: p.featured,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    minRetailPrice: p.minRetailPrice,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      retailPrice: v.retailPrice,
      compareAtPrice: v.compareAtPrice,
      wholesalePrice: v.wholesalePrice,
      wholesaleMinQty: v.wholesaleMinQty,
      stock: v.stock,
      reservedStock: v.reservedStock,
      weightGrams: v.weightGrams,
      isActive: v.isActive,
    })),
    images: p.images.map((i) => ({
      id: i.id,
      publicId: i.publicId,
      alt: i.alt,
      sortOrder: i.sortOrder,
    })),
  };
}

function productData(input: ProductInput) {
  return {
    name: input.name,
    slug: input.slug,
    shortDescription: input.shortDescription ?? null,
    description: input.description ?? null,
    benefits: input.benefits,
    usage: input.usage ?? null,
    ingredients: input.ingredients ?? null,
    warnings: input.warnings ?? null,
    categoryId: input.categoryId ?? null,
    brandId: input.brandId ?? null,
    audience: input.audience,
    isAdult: input.isAdult,
    invimaStatus: input.invimaStatus,
    invimaCode:
      input.invimaStatus === 'NOT_REGISTERED' || input.invimaStatus === 'NOT_REQUIRED'
        ? null
        : (input.invimaCode ?? null),
    disclaimer: input.disclaimer ?? null,
    status: input.status,
    featured: input.featured,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
  };
}

async function recomputeMinPrice(tx: Tx, productId: string) {
  const min = await tx.productVariant.aggregate({
    where: { productId, isActive: true },
    _min: { retailPrice: true },
  });
  await tx.product.update({
    where: { id: productId },
    data: { minRetailPrice: min._min.retailPrice ?? null },
  });
}

export function createAdminProductsService(deps: { db: Db; cloudinary: CloudinaryService }) {
  const { db, cloudinary } = deps;

  function assertImages(input: ProductInput) {
    for (const image of input.images) {
      if (!cloudinary.isAllowedPublicId(image.publicId)) {
        throw new HttpError(400, 'Una de las imágenes no es válida', 'INVALID_IMAGE');
      }
    }
  }

  async function assertRefs(tx: Tx, input: ProductInput) {
    if (
      input.categoryId &&
      !(await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))
    ) {
      throw new HttpError(400, 'La categoría no existe', 'INVALID_REFERENCE', [
        { path: ['categoryId'], message: 'La categoría no existe' },
      ]);
    }
    if (
      input.brandId &&
      !(await tx.brand.findUnique({ where: { id: input.brandId }, select: { id: true } }))
    ) {
      throw new HttpError(400, 'La marca no existe', 'INVALID_REFERENCE', [
        { path: ['brandId'], message: 'La marca no existe' },
      ]);
    }
  }

  async function load(id: string) {
    const product = await db.product.findFirst({
      where: { id, deletedAt: null },
      include: adminInclude,
    });
    if (!product) throw new HttpError(404, 'Producto no encontrado', 'NOT_FOUND');
    return product;
  }

  return {
    async list(query: {
      q?: string | undefined;
      status: string;
      categoryId?: string | undefined;
      brandId?: string | undefined;
      page: number;
      pageSize: number;
    }) {
      const where: Prisma.ProductWhereInput = { deletedAt: null };
      if (query.status !== 'ALL') where.status = query.status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
      if (query.categoryId === 'none') where.categoryId = null;
      else if (query.categoryId) where.categoryId = query.categoryId;
      if (query.brandId) where.brandId = query.brandId;
      if (query.q) {
        where.OR = [
          { name: { contains: query.q, mode: 'insensitive' } },
          { slug: { contains: query.q, mode: 'insensitive' } },
          { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
        ];
      }
      const [total, rows] = await Promise.all([
        db.product.count({ where }),
        db.product.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          include: adminInclude,
          ...toSkipTake(query.page, query.pageSize),
        }),
      ]);
      return {
        data: rows.map((p) => {
          const full = toAdminProduct(p);
          return {
            id: full.id,
            name: full.name,
            slug: full.slug,
            status: full.status,
            featured: full.featured,
            isAdult: full.isAdult,
            invimaStatus: full.invimaStatus,
            category: full.category,
            brand: full.brand,
            minRetailPrice: full.minRetailPrice,
            variantCount: full.variants.length,
            totalStock: full.variants.reduce((sum, v) => sum + v.stock, 0),
            image: full.images[0] ?? null,
            updatedAt: full.updatedAt,
          };
        }),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async get(id: string) {
      return toAdminProduct(await load(id));
    },

    async create(input: ProductInput, actor: AuditActor) {
      assertImages(input);
      const product = await db.$transaction(async (tx) => {
        await assertRefs(tx, input);
        const created = await tx.product.create({
          data: {
            ...productData(input),
            variants: {
              create: input.variants.map((v, sortOrder) => ({
                name: v.name,
                sku: v.sku,
                retailPrice: v.retailPrice,
                compareAtPrice: v.compareAtPrice ?? null,
                wholesalePrice: v.wholesalePrice ?? null,
                wholesaleMinQty: v.wholesaleMinQty,
                stock: v.stock,
                weightGrams: v.weightGrams ?? null,
                isActive: v.isActive,
                sortOrder,
              })),
            },
            images: {
              create: input.images.map((img, sortOrder) => ({
                publicId: img.publicId,
                alt: img.alt,
                sortOrder,
              })),
            },
          },
          include: { variants: true },
        });
        for (const v of created.variants) {
          if (v.stock > 0) {
            await tx.inventoryMovement.create({
              data: {
                variantId: v.id,
                delta: v.stock,
                reason: 'RESTOCK',
                reference: 'Stock inicial',
                createdById: actor.userId,
              },
            });
          }
        }
        await recomputeMinPrice(tx, created.id);
        await audit(tx, actor, {
          action: 'product.create',
          entity: 'Product',
          entityId: created.id,
          diff: {
            name: created.name,
            status: created.status,
            variants: created.variants.map((v) => ({
              sku: v.sku,
              retailPrice: v.retailPrice,
              stock: v.stock,
            })),
          },
        });
        return created;
      });
      return this.get(product.id);
    },

    async update(id: string, input: ProductInput, actor: AuditActor) {
      assertImages(input);
      await db.$transaction(async (tx) => {
        const existing = await tx.product.findFirst({
          where: { id, deletedAt: null },
          include: { variants: true, images: true },
        });
        if (!existing) throw new HttpError(404, 'Producto no encontrado', 'NOT_FOUND');
        await assertRefs(tx, input);

        const data = productData(input);
        await tx.product.update({ where: { id }, data });
        const productDiff = diffFields(
          existing as unknown as Record<string, unknown>,
          data,
          PRODUCT_FIELDS,
        );
        if (productDiff) {
          await audit(tx, actor, {
            action: 'product.update',
            entity: 'Product',
            entityId: id,
            diff: productDiff,
          });
        }

        // Variants: update by id, create new ones, remove (or deactivate) the missing ones.
        const keepIds = new Set(input.variants.flatMap((v) => (v.id ? [v.id] : [])));
        for (const [sortOrder, v] of input.variants.entries()) {
          const values = {
            name: v.name,
            sku: v.sku,
            retailPrice: v.retailPrice,
            compareAtPrice: v.compareAtPrice ?? null,
            wholesalePrice: v.wholesalePrice ?? null,
            wholesaleMinQty: v.wholesaleMinQty,
            weightGrams: v.weightGrams ?? null,
            isActive: v.isActive,
            sortOrder,
          };
          if (v.id) {
            const current = existing.variants.find((ev) => ev.id === v.id);
            if (!current)
              throw new HttpError(
                400,
                'Una presentación no pertenece a este producto',
                'INVALID_VARIANT',
              );
            if (v.stock < current.reservedStock) {
              throw new HttpError(
                400,
                `El stock de "${current.name}" no puede quedar por debajo de las ${current.reservedStock} unidades reservadas en pedidos pendientes`,
                'STOCK_BELOW_RESERVED',
              );
            }
            await tx.productVariant.update({
              where: { id: v.id },
              data: { ...values, stock: v.stock },
            });

            const priceDiff = diffFields(current as unknown as Record<string, unknown>, values, [
              'retailPrice',
              'compareAtPrice',
              'wholesalePrice',
              'wholesaleMinQty',
            ]);
            if (priceDiff) {
              await audit(tx, actor, {
                action: 'variant.price.update',
                entity: 'ProductVariant',
                entityId: v.id,
                diff: { sku: v.sku, ...priceDiff },
              });
            }
            if (v.stock !== current.stock) {
              const delta = v.stock - current.stock;
              await tx.inventoryMovement.create({
                data: {
                  variantId: v.id,
                  delta,
                  reason: 'ADJUSTMENT',
                  reference: 'Edición desde el admin',
                  createdById: actor.userId,
                },
              });
              await audit(tx, actor, {
                action: 'variant.stock.update',
                entity: 'ProductVariant',
                entityId: v.id,
                diff: { sku: v.sku, stock: { from: current.stock, to: v.stock }, delta },
              });
            }
            const otherDiff = diffFields(current as unknown as Record<string, unknown>, values, [
              'name',
              'sku',
              'isActive',
              'weightGrams',
            ]);
            if (otherDiff) {
              await audit(tx, actor, {
                action: 'variant.update',
                entity: 'ProductVariant',
                entityId: v.id,
                diff: otherDiff,
              });
            }
          } else {
            const created = await tx.productVariant.create({
              data: { ...values, stock: v.stock, productId: id },
            });
            if (v.stock > 0) {
              await tx.inventoryMovement.create({
                data: {
                  variantId: created.id,
                  delta: v.stock,
                  reason: 'RESTOCK',
                  reference: 'Stock inicial',
                  createdById: actor.userId,
                },
              });
            }
            await audit(tx, actor, {
              action: 'variant.create',
              entity: 'ProductVariant',
              entityId: created.id,
              diff: { sku: created.sku, retailPrice: created.retailPrice, stock: created.stock },
            });
          }
        }
        for (const removed of existing.variants.filter((ev) => !keepIds.has(ev.id))) {
          const used = await tx.orderItem.count({ where: { variantId: removed.id } });
          if (used > 0 || removed.reservedStock > 0) {
            // Sold before: keep the row for history and stock movements, just hide it.
            await tx.productVariant.update({
              where: { id: removed.id },
              data: { isActive: false },
            });
          } else {
            await tx.productVariant.delete({ where: { id: removed.id } });
          }
          await audit(tx, actor, {
            action: used > 0 ? 'variant.deactivate' : 'variant.delete',
            entity: 'ProductVariant',
            entityId: removed.id,
            diff: { sku: removed.sku },
          });
        }

        // Images: keep the given order; delete the ones that were removed.
        const keepImages = new Set(input.images.flatMap((img) => (img.id ? [img.id] : [])));
        await tx.productImage.deleteMany({
          where: { productId: id, id: { notIn: [...keepImages] } },
        });
        for (const [sortOrder, img] of input.images.entries()) {
          if (img.id && existing.images.some((e) => e.id === img.id)) {
            await tx.productImage.update({
              where: { id: img.id },
              data: { alt: img.alt, sortOrder },
            });
          } else {
            await tx.productImage.create({
              data: { productId: id, publicId: img.publicId, alt: img.alt, sortOrder },
            });
          }
        }

        await recomputeMinPrice(tx, id);
      });
      return this.get(id);
    },

    async setStatus(id: string, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED', actor: AuditActor) {
      await db.$transaction(async (tx) => {
        const existing = await tx.product.findFirst({ where: { id, deletedAt: null } });
        if (!existing) throw new HttpError(404, 'Producto no encontrado', 'NOT_FOUND');
        if (existing.status === status) return;
        await tx.product.update({ where: { id }, data: { status } });
        await audit(tx, actor, {
          action: 'product.status.update',
          entity: 'Product',
          entityId: id,
          diff: { status: { from: existing.status, to: status } },
        });
      });
      return this.get(id);
    },

    /** Soft delete: the product disappears from the store and the admin, but order history keeps it. */
    async remove(id: string, actor: AuditActor) {
      await db.$transaction(async (tx) => {
        const existing = await tx.product.findFirst({ where: { id, deletedAt: null } });
        if (!existing) throw new HttpError(404, 'Producto no encontrado', 'NOT_FOUND');
        await tx.product.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            status: 'ARCHIVED',
            featured: false,
            // Free the slug so a new product can use it.
            slug: `${existing.slug.slice(0, 90)}-eliminado-${randomToken(4)
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')}`,
          },
        });
        await tx.cartItem.deleteMany({ where: { variant: { productId: id } } });
        await audit(tx, actor, {
          action: 'product.delete',
          entity: 'Product',
          entityId: id,
          diff: { name: existing.name, slug: existing.slug },
        });
      });
    },
  };
}

export type AdminProductsService = ReturnType<typeof createAdminProductsService>;
