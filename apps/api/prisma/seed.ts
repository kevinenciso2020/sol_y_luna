/**
 * Idempotent seed: `pnpm db:seed`.
 * - Creates records only when missing (keyed by email, slug, SKU, code). It never overwrites
 *   data edited later from the admin, so it is safe to run again in production demo mode.
 * - Sample orders are created once (marked with the "[seed]" note).
 */
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import {
  DEFAULT_COMMISSION_BPS,
  STOCK_RESERVATION_MINUTES,
  applyBps,
  getDepartmentName,
  getMunicipalityName,
} from '@sol-y-luna/shared';
import type { OrderStatus, PriceTier } from '../src/generated/prisma/enums.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { brands, categories, legalTexts, products } from './seed-data.js';

const SEED_MARKER = '[seed]';

const seedEnv = z
  .object({
    DATABASE_URL: z.string({ error: 'Falta la variable de entorno DATABASE_URL' }).min(1),
    ADMIN_SEED_EMAIL: z.email({ error: 'Falta o es inválida la variable ADMIN_SEED_EMAIL' }),
    ADMIN_SEED_PASSWORD: z
      .string({ error: 'Falta la variable de entorno ADMIN_SEED_PASSWORD' })
      .min(12, { error: 'ADMIN_SEED_PASSWORD debe tener al menos 12 caracteres' }),
    OPERATOR_SEED_EMAIL: z.email({ error: 'Falta o es inválida la variable OPERATOR_SEED_EMAIL' }),
    OPERATOR_SEED_PASSWORD: z
      .string({ error: 'Falta la variable de entorno OPERATOR_SEED_PASSWORD' })
      .min(12, { error: 'OPERATOR_SEED_PASSWORD debe tener al menos 12 caracteres' }),
    CUSTOMER_SEED_PASSWORD: z.string().min(10).optional(),
  })
  .safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));

if (!seedEnv.success) {
  console.error(
    `\n❌ No se puede ejecutar el seed:\n  - ${seedEnv.error.issues.map((i) => i.message).join('\n  - ')}\n`,
  );
  process.exit(1);
}
const env = seedEnv.data;
const prisma = createPrismaClient(env.DATABASE_URL);
const log = (message: string) => process.stdout.write(`${message}\n`);

const hash = (password: string) => argon2.hash(password, { type: argon2.argon2id });

async function seedUsers() {
  const customerPassword = env.CUSTOMER_SEED_PASSWORD ?? randomBytes(9).toString('base64url');
  const users = [
    {
      email: env.ADMIN_SEED_EMAIL,
      password: env.ADMIN_SEED_PASSWORD,
      name: 'Kevin (Admin)',
      role: 'ADMIN' as const,
    },
    {
      email: env.OPERATOR_SEED_EMAIL,
      password: env.OPERATOR_SEED_PASSWORD,
      name: 'Operador Sol y Luna',
      role: 'OPERATOR' as const,
    },
    {
      email: 'cliente@solyluna.test',
      password: customerPassword,
      name: 'Laura Gómez',
      role: 'CUSTOMER' as const,
      phone: '3001234567',
    },
    {
      email: 'mayorista@solyluna.test',
      password: customerPassword,
      name: 'Distribuciones Andinas',
      role: 'CUSTOMER' as const,
      phone: '3109876543',
      wholesale: true,
    },
  ];

  let createdCustomers = false;
  const result: Record<string, string> = {};
  for (const user of users) {
    const email = user.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      result[email] = existing.id;
      continue;
    }
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash: await hash(user.password),
        name: user.name,
        role: user.role,
        phone: user.phone ?? null,
        emailVerifiedAt: new Date(),
        ...(user.wholesale
          ? {
              wholesaleStatus: 'APPROVED',
              wholesaleRequestedAt: new Date(),
              wholesaleBusinessName: 'Distribuciones Andinas S.A.S.',
            }
          : {}),
      },
    });
    result[email] = created.id;
    if (user.role === 'CUSTOMER') createdCustomers = true;
    log(`  + usuario ${email} (${user.role}${user.wholesale ? ', mayorista aprobado' : ''})`);
  }

  if (createdCustomers && !env.CUSTOMER_SEED_PASSWORD) {
    log(`  ! Contraseña generada para los clientes de prueba: ${customerPassword}`);
    log('    (define CUSTOMER_SEED_PASSWORD para elegirla tú)');
  }

  const admin = result[env.ADMIN_SEED_EMAIL.toLowerCase()];
  const customer = result['cliente@solyluna.test'];
  const wholesaler = result['mayorista@solyluna.test'];
  if (!admin || !customer || !wholesaler) throw new Error('Usuarios del seed incompletos');
  return { admin, customer, wholesaler };
}

async function seedAddresses(userIds: { customer: string; wholesaler: string }) {
  const addresses = [
    {
      userId: userIds.customer,
      recipientName: 'Laura Gómez',
      phone: '3001234567',
      departmentCode: '05',
      municipalityCode: '05001',
      addressLine: 'Calle 10 # 43-20, apto 502',
      neighborhood: 'El Poblado',
      instructions: 'Dejar en portería',
    },
    {
      userId: userIds.wholesaler,
      recipientName: 'Distribuciones Andinas',
      phone: '3109876543',
      departmentCode: '11',
      municipalityCode: '11001',
      addressLine: 'Carrera 15 # 93-60, bodega 3',
      neighborhood: 'Chicó',
      instructions: 'Horario de recepción: 8:00 a. m. a 5:00 p. m.',
    },
  ];
  for (const address of addresses) {
    const count = await prisma.address.count({ where: { userId: address.userId } });
    if (count === 0) {
      await prisma.address.create({ data: { ...address, isDefault: true } });
    }
  }
}

async function seedCatalog() {
  const categoryIds = new Map<string, string>();
  for (const category of categories) {
    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        slug: category.slug,
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        isAdult: category.isAdult ?? false,
      },
    });
    categoryIds.set(category.slug, record.id);
  }
  log(`  ✓ ${categories.length} categorías`);

  const brandIds = new Map<string, string>();
  for (const [index, brand] of brands.entries()) {
    const record = await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: {},
      create: {
        slug: brand.slug,
        name: brand.name,
        description: brand.description,
        sortOrder: index,
        ...(brand.theme ? { theme: brand.theme } : {}),
      },
    });
    brandIds.set(brand.slug, record.id);
  }
  log(`  ✓ ${brands.length} marcas`);

  for (const product of products) {
    const existing = await prisma.product.findUnique({ where: { slug: product.slug } });
    if (existing) continue;
    await prisma.product.create({
      data: {
        slug: product.slug,
        name: product.name,
        shortDescription: product.shortDescription,
        description: product.description,
        benefits: product.benefits,
        usage: product.usage,
        ingredients: product.ingredients ?? null,
        warnings: product.warnings,
        categoryId: product.category ? (categoryIds.get(product.category) ?? null) : null,
        brandId: product.brand ? (brandIds.get(product.brand) ?? null) : null,
        audience: product.audience,
        isAdult: product.isAdult ?? false,
        invimaStatus: product.invimaStatus,
        invimaCode: product.invimaCode ?? null,
        disclaimer: product.disclaimer,
        status: 'ACTIVE',
        featured: product.featured ?? false,
        minRetailPrice: Math.min(...product.variants.map((v) => v.retailPrice)),
        seoTitle: `${product.name} | Sol y Luna Store`,
        seoDescription: product.shortDescription,
        variants: {
          create: product.variants.map((variant, sortOrder) => ({
            sku: variant.sku,
            name: variant.name,
            retailPrice: variant.retailPrice,
            compareAtPrice: variant.compareAtPrice ?? null,
            wholesalePrice: variant.wholesalePrice ?? null,
            wholesaleMinQty: variant.wholesaleMinQty ?? 6,
            stock: variant.stock,
            weightGrams: variant.weightGrams ?? null,
            sortOrder,
          })),
        },
        images: {
          create: [
            {
              publicId: `/placeholders/${product.placeholder}.svg`,
              alt: `Imagen provisional de ${product.name}`,
              sortOrder: 0,
            },
          ],
        },
      },
    });
    log(`  + producto ${product.name}`);
  }
  log(`  ✓ ${products.length} productos`);
}

async function seedBusinessRules(adminId: string) {
  const globalRule = await prisma.commissionRule.findFirst({
    where: { scope: 'GLOBAL', priceTier: null, isActive: true },
  });
  if (!globalRule) {
    await prisma.commissionRule.create({
      data: {
        scope: 'GLOBAL',
        rateBps: DEFAULT_COMMISSION_BPS,
        fixedAmount: 0,
        createdById: adminId,
      },
    });
    log('  + regla de comisión global del 10%');
  }

  await prisma.coupon.upsert({
    where: { code: 'BIENVENIDA10' },
    update: {},
    create: {
      code: 'BIENVENIDA10',
      description: '10% de descuento en tu primera compra desde $80.000',
      type: 'PERCENT',
      value: 10,
      minSubtotal: 80_000,
      maxUsesPerUser: 1,
      isActive: true,
      appliesToWholesale: false,
    },
  });

  await prisma.storeSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      storeName: 'Sol y Luna Store',
      instagramUrl: 'https://www.instagram.com/solylunastore1/',
      contactEmail: 'hola@example.com',
      supportEmail: 'soporte@example.com',
      settlementFrequency: 'BIWEEKLY',
      homeBanners: [
        {
          title: 'Bienestar que llega a tu puerta',
          subtitle: 'Envío gratis a toda Colombia',
          ctaLabel: 'Ver productos',
          ctaHref: '/productos',
        },
      ],
      ...legalTexts,
    },
  });
  log('  ✓ comisión, cupón y configuración de la tienda');
}

interface SampleOrder {
  userKey: 'customer' | 'wholesaler';
  status: OrderStatus;
  tier: PriceTier;
  items: { sku: string; quantity: number }[];
  daysAgo: number;
  shipment?: { carrier: string; trackingNumber: string; delivered?: boolean };
}

const sampleOrders: SampleOrder[] = [
  {
    userKey: 'customer',
    status: 'DELIVERED',
    tier: 'RETAIL',
    daysAgo: 20,
    items: [{ sku: 'SYL-SAUCO-60', quantity: 2 }],
    shipment: { carrier: 'Servientrega', trackingNumber: '2100045871', delivered: true },
  },
  {
    userKey: 'customer',
    status: 'SHIPPED',
    tier: 'RETAIL',
    daysAgo: 4,
    items: [
      { sku: 'SYL-CNEU-120', quantity: 1 },
      { sku: 'SYL-ALLI-30', quantity: 1 },
    ],
    shipment: { carrier: 'Interrapidísimo', trackingNumber: '700089123456' },
  },
  {
    userKey: 'wholesaler',
    status: 'PREPARING',
    tier: 'WHOLESALE',
    daysAgo: 2,
    items: [
      { sku: 'SYL-WILD-MENTA', quantity: 24 },
      { sku: 'SYL-WILD-SANDIA', quantity: 12 },
    ],
  },
  {
    userKey: 'customer',
    status: 'PAID',
    tier: 'RETAIL',
    daysAgo: 1,
    items: [{ sku: 'SYL-TFEM-60', quantity: 1 }],
  },
  {
    userKey: 'customer',
    status: 'PENDING_PAYMENT',
    tier: 'RETAIL',
    daysAgo: 0,
    items: [{ sku: 'SYL-PERKY-30', quantity: 1 }],
  },
  {
    userKey: 'customer',
    status: 'CANCELLED',
    tier: 'RETAIL',
    daysAgo: 10,
    items: [{ sku: 'SYL-MC185-84', quantity: 1 }],
  },
];

const STATUS_PATH: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['PENDING_PAYMENT'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'PAYMENT_FAILED'],
  PAID: ['PENDING_PAYMENT', 'PAID'],
  PREPARING: ['PENDING_PAYMENT', 'PAID', 'PREPARING'],
  SHIPPED: ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED'],
  DELIVERED: ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'],
  CANCELLED: ['PENDING_PAYMENT', 'CANCELLED'],
  REFUNDED: ['PENDING_PAYMENT', 'PAID', 'REFUNDED'],
};

const PAID_STATUSES: OrderStatus[] = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'];

async function seedOrders(userIds: { customer: string; wholesaler: string }) {
  const already = await prisma.order.count({ where: { notes: { startsWith: SEED_MARKER } } });
  if (already > 0) {
    log('  ✓ pedidos de ejemplo (ya existían)');
    return;
  }

  const globalRule = await prisma.commissionRule.findFirstOrThrow({
    where: { scope: 'GLOBAL', isActive: true },
  });

  for (const sample of sampleOrders) {
    const userId = userIds[sample.userKey];
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const address = await prisma.address.findFirstOrThrow({ where: { userId, isDefault: true } });
    const variants = await prisma.productVariant.findMany({
      where: { sku: { in: sample.items.map((i) => i.sku) } },
      include: { product: true },
    });

    const items = sample.items.map((item) => {
      const variant = variants.find((v) => v.sku === item.sku);
      if (!variant) throw new Error(`SKU no encontrado: ${item.sku}`);
      const wholesale =
        sample.tier === 'WHOLESALE' &&
        variant.wholesalePrice !== null &&
        item.quantity >= variant.wholesaleMinQty;
      const unitPrice = wholesale
        ? (variant.wholesalePrice ?? variant.retailPrice)
        : variant.retailPrice;
      return {
        variant,
        quantity: item.quantity,
        unitPrice,
        priceTier: (wholesale ? 'WHOLESALE' : 'RETAIL') as PriceTier,
        lineTotal: unitPrice * item.quantity,
      };
    });

    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const total = subtotal; // free shipping, no coupon
    const createdAt = new Date(Date.now() - sample.daysAgo * 86_400_000);
    const isPaid = PAID_STATUSES.includes(sample.status);
    const commissionAmount = isPaid
      ? applyBps(subtotal, globalRule.rateBps) + globalRule.fixedAmount
      : null;

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId,
          email: user.email,
          customerName: user.name,
          phone: user.phone ?? address.phone,
          shipRecipientName: address.recipientName,
          shipPhone: address.phone,
          shipDepartmentCode: address.departmentCode,
          shipDepartmentName: getDepartmentName(address.departmentCode) ?? address.departmentCode,
          shipMunicipalityCode: address.municipalityCode,
          shipMunicipalityName:
            getMunicipalityName(address.municipalityCode) ?? address.municipalityCode,
          shipAddressLine: address.addressLine,
          shipNeighborhood: address.neighborhood,
          shipInstructions: address.instructions,
          priceTier: sample.tier,
          subtotal,
          discount: 0,
          shippingCost: 0,
          total,
          status: sample.status,
          paymentProvider: 'MOCK',
          notes: `${SEED_MARKER} pedido de ejemplo`,
          discreetPackaging: sample.userKey === 'customer',
          termsAcceptedAt: createdAt,
          reservationExpiresAt:
            sample.status === 'PENDING_PAYMENT'
              ? new Date(Date.now() + STOCK_RESERVATION_MINUTES * 60_000)
              : null,
          paidAt: isPaid ? createdAt : null,
          cancelledAt: sample.status === 'CANCELLED' ? createdAt : null,
          ...(isPaid && commissionAmount !== null
            ? {
                commissionRuleId: globalRule.id,
                commissionRateBps: globalRule.rateBps,
                commissionFixed: globalRule.fixedAmount,
                commissionAmount,
                gatewayFeeAmount: 0,
                merchantNetAmount: total - commissionAmount,
              }
            : {}),
          createdAt,
          items: {
            create: items.map((i) => ({
              productId: i.variant.productId,
              variantId: i.variant.id,
              productName: i.variant.product.name,
              variantName: i.variant.name,
              sku: i.variant.sku,
              priceTier: i.priceTier,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
              lineTotal: i.lineTotal,
            })),
          },
          statusHistory: {
            create: STATUS_PATH[sample.status].map((toStatus, index, path) => ({
              fromStatus: index === 0 ? null : (path[index - 1] ?? null),
              toStatus,
              note: index === 0 ? 'Pedido creado' : null,
              createdAt,
            })),
          },
          payments: {
            create: [
              {
                provider: 'MOCK',
                reference: `SEED-${randomBytes(6).toString('hex').toUpperCase()}`,
                status: isPaid ? 'APPROVED' : sample.status === 'CANCELLED' ? 'VOIDED' : 'PENDING',
                amount: total,
                createdAt,
              },
            ],
          },
          ...(sample.shipment
            ? {
                shipment: {
                  create: {
                    carrier: sample.shipment.carrier,
                    trackingNumber: sample.shipment.trackingNumber,
                    shippedAt: createdAt,
                    deliveredAt: sample.shipment.delivered
                      ? new Date(createdAt.getTime() + 3 * 86_400_000)
                      : null,
                  },
                },
              }
            : {}),
        },
      });

      // Pending order keeps its stock reserved, like a real checkout would.
      if (sample.status === 'PENDING_PAYMENT') {
        for (const i of items) {
          await tx.productVariant.update({
            where: { id: i.variant.id },
            data: { reservedStock: { increment: i.quantity } },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId: i.variant.id,
              delta: -i.quantity,
              reason: 'RESERVATION',
              reference: `Pedido ${order.number}`,
              orderId: order.id,
            },
          });
        }
      }
    });
  }
  log(`  + ${sampleOrders.length} pedidos de ejemplo`);
}

async function main() {
  log('🌱 Seed de Sol y Luna Store');
  const userIds = await seedUsers();
  await seedAddresses(userIds);
  await seedCatalog();
  await seedBusinessRules(userIds.admin);
  await seedOrders(userIds);
  log('✅ Seed terminado');
}

main()
  .catch((error: unknown) => {
    console.error('❌ Error en el seed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
