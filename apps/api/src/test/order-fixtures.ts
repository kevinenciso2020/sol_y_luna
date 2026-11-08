import type { Express } from 'express';
import request from 'supertest';
import { ORDER_COOKIE } from '../routes/checkout.js';
import { CART_COOKIE } from '../services/cart.service.js';
import { cookiesFrom, getTestDb } from './integration.js';

export const checkoutAddress = {
  recipientName: 'Laura Gómez',
  phone: '3001234567',
  departmentCode: '05',
  municipalityCode: '05001',
  addressLine: 'Calle 10 # 43-20',
};

/** Guest checkout through the real API; returns the order number and its access cookie. */
export async function placeGuestOrder(
  app: Express,
  variantId: string,
  quantity: number,
  email = 'laura@example.com',
) {
  const cart = await request(app).post('/api/cart/items').send({ variantId, quantity });
  if (cart.status !== 201) throw new Error(`carrito falló: ${cart.status}`);
  const cartCookie = `${CART_COOKIE}=${cookiesFrom(cart.headers['set-cookie'])[CART_COOKIE]}`;
  const res = await request(app)
    .post('/api/checkout')
    .set('Cookie', cartCookie)
    .send({
      contact: { name: 'Laura Gómez', email, phone: '3001234567' },
      address: checkoutAddress,
      discreetPackaging: true,
      paymentProvider: 'MOCK',
      acceptTerms: true,
      acceptDataPolicy: true,
    });
  if (res.status !== 201) throw new Error(`checkout falló: ${JSON.stringify(res.body)}`);
  return {
    orderNumber: res.body.data.orderNumber as string,
    reference: res.body.data.reference as string,
    orderCookie: `${ORDER_COOKIE}=${cookiesFrom(res.headers['set-cookie'])[ORDER_COOKIE]}`,
  };
}

/** Places a guest order and approves it with the mock provider. */
export async function placePaidOrder(app: Express, variantId: string, quantity: number) {
  const order = await placeGuestOrder(app, variantId, quantity);
  const res = await request(app)
    .post('/api/payments/mock/complete')
    .set('Cookie', order.orderCookie)
    .send({ reference: order.reference, outcome: 'approve' });
  if (res.status !== 200) throw new Error(`pago falló: ${res.status}`);
  return order;
}

export const variantBySlug = (slug: string) =>
  getTestDb().productVariant.findFirstOrThrow({ where: { product: { slug } } });
