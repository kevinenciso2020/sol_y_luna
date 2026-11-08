import {
  STOCK_RESERVATION_MINUTES,
  formatOrderNumber,
  getDepartmentName,
  getMunicipalityName,
  type CheckoutInput,
  type OrderStatus,
} from '@sol-y-luna/shared';
import { Prisma, type PaymentProvider as ProviderId } from '../generated/prisma/client.js';
import { hashToken, randomToken } from '../lib/crypto.js';
import { HttpError } from '../lib/http-error.js';
import type { Logger } from '../lib/logger.js';
import type { Db } from '../lib/prisma.js';
import type { CartOwner, CartService } from './cart.service.js';
import { computeCommission } from './commission.js';
import type { EmailSender } from './email.js';
import { orderPaidTemplate, orderReceivedTemplate } from './email-templates.js';
import type { PaymentEvent, PaymentProvider } from './payments/types.js';
import { evaluateCoupon, totals } from './pricing.js';

type Tx = Prisma.TransactionClient;

export interface OrdersServiceDeps {
  db: Db;
  cart: CartService;
  email: EmailSender;
  logger: Logger;
  pepper: string;
  webUrl: string;
  providers: Partial<Record<ProviderId, PaymentProvider>>;
}

/** Atomically reserves stock: succeeds only if enough units are free (no overselling, no locks held). */
async function reserve(tx: Tx, variantId: string, quantity: number): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "ProductVariant"
    SET "reservedStock" = "reservedStock" + ${quantity}, "updatedAt" = NOW()
    WHERE "id" = ${variantId} AND "isActive" AND "stock" - "reservedStock" >= ${quantity}`;
  return updated === 1;
}

/** Releases a reservation (never below zero). */
async function release(tx: Tx, variantId: string, quantity: number) {
  await tx.$executeRaw`
    UPDATE "ProductVariant"
    SET "reservedStock" = GREATEST("reservedStock" - ${quantity}, 0), "updatedAt" = NOW()
    WHERE "id" = ${variantId}`;
}

const orderInclude = {
  items: true,
  shipment: true,
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.OrderInclude;
type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderDto(order: FullOrder) {
  return {
    number: formatOrderNumber(order.number),
    status: order.status,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    email: order.email,
    customerName: order.customerName,
    phone: order.phone,
    shipping: {
      recipientName: order.shipRecipientName,
      phone: order.shipPhone,
      department: order.shipDepartmentName,
      municipality: order.shipMunicipalityName,
      addressLine: order.shipAddressLine,
      neighborhood: order.shipNeighborhood,
      instructions: order.shipInstructions,
    },
    discreetPackaging: order.discreetPackaging,
    priceTier: order.priceTier,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingCost: order.shippingCost,
    total: order.total,
    couponCode: order.couponCode,
    paymentProvider: order.paymentProvider,
    paymentStatus: order.payments[0]?.status ?? null,
    reservationExpiresAt: order.reservationExpiresAt,
    needsReview: order.needsReview,
    items: order.items.map((i) => ({
      productName: i.productName,
      variantName: i.variantName,
      sku: i.sku,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
      priceTier: i.priceTier,
    })),
    shipment: order.shipment
      ? {
          carrier: order.shipment.carrier,
          trackingNumber: order.shipment.trackingNumber,
          trackingUrl: order.shipment.trackingUrl,
          shippedAt: order.shipment.shippedAt,
          deliveredAt: order.shipment.deliveredAt,
        }
      : null,
    history: order.statusHistory.map((h) => ({
      status: h.toStatus,
      at: h.createdAt,
      note: h.note,
    })),
  };
}

export function createOrdersService(deps: OrdersServiceDeps) {
  const { db, cart, email, logger, pepper, webUrl, providers } = deps;
  const tokenHash = (token: string) => hashToken(`order:${token}`, pepper);
  const resultUrl = (reference: string) =>
    `${webUrl.replace(/\/$/, '')}/pago/resultado?ref=${encodeURIComponent(reference)}`;

  function provider(id: ProviderId): PaymentProvider {
    const p = providers[id];
    if (!p)
      throw new HttpError(400, 'Ese medio de pago no está disponible', 'PROVIDER_DISABLED', [
        { path: ['paymentProvider'], message: 'Elige otro medio de pago' },
      ]);
    return p;
  }

  async function sendSafely(message: Parameters<EmailSender['send']>[0]) {
    try {
      await email.send(message);
    } catch (error) {
      logger.error({ err: error, subject: message.subject }, 'no se pudo enviar el email');
    }
  }

  /** Expected commission (for Mercado Pago's marketplace_fee); the final value is frozen when paid. */
  async function previewCommission(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { include: { product: { select: { categoryId: true } } } } },
    });
    const rules = await tx.commissionRule.findMany({ where: { isActive: true } });
    return computeCommission(
      rules,
      order.items.map((i) => ({
        productId: i.productId,
        categoryId: i.product?.categoryId ?? null,
        lineTotal: i.lineTotal,
        priceTier: i.priceTier,
      })),
      order.discount,
    );
  }

  async function startPayment(orderId: string, providerId: ProviderId) {
    const payment = await db.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const commission = await previewCommission(tx, orderId);
      const reference = `${formatOrderNumber(order.number)}-${randomToken(6)
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 6)
        .toUpperCase()}`;
      const created = await tx.payment.create({
        data: { orderId, provider: providerId, reference, status: 'PENDING', amount: order.total },
      });
      return { payment: created, order, commission };
    });
    const { redirectUrl } = await provider(providerId).createCheckout({
      reference: payment.payment.reference,
      orderNumber: formatOrderNumber(payment.order.number),
      amount: payment.order.total,
      commission: payment.commission.amount,
      customer: {
        email: payment.order.email,
        name: payment.order.customerName,
        phone: payment.order.phone,
      },
      resultUrl: resultUrl(payment.payment.reference),
    });
    return { reference: payment.payment.reference, redirectUrl };
  }

  async function setStatus(
    tx: Tx,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    note: string | null,
    changedById: string | null = null,
  ) {
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: from },
      data: { status: to },
    });
    if (moved.count !== 1) return false;
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: from, toStatus: to, note, changedById },
    });
    return true;
  }

  async function releaseOrderReservations(
    tx: Tx,
    orderId: string,
    orderNumber: number,
    reason: string,
  ) {
    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const item of items) {
      if (!item.variantId) continue;
      await release(tx, item.variantId, item.quantity);
      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          delta: item.quantity,
          reason: 'RELEASE',
          reference: `${formatOrderNumber(orderNumber)}: ${reason}`,
          orderId,
        },
      });
    }
  }

  return {
    /** Payment methods available right now (mock only when no real provider is configured). */
    availableProviders(): ProviderId[] {
      return (['MERCADOPAGO', 'WOMPI', 'MOCK'] as const).filter((p) => providers[p]);
    },

    async checkout(input: CheckoutInput, owner: CartOwner) {
      const view = await cart.view(owner, input.couponCode);
      if (view.lines.length === 0) throw new HttpError(400, 'Tu carrito está vacío', 'EMPTY_CART');
      const blocked = view.lines.find((l) => l.issue);
      if (blocked) {
        throw new HttpError(
          409,
          blocked.issue === 'UNAVAILABLE'
            ? `"${blocked.productName}" ya no está disponible. Quítalo del carrito para continuar.`
            : `Solo quedan ${blocked.available} unidades de "${blocked.productName}". Ajusta la cantidad.`,
          'CART_CHANGED',
        );
      }
      provider(input.paymentProvider); // fail early on a disabled method

      // Shipping address: an address of this user, or the one typed in the form.
      let address = input.address;
      if (input.addressId) {
        if (!owner.userId)
          throw new HttpError(400, 'Escribe la dirección de entrega', 'INVALID_ADDRESS');
        const saved = await db.address.findFirst({
          where: { id: input.addressId, userId: owner.userId },
        });
        if (!saved) throw new HttpError(404, 'Dirección no encontrada', 'NOT_FOUND');
        address = {
          recipientName: saved.recipientName,
          phone: saved.phone,
          departmentCode: saved.departmentCode,
          municipalityCode: saved.municipalityCode,
          addressLine: saved.addressLine,
          neighborhood: saved.neighborhood ?? undefined,
          instructions: saved.instructions ?? undefined,
        };
      }
      if (!address) throw new HttpError(400, 'Escribe la dirección de entrega', 'INVALID_ADDRESS');

      const cartRecord = await cart.findCart(owner);
      const accessToken = randomToken();

      const order = await db.$transaction(
        async (tx) => {
          // Coupon re-checked inside the transaction, now with the customer's email.
          let discount = 0;
          let coupon = null;
          if (input.couponCode) {
            coupon = await tx.coupon.findUnique({ where: { code: input.couponCode } });
            const usesByCustomer = coupon
              ? await tx.couponRedemption.count({
                  where: {
                    couponId: coupon.id,
                    OR: [
                      { email: input.contact.email },
                      ...(owner.userId ? [{ userId: owner.userId }] : []),
                    ],
                  },
                })
              : 0;
            const check = evaluateCoupon(coupon, {
              subtotal: view.totals.subtotal,
              hasWholesaleLines: view.lines.some((l) => l.priceTier === 'WHOLESALE'),
              now: new Date(),
              usesByCustomer,
            });
            if (!check.ok)
              throw new HttpError(400, check.reason, 'INVALID_COUPON', [
                { path: ['couponCode'], message: check.reason },
              ]);
            discount = check.discount;
          }
          const sums = totals(view.lines, discount);

          for (const line of view.lines) {
            if (!(await reserve(tx, line.variantId, line.quantity))) {
              throw new HttpError(
                409,
                `Se agotó "${line.productName}" mientras comprabas. Revisa tu carrito.`,
                'OUT_OF_STOCK',
              );
            }
          }

          const created = await tx.order.create({
            data: {
              userId: owner.userId ?? null,
              email: input.contact.email,
              customerName: input.contact.name,
              phone: input.contact.phone,
              documentNumber: input.contact.documentNumber ?? null,
              shipRecipientName: address.recipientName,
              shipPhone: address.phone,
              shipDepartmentCode: address.departmentCode,
              shipDepartmentName:
                getDepartmentName(address.departmentCode) ?? address.departmentCode,
              shipMunicipalityCode: address.municipalityCode,
              shipMunicipalityName:
                getMunicipalityName(address.municipalityCode) ?? address.municipalityCode,
              shipAddressLine: address.addressLine,
              shipNeighborhood: address.neighborhood ?? null,
              shipInstructions: address.instructions ?? null,
              priceTier: sums.priceTier,
              subtotal: sums.subtotal,
              discount: sums.discount,
              shippingCost: sums.shipping,
              total: sums.total,
              couponId: coupon?.id ?? null,
              couponCode: coupon?.code ?? null,
              paymentProvider: input.paymentProvider,
              notes: input.notes ?? null,
              discreetPackaging: input.discreetPackaging,
              termsAcceptedAt: new Date(),
              accessTokenHash: tokenHash(accessToken),
              reservationExpiresAt: new Date(Date.now() + STOCK_RESERVATION_MINUTES * 60_000),
              items: {
                create: view.lines.map((l) => ({
                  productId: l.productId,
                  variantId: l.variantId,
                  productName: l.productName,
                  variantName: l.variantName,
                  sku: l.sku,
                  priceTier: l.priceTier,
                  unitPrice: l.unitPrice,
                  quantity: l.quantity,
                  lineTotal: l.lineTotal,
                })),
              },
              statusHistory: {
                create: { fromStatus: null, toStatus: 'PENDING_PAYMENT', note: 'Pedido creado' },
              },
            },
          });

          for (const line of view.lines) {
            await tx.inventoryMovement.create({
              data: {
                variantId: line.variantId,
                delta: -line.quantity,
                reason: 'RESERVATION',
                reference: formatOrderNumber(created.number),
                orderId: created.id,
              },
            });
          }

          if (coupon) {
            const used = await tx.$executeRaw`
              UPDATE "Coupon" SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
              WHERE "id" = ${coupon.id} AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
            if (used !== 1) throw new HttpError(400, 'El cupón ya se agotó', 'INVALID_COUPON');
            await tx.couponRedemption.create({
              data: {
                couponId: coupon.id,
                orderId: created.id,
                userId: owner.userId ?? null,
                email: input.contact.email,
              },
            });
          }

          if (owner.userId && input.saveAddress && input.address) {
            const count = await tx.address.count({ where: { userId: owner.userId } });
            if (count < 10) {
              await tx.address.create({
                data: {
                  userId: owner.userId,
                  recipientName: input.address.recipientName,
                  phone: input.address.phone,
                  departmentCode: input.address.departmentCode,
                  municipalityCode: input.address.municipalityCode,
                  addressLine: input.address.addressLine,
                  neighborhood: input.address.neighborhood ?? null,
                  instructions: input.address.instructions ?? null,
                  isDefault: count === 0,
                },
              });
            }
          }
          if (cartRecord) await tx.cartItem.deleteMany({ where: { cartId: cartRecord.id } });
          return created;
        },
        { timeout: 20_000 },
      );

      logger.info({ orderId: order.id, number: order.number }, 'pedido creado');
      const full = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      });
      await sendSafely({
        to: full.email,
        ...orderReceivedTemplate({ order: toOrderDto(full), link: `${webUrl}/pago/resultado` }),
      });
      const payment = await startPayment(order.id, input.paymentProvider);
      return { orderNumber: formatOrderNumber(order.number), accessToken, ...payment };
    },

    /** PAYMENT_FAILED orders can be paid again: stock is reserved again and a new payment is created. */
    async retryPayment(
      orderNumber: number,
      owner: { userId?: string | undefined; accessToken?: string | undefined },
      providerId?: ProviderId,
    ) {
      const order = await this.findAuthorized(orderNumber, owner);
      if (order.status !== 'PAYMENT_FAILED')
        throw new HttpError(
          409,
          'Este pedido no tiene un pago pendiente de reintentar',
          'INVALID_STATE',
        );
      const chosen = providerId ?? order.paymentProvider ?? 'MOCK';
      provider(chosen);
      await db.$transaction(async (tx) => {
        for (const item of order.items) {
          if (!item.variantId || !(await reserve(tx, item.variantId, item.quantity))) {
            throw new HttpError(
              409,
              `Ya no hay stock de "${item.productName}" para reintentar el pago.`,
              'OUT_OF_STOCK',
            );
          }
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              delta: -item.quantity,
              reason: 'RESERVATION',
              reference: `${formatOrderNumber(order.number)}: reintento`,
              orderId: order.id,
            },
          });
        }
        if (
          !(await setStatus(
            tx,
            order.id,
            'PAYMENT_FAILED',
            'PENDING_PAYMENT',
            'Nuevo intento de pago',
          ))
        ) {
          throw new HttpError(
            409,
            'El pedido cambió de estado. Recarga la página.',
            'INVALID_STATE',
          );
        }
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentProvider: chosen,
            reservationExpiresAt: new Date(Date.now() + STOCK_RESERVATION_MINUTES * 60_000),
          },
        });
      });
      return startPayment(order.id, chosen);
    },

    /** The order owner (signed in) or whoever holds the order's access token. */
    async findAuthorized(
      orderNumber: number,
      owner: { userId?: string | undefined; accessToken?: string | undefined },
    ) {
      const order = await db.order.findUnique({
        where: { number: orderNumber },
        include: orderInclude,
      });
      const allowed =
        order &&
        ((owner.userId && order.userId === owner.userId) ||
          (owner.accessToken &&
            order.accessTokenHash &&
            order.accessTokenHash === tokenHash(owner.accessToken)));
      if (!order || !allowed) throw new HttpError(404, 'Pedido no encontrado', 'NOT_FOUND');
      return order;
    },

    async findByReference(reference: string) {
      const payment = await db.payment.findUnique({
        where: { reference },
        include: { order: { include: orderInclude } },
      });
      if (!payment) throw new HttpError(404, 'Pago no encontrado', 'NOT_FOUND');
      return payment;
    },

    /**
     * Applies a verified payment event exactly once (WebhookEvent is unique per provider + event id).
     * Approval runs in ONE transaction: order PAID, stock deducted, reservation released, inventory
     * movements, frozen commission and status history. The email is sent afterwards.
     */
    async processPaymentEvent(
      event: PaymentEvent,
    ): Promise<{ duplicate: boolean; outcome: string }> {
      let outcome = 'ignored';
      let paidOrderId: string | null = null;
      try {
        await db.$transaction(
          async (tx) => {
            await tx.webhookEvent.create({
              data: {
                provider: event.provider,
                externalEventId: event.externalEventId,
                payload: event.raw as Prisma.InputJsonValue,
              },
            });

            const payment = await tx.payment.findUnique({
              where: { reference: event.reference },
              include: {
                order: {
                  include: { items: { include: { product: { select: { categoryId: true } } } } },
                },
              },
            });
            if (!payment || payment.provider !== event.provider) {
              outcome = 'unknown_reference';
              await tx.webhookEvent.update({
                where: {
                  provider_externalEventId: {
                    provider: event.provider,
                    externalEventId: event.externalEventId,
                  },
                },
                data: { processedAt: new Date(), error: 'Referencia desconocida' },
              });
              return;
            }
            const order = payment.order;
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: event.status,
                externalId: event.externalPaymentId ?? payment.externalId,
                feeAmount: event.feeAmount,
                rawPayload: event.raw as Prisma.InputJsonValue,
              },
            });

            if (event.status === 'APPROVED') {
              const amountMatches =
                event.amount !== null &&
                Number.isInteger(event.amount) &&
                event.amount === order.total;
              const payable = order.status === 'PENDING_PAYMENT';
              if (!amountMatches || !payable) {
                const reason = !amountMatches
                  ? `El monto pagado (${event.amount ?? 'desconocido'}) no coincide con el total del pedido (${order.total})`
                  : `Pago aprobado para un pedido en estado ${order.status}`;
                await tx.order.update({
                  where: { id: order.id },
                  data: { needsReview: true, reviewReason: reason },
                });
                await tx.orderStatusHistory.create({
                  data: {
                    orderId: order.id,
                    fromStatus: order.status,
                    toStatus: order.status,
                    note: `Revisión manual: ${reason}`,
                  },
                });
                logger.warn({ orderId: order.id, reason }, 'pago aprobado enviado a revisión');
                outcome = 'needs_review';
                return;
              }

              for (const item of order.items) {
                if (!item.variantId) continue;
                // Deduct the stock and release the reservation in one statement.
                await tx.$executeRaw`
                  UPDATE "ProductVariant"
                  SET "stock" = "stock" - ${item.quantity},
                      "reservedStock" = GREATEST("reservedStock" - ${item.quantity}, 0),
                      "updatedAt" = NOW()
                  WHERE "id" = ${item.variantId}`;
                await tx.inventoryMovement.createMany({
                  data: [
                    {
                      variantId: item.variantId,
                      delta: item.quantity,
                      reason: 'RELEASE',
                      reference: formatOrderNumber(order.number),
                      orderId: order.id,
                    },
                    {
                      variantId: item.variantId,
                      delta: -item.quantity,
                      reason: 'SALE',
                      reference: formatOrderNumber(order.number),
                      orderId: order.id,
                    },
                  ],
                });
              }

              const rules = await tx.commissionRule.findMany({ where: { isActive: true } });
              const commission = computeCommission(
                rules,
                order.items.map((i) => ({
                  productId: i.productId,
                  categoryId: i.product?.categoryId ?? null,
                  lineTotal: i.lineTotal,
                  priceTier: i.priceTier,
                })),
                order.discount,
              );
              const gatewayFee = event.feeAmount ?? 0;
              await tx.order.update({
                where: { id: order.id },
                data: {
                  paidAt: new Date(),
                  reservationExpiresAt: null,
                  commissionRuleId: commission.ruleId,
                  commissionRateBps: commission.rateBps,
                  commissionFixed: commission.fixed,
                  commissionAmount: commission.amount,
                  gatewayFeeAmount: event.feeAmount,
                  merchantNetAmount: order.total - commission.amount - gatewayFee,
                },
              });
              await setStatus(
                tx,
                order.id,
                'PENDING_PAYMENT',
                'PAID',
                `Pago aprobado (${event.provider})`,
              );
              paidOrderId = order.id;
              outcome = 'paid';
            } else if (
              event.status === 'DECLINED' ||
              event.status === 'ERROR' ||
              event.status === 'VOIDED'
            ) {
              if (order.status === 'PENDING_PAYMENT') {
                await releaseOrderReservations(tx, order.id, order.number, 'pago rechazado');
                await tx.order.update({
                  where: { id: order.id },
                  data: { reservationExpiresAt: null },
                });
                await setStatus(
                  tx,
                  order.id,
                  'PENDING_PAYMENT',
                  'PAYMENT_FAILED',
                  `Pago rechazado (${event.provider})`,
                );
                outcome = 'failed';
              }
            } else {
              outcome = 'pending';
            }

            await tx.webhookEvent.update({
              where: {
                provider_externalEventId: {
                  provider: event.provider,
                  externalEventId: event.externalEventId,
                },
              },
              data: { processedAt: new Date() },
            });
          },
          { timeout: 20_000 },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return { duplicate: true, outcome: 'duplicate' };
        }
        throw error;
      }

      if (paidOrderId) {
        const full = await db.order.findUniqueOrThrow({
          where: { id: paidOrderId },
          include: orderInclude,
        });
        await sendSafely({ to: full.email, ...orderPaidTemplate({ order: toOrderDto(full) }) });
      }
      return { duplicate: false, outcome };
    },

    /**
     * Cancels unpaid orders whose reservation expired and releases their stock. A transaction-level
     * advisory lock keeps two instances from running it at the same time (works through PgBouncer).
     */
    async expireReservations(now = new Date()): Promise<number> {
      return db.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(727201) AS locked`;
          if (!lock?.locked) return 0;
          const expired = await tx.order.findMany({
            where: { status: 'PENDING_PAYMENT', reservationExpiresAt: { lt: now } },
            select: { id: true, number: true },
            take: 100,
          });
          for (const order of expired) {
            if (
              !(await setStatus(
                tx,
                order.id,
                'PENDING_PAYMENT',
                'CANCELLED',
                'Reserva vencida: no se recibió el pago a tiempo',
              ))
            )
              continue;
            await releaseOrderReservations(tx, order.id, order.number, 'reserva vencida');
            await tx.order.update({
              where: { id: order.id },
              data: { cancelledAt: now, reservationExpiresAt: null },
            });
            await tx.payment.updateMany({
              where: { orderId: order.id, status: 'PENDING' },
              data: { status: 'VOIDED' },
            });
          }
          if (expired.length) logger.info({ count: expired.length }, 'reservas vencidas liberadas');
          return expired.length;
        },
        { timeout: 30_000 },
      );
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
