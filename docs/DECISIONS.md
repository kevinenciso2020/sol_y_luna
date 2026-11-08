# Decisiones técnicas

Registro de decisiones que no están en `docs/SPEC.md` o que lo ajustan. Formato: fecha, decisión, motivo.

## 2026-11-07 — Fase 0

### Node.js 24 LTS

Astro 7 exige Node ≥ 22.23 y algunas herramientas (eslint-plugin-astro 3) piden ≥ 22.22.3. Se fija Node 24 LTS (`.nvmrc`, `engines`), soportado por Railway, Cloudflare y GitHub Actions.

### Versiones principales

Astro 7, `@astrojs/cloudflare` 14, Tailwind CSS 4 (tokens con `@theme` en CSS, sin `tailwind.config`), Express 5, Zod 4, ESLint 10 (flat config), Vitest 5. TypeScript se fija en `~6.0` porque `typescript-eslint` aún no soporta TS 7.

### Web en Cloudflare Workers (no Pages clásico)

Desde la versión 13, `@astrojs/cloudflare` genera un Worker con Static Assets en lugar de un proyecto de Pages. Es la ruta que Cloudflare recomienda para SSR nuevo y se comporta igual para el BFF (`/api/[...path]`) y las cookies de primera parte. El dominio provisional pasa a ser `*.workers.dev` en lugar de `*.pages.dev`. Detalle del despliegue en `docs/DEPLOY.md` (fase 8).

### Imágenes sin binding de Cloudflare

El adapter usa `imageService: 'passthrough'`: las imágenes se optimizan con Cloudinary (`f_auto,q_auto`), no con Cloudflare Images.

### Paquete `shared` compilado

`@sol-y-luna/shared` se compila a `dist/` con `tsc` y las apps consumen el build. Los scripts raíz `dev`, `typecheck` y `test` lo compilan primero (`pnpm build:shared`).

### Ejecución de la API

Desarrollo con `tsx watch`; producción con `tsc` + `node --env-file-if-exists=.env`. No se usa `dotenv`.

### Variables de entorno de la API

- Las cadenas vacías cuentan como "no definida" (así se activan los modos demo).
- Obligatorias siempre: `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥ 32), `REFRESH_TOKEN_PEPPER` (≥ 32), `ENCRYPTION_KEY` (32 bytes base64), `CORS_ORIGINS`, `WEB_URL`, `API_URL`.
- En producción además: `TURNSTILE_SECRET_KEY`, y `CORS_ORIGINS` no puede ser `*`.
- `PAYMENTS_MODE=live` solo activa un proveedor si **todas** sus credenciales están; si no, se usa el mock.
- `API_INTERNAL_URL` es variable de la web (BFF), no de la API.

### Transiciones de estado del pedido

Además de la ruta principal `PENDING_PAYMENT → PAID → PREPARING → SHIPPED → DELIVERED`:

- `PENDING_PAYMENT → PAYMENT_FAILED | CANCELLED` (rechazo o reserva vencida).
- `PAYMENT_FAILED → PENDING_PAYMENT` (reintento de pago) o `CANCELLED`.
- `PAID | PREPARING → CANCELLED | REFUNDED`; `SHIPPED | DELIVERED → REFUNDED`.
- `CANCELLED` y `REFUNDED` son finales.
  Fuente única: `ORDER_TRANSITIONS` en `packages/shared/src/constants.ts`.

### Dinero

Enteros COP. Porcentajes en puntos básicos y redondeo "half away from zero" al peso (`applyBps`), solo con aritmética entera.

### Contraste de la paleta (WCAG AA)

| Combinación                 | Relación | Uso permitido                                                  |
| --------------------------- | -------- | -------------------------------------------------------------- |
| luna #1747B5 sobre crema    | 7,4:1    | cualquier texto                                                |
| crema sobre luna            | 7,4:1    | cualquier texto (CTA, chips)                                   |
| noche #0F2557 sobre crema   | 13,6:1   | cualquier texto                                                |
| sol #E9552E sobre crema     | 3,3:1    | solo decoración o texto grande (≥ 24 px, o ≥ 19 px en negrita) |
| sol-600 #C9411D sobre crema | 4,55:1   | texto naranja pequeño (precio en oferta)                       |
| sol sobre luna              | 2,2:1    | nunca para texto                                               |

### Botón de WhatsApp

Verde oscuro `#1f7a43` (blanco encima, 5,4:1) en lugar del verde oficial claro, que no cumple AA con el ícono blanco.

### pnpm `packageExtensions`

`@napi-rs/wasm-runtime` (dependencia de `astro check`) no recibe sus peers `@emnapi/*` con pnpm; se agregan con `packageExtensions` en `pnpm-workspace.yaml`.

## 2026-11-07 — Fase 1

### Neon en São Paulo (aws-sa-east-1)

Pedido del dueño: la base vive en São Paulo, la región de Neon más cercana a Colombia. Proyecto `sol-y-luna` con dos ramas: `main` (producción) y `dev` (desarrollo local). Las migraciones se prueban primero en `dev`. Al desplegar la API en Railway hay que elegir la región más cercana a São Paulo para no sumar latencia en cada consulta (se define en la fase 8).

### Prisma 7.10 (estable)

El tag `latest` de npm apunta a Prisma 8 RC, así que se fija 7.10.1. Prisma 7 usa:

- el generador `prisma-client` con salida en `apps/api/src/generated/prisma` (no se sube al repo; se genera en `build`, `typecheck` y `test`);
- el driver adapter `@prisma/adapter-pg` en tiempo de ejecución con `DATABASE_URL` (pooler de Neon, `sslmode=verify-full`);
- `prisma.config.ts` para las migraciones, con `DIRECT_URL` (conexión directa, sin pooler).

### Restricciones CHECK en la migración inicial

Prisma no expresa CHECK, así que se agregan en SQL al final de `20261108000000_init`: stock ≥ 0 y reservado ≤ stock; precios ≥ 0; `total = subtotal − descuento + envío`; `lineTotal = unitPrice × cantidad`; calificación de 1 a 5; cupón PERCENT entre 1 y 100; comisión entre 0 y 10.000 bps y coherente con su alcance; número INVIMA obligatorio si el estado es REGISTERED; StoreSettings con una sola fila; una dirección por defecto por usuario.

### Modelo de datos: decisiones puntuales

- IDs `cuid()`. El número de pedido es `Order.number` (autoincremental) y se muestra como `SYL-000123` con `formatOrderNumber`.
- La "comisión opcional por producto" del SPEC se modela como `CommissionRule` con alcance `PRODUCT`, para tener una sola fuente de verdad.
- `CouponRedemption` registra cada uso de cupón (también de invitados, por email) para aplicar `maxUsesPerUser`.
- `PaymentAccount` guarda la conexión OAuth de Mercado Pago con los tokens cifrados.
- `Category.isAdult` permite poner la verificación de edad también a nivel de categoría.
- `Order.accessTokenHash` permite que un invitado consulte su pedido sin cuenta.
- `WebhookEvent` es único por `(provider, externalEventId)`.
- `InventoryMovement.delta` negativo en ventas y reservas, positivo en reabastecimientos y liberaciones.
- Los nombres de municipio son los oficiales del DANE (por ejemplo, "Santiago de Cali", "San José de Cúcuta").

### Seed

- Idempotente y no destructivo: crea lo que falta y nunca sobrescribe lo que se haya editado desde el admin. Los pedidos de ejemplo se crean una sola vez (nota `[seed]`).
- Los códigos INVIMA del seed son ficticios y llevan el prefijo `DEMO-` para que nadie los tome por reales.
- Contraseñas: admin y operador desde las variables de entorno (mínimo 12 caracteres). Para los clientes de prueba se usa `CUSTOMER_SEED_PASSWORD` (variable nueva, opcional); si falta, se genera una aleatoria y se muestra una sola vez.
- Las imágenes apuntan a `/placeholders/{frasco|gotero|tubo|spray|lata}.svg`; los SVG se diseñan en la fase 4.

### Red local con IPv6 roto

En la máquina de desarrollo el motor de Prisma intentaba conectarse por IPv6 sin ruta y fallaba. Se resolvió dando prioridad a IPv4 en `/etc/gai.conf` (`precedence ::ffff:0:0/96 100`). No afecta al código ni a los servidores.
