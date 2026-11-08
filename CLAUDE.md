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
apps/api/src/{config/env.ts, app.ts, server.ts, lib/ (prisma, tokens, crypto, cookies), middleware/ (auth, client-ip, rate-limit), routes/ (auth, addresses, panel), services/ (auth, email, turnstile), test/, generated/ (ignorado)}
apps/web/src/{middleware.ts, pages/api/[...path].ts (BFF), pages/cuenta|admin|operador/, layouts/, components/, lib/ (auth-client, bff, route-guard, security-headers), scripts/, styles/global.css}
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
- `pnpm --filter @sol-y-luna/web preview` — build en workerd local (usa `apps/web/.dev.vars`)
- `pnpm db:migrate` — `prisma migrate dev` (solo contra la rama `dev` de Neon)
- `pnpm db:deploy` — `prisma migrate deploy` (producción)
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
- Recursos del usuario: siempre filtrar por `userId` en el `where` y responder 404 si no es suyo.
- Mensajes de error de auth genéricos (no revelar si un correo existe).

## Modo demo

Sin credenciales: pagos con mock, imágenes placeholder, emails al log, sin Turnstile (excepto en producción) y sin botón de WhatsApp.

## Estado de las fases

| Fase                                         | Estado      |
| -------------------------------------------- | ----------- |
| 0. Base                                      | ✅ Completa |
| 1. Datos (Prisma, migración, seed, DIVIPOLA) | ✅ Completa |
| 2. Auth y seguridad                          | ✅ Completa |
| 3. Catálogo y admin                          | Pendiente   |
| 4. Tienda                                    | Pendiente   |
| 5. Compra y pagos                            | Pendiente   |
| 6. Negocio (comisiones, operador, emails)    | Pendiente   |
| 7. Cuenta                                    | Pendiente   |
| 8. Despliegue                                | Pendiente   |

Pendientes conocidos: los SVG de placeholder (`/placeholders/*.svg`) se diseñan en la fase 4; las sesiones KV del adapter de Cloudflare y la región de Railway (US East, junto a Neon) se definen en la fase 8; la rama `main` de Neon aún no tiene migraciones (se aplican al desplegar).
