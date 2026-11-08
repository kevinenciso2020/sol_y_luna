import { MAX_CART_QTY_PER_LINE } from '@sol-y-luna/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { hashToken, randomToken } from '../lib/crypto.js';
import { HttpError } from '../lib/http-error.js';
import type { Db } from '../lib/prisma.js';
import { VISIBLE_PRODUCT } from './catalog.service.js';
import { evaluateCoupon, priceLine, totals, type PricedLine, type Totals } from './pricing.js';

export const CART_COOKIE = 'syl_cart';
export const CART_COOKIE_MAX_AGE_MS = 30 * 86_400_000;

/** Who owns the cart: a signed-in user, or a guest identified by an opaque cookie. */
export interface CartOwner {
  userId?: string | undefined;
  guestToken?: string | undefined;
}

const itemInclude = {
  variant: {
    include: {
      product: {
        include: {
          images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { publicId: true, alt: true } },
          category: { select: { isAdult: true } },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

type ItemWithVariant = Prisma.CartItemGetPayload<{ include: typeof itemInclude }>;

export interface CartLineView extends PricedLine {
  productId: string;
  productName: string;
  productSlug: string;
  variantName: string;
  sku: string;
  image: { publicId: string; alt: string } | null;
  isAdult: boolean;
  available: number;
  /** Set when the line cannot be bought as is. */
  issue: 'UNAVAILABLE' | 'NOT_ENOUGH_STOCK' | null;
}

export interface CartView {
  lines: CartLineView[];
  itemCount: number;
  totals: Totals;
  coupon: { code: string; ok: boolean; message: string | null } | null;
  canCheckout: boolean;
}

const isPurchasable = (item: ItemWithVariant) =>
  item.variant.isActive &&
  item.variant.product.status === 'ACTIVE' &&
  item.variant.product.deletedAt === null &&
  item.variant.product.minRetailPrice !== null;

export function createCartService(deps: { db: Db; pepper: string }) {
  const { db, pepper } = deps;
  const guestHash = (token: string) => hashToken(`cart:${token}`, pepper);

  async function findCart(owner: CartOwner) {
    if (owner.userId) return db.cart.findUnique({ where: { userId: owner.userId } });
    if (owner.guestToken)
      return db.cart.findUnique({ where: { guestToken: guestHash(owner.guestToken) } });
    return null;
  }

  /** Returns the cart, creating it if needed. For a new guest it also returns the cookie token. */
  async function ensureCart(owner: CartOwner): Promise<{ cartId: string; newGuestToken?: string }> {
    const existing = await findCart(owner);
    if (existing) return { cartId: existing.id };
    if (owner.userId) {
      const cart = await db.cart.upsert({
        where: { userId: owner.userId },
        update: {},
        create: { userId: owner.userId },
      });
      return { cartId: cart.id };
    }
    const token = randomToken();
    const cart = await db.cart.create({ data: { guestToken: guestHash(token) } });
    return { cartId: cart.id, newGuestToken: token };
  }

  async function wholesaleApproved(userId: string | undefined) {
    if (!userId) return false;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { wholesaleStatus: true },
    });
    return user?.wholesaleStatus === 'APPROVED';
  }

  async function assertVariant(variantId: string) {
    const variant = await db.productVariant.findFirst({
      where: { id: variantId, isActive: true, product: VISIBLE_PRODUCT },
      select: { id: true, stock: true, reservedStock: true, name: true },
    });
    if (!variant) throw new HttpError(404, 'Este producto ya no está disponible', 'NOT_FOUND');
    return variant;
  }

  function stockError(available: number) {
    return available <= 0
      ? new HttpError(409, 'Este producto se agotó', 'OUT_OF_STOCK')
      : new HttpError(409, `Solo quedan ${available} unidades disponibles`, 'NOT_ENOUGH_STOCK', {
          available,
        });
  }

  async function view(owner: CartOwner, couponCode?: string): Promise<CartView> {
    const cart = await findCart(owner);
    const items = cart
      ? await db.cartItem.findMany({
          where: { cartId: cart.id },
          include: itemInclude,
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const approved = await wholesaleApproved(owner.userId);

    const lines: CartLineView[] = items.map((item) => {
      const v = item.variant;
      const available = Math.max(0, v.stock - v.reservedStock);
      const priced = priceLine(
        {
          variantId: v.id,
          quantity: item.quantity,
          retailPrice: v.retailPrice,
          wholesalePrice: v.wholesalePrice,
          wholesaleMinQty: v.wholesaleMinQty,
        },
        approved,
      );
      return {
        ...priced,
        productId: v.productId,
        productName: v.product.name,
        productSlug: v.product.slug,
        variantName: v.name,
        sku: v.sku,
        image: v.product.images[0] ?? null,
        isAdult: v.product.isAdult || Boolean(v.product.category?.isAdult),
        available,
        issue: !isPurchasable(item)
          ? 'UNAVAILABLE'
          : item.quantity > available
            ? 'NOT_ENOUGH_STOCK'
            : null,
      };
    });

    const buyable = lines.filter((l) => l.issue !== 'UNAVAILABLE');
    let discount = 0;
    let coupon: CartView['coupon'] = null;
    if (couponCode) {
      const record = await db.coupon.findUnique({ where: { code: couponCode } });
      const subtotal = buyable.reduce((s, l) => s + l.lineTotal, 0);
      const usesByCustomer =
        record && owner.userId
          ? await db.couponRedemption.count({
              where: { couponId: record.id, userId: owner.userId },
            })
          : 0;
      const check = evaluateCoupon(record, {
        subtotal,
        hasWholesaleLines: buyable.some((l) => l.priceTier === 'WHOLESALE'),
        now: new Date(),
        usesByCustomer,
      });
      if (check.ok) discount = check.discount;
      coupon = { code: couponCode, ok: check.ok, message: check.ok ? null : check.reason };
    }

    return {
      lines,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      totals: totals(buyable, discount),
      coupon,
      canCheckout: lines.length > 0 && lines.every((l) => l.issue === null),
    };
  }

  return {
    view,
    ensureCart,
    findCart,
    guestHash,

    async add(owner: CartOwner, variantId: string, quantity: number) {
      const variant = await assertVariant(variantId);
      const { cartId, newGuestToken } = await ensureCart(owner);
      const existing = await db.cartItem.findUnique({
        where: { cartId_variantId: { cartId, variantId } },
      });
      const next = Math.min((existing?.quantity ?? 0) + quantity, MAX_CART_QTY_PER_LINE);
      const available = variant.stock - variant.reservedStock;
      if (next > available) throw stockError(available);
      await db.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId } },
        update: { quantity: next },
        create: { cartId, variantId, quantity: next },
      });
      await db.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
      return { newGuestToken };
    },

    async setQuantity(owner: CartOwner, variantId: string, quantity: number) {
      const cart = await findCart(owner);
      if (!cart) throw new HttpError(404, 'Tu carrito está vacío', 'NOT_FOUND');
      if (quantity === 0) {
        await db.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
        return;
      }
      const variant = await assertVariant(variantId);
      const available = variant.stock - variant.reservedStock;
      if (quantity > available) throw stockError(available);
      const updated = await db.cartItem.updateMany({
        where: { cartId: cart.id, variantId },
        data: { quantity },
      });
      if (updated.count === 0)
        throw new HttpError(404, 'Ese producto no está en tu carrito', 'NOT_FOUND');
    },

    async remove(owner: CartOwner, variantId: string) {
      const cart = await findCart(owner);
      if (cart) await db.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
    },

    async clear(cartId: string) {
      await db.cartItem.deleteMany({ where: { cartId } });
    },

    /**
     * On sign-in the guest cart is merged into the user's cart (quantities add up, capped at the
     * available stock) and the guest cart is deleted.
     */
    async mergeGuestIntoUser(guestToken: string, userId: string) {
      const guest = await db.cart.findUnique({
        where: { guestToken: guestHash(guestToken) },
        include: { items: { include: { variant: true } } },
      });
      if (!guest) return;
      await db.$transaction(async (tx) => {
        const userCart = await tx.cart.upsert({
          where: { userId },
          update: {},
          create: { userId },
        });
        for (const item of guest.items) {
          const existing = await tx.cartItem.findUnique({
            where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
          });
          const available = Math.max(0, item.variant.stock - item.variant.reservedStock);
          const quantity = Math.min(
            (existing?.quantity ?? 0) + item.quantity,
            available,
            MAX_CART_QTY_PER_LINE,
          );
          if (quantity <= 0) continue;
          await tx.cartItem.upsert({
            where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
            update: { quantity },
            create: { cartId: userCart.id, variantId: item.variantId, quantity },
          });
        }
        await tx.cart.delete({ where: { id: guest.id } });
      });
    },
  };
}

export type CartService = ReturnType<typeof createCartService>;
