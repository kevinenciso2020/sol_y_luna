import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { addToCartSchema, couponCodeSchema, updateCartItemSchema } from '@sol-y-luna/shared';
import { handler } from '../lib/async.js';
import {
  CART_COOKIE,
  CART_COOKIE_MAX_AGE_MS,
  type CartOwner,
  type CartService,
} from '../services/cart.service.js';

const variantParams = z.object({
  variantId: z.string().regex(/^[a-z0-9]{20,40}$/, { error: 'Producto inválido' }),
});
const viewQuery = z.object({
  coupon: couponCodeSchema.optional().or(z.literal('').transform(() => undefined)),
});

export function cartOwner(req: Request): CartOwner {
  if (req.auth) return { userId: req.auth.userId };
  const token: unknown = req.cookies?.[CART_COOKIE];
  return {
    guestToken:
      typeof token === 'string' && token.length > 20 && token.length < 100 ? token : undefined,
  };
}

/** Cart of the signed-in user, or of the guest identified by the httpOnly `syl_cart` cookie. */
export function cartRouter(deps: { cart: CartService; secureCookies: boolean }): ExpressRouter {
  const { cart, secureCookies } = deps;
  const router = Router();

  const setGuestCookie = (res: Response, token: string | undefined) => {
    if (!token) return;
    res.cookie(CART_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: CART_COOKIE_MAX_AGE_MS,
    });
  };

  router.get(
    '/',
    handler(async (req, res) => {
      const { coupon } = viewQuery.parse(req.query);
      res.json({ data: await cart.view(cartOwner(req), coupon) });
    }),
  );

  router.post(
    '/items',
    handler(async (req, res) => {
      const { variantId, quantity } = addToCartSchema.parse(req.body);
      const owner = cartOwner(req);
      const { newGuestToken } = await cart.add(owner, variantId, quantity);
      setGuestCookie(res, newGuestToken);
      const view = await cart.view(newGuestToken ? { guestToken: newGuestToken } : owner);
      res.status(201).json({ data: view });
    }),
  );

  router.patch(
    '/items/:variantId',
    handler(async (req, res) => {
      const { variantId } = variantParams.parse(req.params);
      const { quantity } = updateCartItemSchema.parse(req.body);
      await cart.setQuantity(cartOwner(req), variantId, quantity);
      res.json({ data: await cart.view(cartOwner(req)) });
    }),
  );

  router.delete(
    '/items/:variantId',
    handler(async (req, res) => {
      const { variantId } = variantParams.parse(req.params);
      await cart.remove(cartOwner(req), variantId);
      res.json({ data: await cart.view(cartOwner(req)) });
    }),
  );

  return router;
}
