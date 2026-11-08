import {
  formatOrderNumber,
  type ProfileUpdateInput,
  type ReviewInput,
  type WholesaleRequestInput,
} from '@sol-y-luna/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http-error.js';
import { pageMeta, toSkipTake } from '../lib/pagination.js';
import type { Db } from '../lib/prisma.js';
import { orderInclude, toOrderDto } from './orders.service.js';

/**
 * Everything under "Mi cuenta". Every query is scoped by the signed-in user's id: a resource that
 * belongs to someone else answers 404 (never 403), so ids cannot be probed.
 */

const profileSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  documentNumber: true,
  emailVerifiedAt: true,
  wholesaleStatus: true,
  wholesaleBusinessName: true,
  wholesaleRequestedAt: true,
} satisfies Prisma.UserSelect;
type ProfileRow = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

const toProfileDto = (u: ProfileRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  documentNumber: u.documentNumber,
  emailVerified: u.emailVerifiedAt !== null,
  wholesaleStatus: u.wholesaleStatus,
  wholesaleBusinessName: u.wholesaleBusinessName,
  wholesaleRequestedAt: u.wholesaleRequestedAt,
});

const reviewDto = (r: {
  id: string;
  productId: string;
  rating: number;
  title: string | null;
  comment: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  product?: { name: string; slug: string };
}) => ({
  id: r.id,
  productId: r.productId,
  productName: r.product?.name ?? null,
  productSlug: r.product?.slug ?? null,
  rating: r.rating,
  title: r.title,
  comment: r.comment,
  status: r.status,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Products shown in the store: published and not deleted. */
const visibleProduct = { status: 'ACTIVE', deletedAt: null } satisfies Prisma.ProductWhereInput;

export function createAccountService(deps: { db: Db }) {
  const { db } = deps;

  async function profile(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId }, select: profileSelect });
    if (!user) throw new HttpError(401, 'Debes iniciar sesión', 'UNAUTHORIZED');
    return toProfileDto(user);
  }

  return {
    profile,

    async updateProfile(userId: string, input: ProfileUpdateInput) {
      const user = await db.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          phone: input.phone ?? null,
          documentNumber: input.documentNumber ?? null,
        },
        select: profileSelect,
      });
      return toProfileDto(user);
    },

    async listOrders(userId: string, page: number, pageSize: number) {
      const where = { userId } satisfies Prisma.OrderWhereInput;
      const [total, orders] = await Promise.all([
        db.order.count({ where }),
        db.order.findMany({
          where,
          include: {
            items: { select: { productName: true, quantity: true }, take: 3 },
            _count: { select: { items: true } },
            shipment: { select: { carrier: true, trackingNumber: true } },
          },
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(page, pageSize),
        }),
      ]);
      return {
        data: orders.map((o) => ({
          number: formatOrderNumber(o.number),
          status: o.status,
          createdAt: o.createdAt,
          total: o.total,
          itemCount: o._count.items,
          preview: o.items.map((i) => `${i.productName} ×${i.quantity}`),
          shipment: o.shipment,
        })),
        meta: pageMeta(page, pageSize, total),
      };
    },

    async getOrder(userId: string, number: string) {
      const order = await db.order.findFirst({
        where: { userId, number: Number.parseInt(number.slice(4), 10) },
        include: {
          ...orderInclude,
          items: {
            include: { product: { select: { slug: true, status: true, deletedAt: true } } },
          },
        },
      });
      if (!order) throw new HttpError(404, 'Pedido no encontrado', 'NOT_FOUND');
      const productIds = order.items.flatMap((i) => (i.productId ? [i.productId] : []));
      const reviews = await db.review.findMany({
        where: { userId, productId: { in: productIds } },
        select: { productId: true, status: true },
      });
      const dto = toOrderDto(order);
      return {
        ...dto,
        items: order.items.map((item, i) => {
          const visible =
            item.product !== null &&
            item.product.status === 'ACTIVE' &&
            item.product.deletedAt === null;
          return {
            ...dto.items[i]!,
            productId: item.productId,
            productSlug: visible ? item.product!.slug : null,
            reviewable: order.status === 'DELIVERED' && visible,
            reviewStatus: reviews.find((r) => r.productId === item.productId)?.status ?? null,
          };
        }),
      };
    },

    // ─── Wishlist ───
    async wishlist(userId: string) {
      const items = await db.wishlistItem.findMany({
        where: { userId, product: visibleProduct },
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              isAdult: true,
              minRetailPrice: true,
              images: {
                orderBy: { sortOrder: 'asc' },
                take: 1,
                select: { publicId: true, alt: true },
              },
              variants: {
                where: { isActive: true },
                select: { stock: true, reservedStock: true },
              },
            },
          },
        },
      });
      return items.map(({ product: p }) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        isAdult: p.isAdult,
        price: p.minRetailPrice,
        image: p.images[0] ?? null,
        inStock: p.variants.some((v) => v.stock - v.reservedStock > 0),
      }));
    },

    async wishlistIds(userId: string) {
      const rows = await db.wishlistItem.findMany({
        where: { userId },
        select: { productId: true },
      });
      return rows.map((r) => r.productId);
    },

    async addToWishlist(userId: string, productId: string) {
      const product = await db.product.findFirst({ where: { id: productId, ...visibleProduct } });
      if (!product) throw new HttpError(404, 'Producto no encontrado', 'NOT_FOUND');
      await db.wishlistItem.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId },
        update: {},
      });
    },

    async removeFromWishlist(userId: string, productId: string) {
      await db.wishlistItem.deleteMany({ where: { userId, productId } });
    },

    // ─── Reviews ───
    async myReviews(userId: string) {
      const reviews = await db.review.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        include: { product: { select: { name: true, slug: true } } },
      });
      return reviews.map(reviewDto);
    },

    /**
     * Creates or edits the user's review of a product. Only verified buyers: the product must be
     * in one of their DELIVERED orders. Any edit goes back to moderation.
     */
    async saveReview(userId: string, input: ReviewInput) {
      const delivered = await db.order.findFirst({
        where: {
          userId,
          status: 'DELIVERED',
          items: { some: { productId: input.productId } },
          // The product must still be in the store.
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const product = await db.product.findFirst({
        where: { id: input.productId, ...visibleProduct },
        select: { id: true },
      });
      if (!delivered || !product)
        throw new HttpError(
          403,
          'Solo puedes reseñar productos que compraste y recibiste',
          'NOT_A_VERIFIED_BUYER',
        );
      const data = {
        rating: input.rating,
        title: input.title ?? null,
        comment: input.comment ?? null,
        orderId: delivered.id,
        status: 'PENDING' as const,
        moderatedById: null,
        moderatedAt: null,
      };
      const review = await db.review.upsert({
        where: { userId_productId: { userId, productId: input.productId } },
        create: { userId, productId: input.productId, ...data },
        update: data,
        include: { product: { select: { name: true, slug: true } } },
      });
      return reviewDto(review);
    },

    async deleteReview(userId: string, reviewId: string) {
      const deleted = await db.review.deleteMany({ where: { id: reviewId, userId } });
      if (deleted.count === 0) throw new HttpError(404, 'Reseña no encontrada', 'NOT_FOUND');
    },

    // ─── Wholesale ───
    /** NONE or REJECTED → PENDING. A pending or approved account cannot ask again. */
    async requestWholesale(userId: string, input: WholesaleRequestInput) {
      const updated = await db.user.updateMany({
        where: { id: userId, wholesaleStatus: { in: ['NONE', 'REJECTED'] } },
        data: {
          wholesaleStatus: 'PENDING',
          wholesaleBusinessName: input.businessName,
          wholesaleNote: input.note ?? null,
          wholesaleRequestedAt: new Date(),
        },
      });
      if (updated.count === 0)
        throw new HttpError(
          409,
          'Ya tienes una solicitud en revisión o una cuenta mayorista aprobada',
          'WHOLESALE_EXISTS',
        );
      return profile(userId);
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
