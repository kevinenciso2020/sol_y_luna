# Sol y Luna Store — guía del proyecto

Ecommerce colombiano de suplementos, cuidado íntimo, skincare y bienestar (Instagram @solylunastore1).
Especificación completa: `docs/SPEC.md`. Decisiones fuera del SPEC: `docs/DECISIONS.md` (anotar ahí toda decisión nueva).
Proyecto independiente: no copiar código, datos ni configuración de otros repos.

## Stack

- Monorepo pnpm workspaces, Node 24 LTS (`.nvmrc`), TypeScript ~6.0 estricto.
- `apps/web`: Astro 7 SSR + `@astrojs/cloudflare` (Worker) + Tailwind 4 (tokens en `src/styles/global.css` con `@theme`).
- `apps/api`: Express 5 + TypeScript, pino, helmet, Zod. Prisma 7.10 (adapter `pg`) + Neon (proyecto `sol-y-luna`, región aws-us-east-1 junto a Railway US East; ramas `main` = producción, `dev` = local y `test` = pruebas).
- `packages/shared`: esquemas Zod, constantes (roles, estados, transiciones), dinero (`formatCOP`, `applyBps`), DIVIPOLA del DANE (`@sol-y-luna/shared/divipola`; se regenera con `scripts/generate-divipola.py`).
- Tests: Vitest + Supertest (API), Playwright (compra, fase 5). CI: GitHub Actions.
- Deploy: API en Railway, web en Cloudflare.

## Estructura

```
apps/api/prisma/{schema.prisma, migrations/, seed.ts, seed-data.ts}  + prisma.config.ts
apps/api/src/{config/env.ts, app.ts, server.ts, lib/ (prisma, tokens, crypto, cookies), middleware/ (auth, client-ip, rate-limit), routes/ (auth, addresses, account, cart, checkout, payments, backoffice, admin/), services/ (auth, account, email, turnstile, pricing, commission, orders, backoffice, settlements, payments/), jobs/, test/, generated/ (ignorado)}
apps/web/src/{pages/ (index, productos/, categorias/, marcas/, legal/, verificar-edad.ts, sitemap.xml.ts, robots.txt.ts), components/store/ (ProductCard, ProductMedia, FolkBranch, CatalogView, FilterForm, AgeGate…), middleware.ts, pages/api/[...path].ts (BFF), pages/cuenta|admin|operador/, layouts/, components/ (account/, admin/, shop/, store/), lib/ (auth-client, bff, route-guard, security-headers), scripts/, styles/global.css}
packages/shared/src/{money.ts, constants.ts, schemas.ts, divipola/, index.ts}
docs/{SPEC.md, DECISIONS.md, DEPLOY.md}
```

## Comandos (siempre pnpm, nunca npm ni yarn)

Antes de cualquier comando en la terminal: `source ~/.nvm/nvm.sh && nvm use` (Node 24).

- `pnpm install`
- `pnpm dev` — compila shared y levanta API (:4000) y web (:4321)
- `pnpm lint` / `pnpm lint:fix`
- `pnpm typecheck` — tsc en shared y api, `astro check` en web
- `pnpm test` — unitarias + integración (la API usa `TEST_DATABASE_URL` de `apps/api/.env.test`, rama `test` de Neon)
- `pnpm build`
- `pnpm format` / `pnpm format:check`
- `pnpm e2e` — Playwright (mobile + desktop) contra el build de producción (workerd) y la rama `test`; requiere `apps/api/.env` y `.env.test`
- `pnpm --filter @sol-y-luna/web preview` — build en workerd local (usa `apps/web/.dev.vars`)
- `pnpm db:migrate` — `prisma migrate dev` (solo contra la rama `dev` de Neon)
- `pnpm db:deploy` — `prisma migrate deploy` (producción; Railway lo corre en el pre-deploy)
- `scripts/deploy-web.sh` — publica la web en Cloudflare desde una copia limpia del último commit (ver `docs/DEPLOY.md`)
- `pnpm db:seed` — seed idempotente (requiere ADMIN_/OPERATOR_SEED_* en `apps/api/.env`)
- `pnpm db:generate`, `pnpm db:studio`
- Por paquete: `pnpm --filter @sol-y-luna/api <script>`

## Convenciones

- Código en inglés (variables, funciones, modelos). Todo lo que ve el usuario en español de Colombia, incluidos los errores de validación.
- Dinero siempre en **enteros COP**, nunca floats. Mostrar con `formatCOP` (`$89.900`). Porcentajes en puntos básicos (1000 = 10%).
- Imports ESM con extensión `.js` en api y shared (NodeNext). `import type` para tipos.
- Transiciones de pedido solo vía `canTransitionOrder` (`packages/shared`).
- Prisma: el cliente se importa de `src/generated/prisma/client.js` y se crea una sola vez (`createPrismaClient`). Nunca devolver entidades crudas; mapear a DTO. Migraciones con `DIRECT_URL`; nunca `migrate dev` contra `main`. Los CHECK en SQL van en migraciones nuevas, sin editar las ya aplicadas.
- Commits: conventional commits; un commit por fase como mínimo.
- Diseño: Fraunces (títulos, nombres de producto, precios) y DM Sans (cuerpo). Texto naranja pequeño con `sol-600`; `sol` puro solo para decoración o texto grande (ver la tabla de contraste en DECISIONS).

## Reglas de seguridad

- Nunca poner secretos en el código ni en commits (el repo es **público**). Los secretos van en `.env`; los `.env.example` solo llevan valores de ejemplo.
- La API valida el entorno al arrancar (`apps/api/src/config/env.ts`) y falla diciendo qué variable falta.
- Nunca aceptar precios, totales, descuentos ni comisiones del cliente: todo se recalcula en el servidor.
- Permisos siempre en el servidor (middleware de Express y de Astro). Proteger contra IDOR.
- Validación Zod en params, query y body. Errores centralizados, sin stack traces en producción, con `requestId`.
- Logs con pino, con redacción de contraseñas, tokens, cookies y documentos.
- El access token vive solo en memoria (nunca en localStorage). Refresh token en cookie httpOnly, rotado.
- Web: el navegador solo habla con su dominio; `/api/*` es el BFF que reenvía a `API_INTERNAL_URL` (solo cabeceras permitidas; agrega `x-client-ip` + `x-bff-secret`).
- Auth: endpoints en `/api/auth/*`. Rutas protegidas con `requireAuth` + `requireRole`. Endpoints con cookie (refresh, logout) exigen `x-syl-csrf: 1`. Páginas `/admin`, `/operador` y `/cuenta` protegidas en el middleware de Astro con la cookie `syl_session` (validada por la API).
- Recursos del usuario: siempre filtrar por `userId` en el `where` y responder 404 si no es suyo (`/api/account/*` nunca acepta un id de usuario). Reseñas solo de compradores con pedido entregado y publicadas tras moderación del ADMIN.
- Mensajes de error de auth genéricos (no revelar si un correo existe).
- Dinero de pedidos: precios, cupones y comisión SOLO en el servidor (`services/pricing.ts`, `services/commission.ts`). Stock: reservar/liberar con UPDATE condicional (`orders.service.ts`), nunca leer-y-escribir. Eventos de pago siempre por `processPaymentEvent` (idempotente). Reembolsos solo por `backoffice.refund` (reverso de comisión acumulativo); liquidaciones por `settlements.service.ts` (deben cuadrar al peso).
- Toda mutación del admin escribe `AuditLog` dentro de la misma transacción (`services/audit.ts`). Cambios de stock = `InventoryMovement`.
- Imágenes: solo `publicId` de la carpeta de Cloudinary de la tienda o `/placeholders/*.svg`; en la web usar `imageUrl()` (f_auto,q_auto + ancho).

## UI

- **Responsive en toda pantalla** (320 px a monitores grandes), mobile-first, incluidos los paneles. Listas = tarjetas en móvil y tabla desde `md`. Controles de 44 px o más. Sin scroll horizontal (lo verifica el E2E).
- Tienda: HTML desde el servidor (lee la API con `lib/catalog.ts`), JS mínimo sin framework. Elemento de marca = `ProductMedia` (círculo naranja + anillo azul desplazado) y `FolkBranch`. Tarjetas alternan `variant` crema/luna. +18 con `AgeGate` en el servidor y cookie `syl_edad`. Lighthouse móvil ≥ 90 obligatorio en home y ficha.
- Admin y operador: islas de Preact en `apps/web/src/components/admin/` con `client:only="preact"` y el mismo `AdminLayout` (`area="operator"` para `/operador`); pedidos, stock y liquidaciones reciben `scope` (`admin`/`operator`) y la API los sirve con `routes/backoffice.ts` montado en `/api/admin` y `/api/operator`; kit en `ui.tsx` (`DataList`, `FormDialog`, `ConfirmDialog`…). CRUD simples con `EntityManager` + configuración (con género gramatical: "Nueva categoría").

## Modo demo

Sin credenciales: pagos con mock, imágenes placeholder, emails al log, sin Turnstile (excepto en producción) y sin botón de WhatsApp.

## Estado de las fases

| Fase                                         | Estado                                                       |
| -------------------------------------------- | ------------------------------------------------------------ |
| 0. Base                                      | ✅ Completa                                                  |
| 1. Datos (Prisma, migración, seed, DIVIPOLA) | ✅ Completa                                                  |
| 2. Auth y seguridad                          | ✅ Completa                                                  |
| 3. Catálogo y admin                          | ✅ Completa                                                  |
| 4. Tienda                                    | ✅ Completa                                                  |
| 5. Compra y pagos                            | ✅ Completa                                                  |
| 6. Negocio (comisiones, operador, emails)    | ✅ Completa                                                  |
| 7. Cuenta                                    | ✅ Completa                                                  |
| 8. Despliegue                                | ✅ En línea (falta prueba manual y rotar contraseña de Neon) |

Producción (demo): web https://sol-y-luna-web.kencisosanches.workers.dev (Worker, `scripts/deploy-web.sh`), API https://api-production-0a3d.up.railway.app (Railway, autodeploy desde `main`), base Neon rama `main`. Secretos en `~/.config/sol-y-luna/produccion.env` (fuera del repo, valores entre comillas). Paso a paso y checklist demo → producción en `docs/DEPLOY.md`.

Pendientes conocidos: rotar la contraseña de `solyluna_owner` en Neon `main` (quedó expuesta en una sesión local) y actualizar `DATABASE_URL`/`DIRECT_URL` en Railway; prueba de compra manual en la URL pública (Turnstile bloquea a Playwright); Sentry sin integrar.
