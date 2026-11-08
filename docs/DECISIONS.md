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
