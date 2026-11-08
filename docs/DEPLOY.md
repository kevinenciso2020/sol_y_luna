# Despliegue de Sol y Luna Store

Guía paso a paso para poner la tienda en línea y pasar de **modo demo** a **producción**.
Ningún secreto va en el repositorio (es público): todos viven en Railway, en Cloudflare o en el
archivo local `~/.config/sol-y-luna/produccion.env` (permisos `600`, fuera del repo).

## Arquitectura

```
Navegador ──► Cloudflare Worker "sol-y-luna-web" (Astro SSR + estáticos, BFF en /api/*)
                    │  API_INTERNAL_URL + x-bff-secret + x-client-ip
                    ▼
              Railway "api" (Express, us-east4) ──► Neon "sol-y-luna" rama main (aws-us-east-1)
                    ▲
Pasarelas ──────────┘  webhooks directos a la API (/api/webhooks/wompi, /api/webhooks/mercadopago)
```

- El navegador solo habla con el dominio de la web. Las cookies son de primera parte; con un
  dominio propio funciona igual.
- Cloudflare atiende la página desde Bogotá. La API y la base están en Virginia, a 1–2 ms entre sí.

## Estado actual (demo en línea)

| Pieza   | Valor                                                                                     |
| ------- | ----------------------------------------------------------------------------------------- |
| Web     | https://sol-y-luna-web.kencisosanches.workers.dev                                         |
| API     | https://api-production-0a3d.up.railway.app (`/health` comprueba la base)                  |
| Neon    | proyecto `sol-y-luna` (`wandering-lake-66954061`), rama `main` = producción               |
| Railway | proyecto `solyluna`, servicio `api`, autodeploy desde `main` (solo cambios de API/shared) |
| KV      | `SOL_Y_LUNA_SESSION` (`3be5be01012243ca84f810f1c6ec74a2`), binding `SESSION`              |
| Modo    | pagos `demo` (pago simulado), imágenes placeholder, correos al log, Turnstile **activo**  |

## 1. Neon (base de datos)

1. Proyecto **sol-y-luna** en `aws-us-east-1`, con las ramas `main` (producción), `dev` (local) y
   `test` (pruebas y E2E).
2. Las cadenas de conexión de `main` se obtienen sin copiarlas a mano:
   ```bash
   neonctl connection-string main --project-id wandering-lake-66954061 \
     --database-name solyluna --role-name solyluna_owner --pooled   # DATABASE_URL (app)
   neonctl connection-string main --project-id wandering-lake-66954061 \
     --database-name solyluna --role-name solyluna_owner            # DIRECT_URL (migraciones)
   ```
   - `DATABASE_URL` usa el pooler y debe terminar en `?sslmode=verify-full&channel_binding=require`.
   - `DIRECT_URL` va sin pooler y debe terminar en `?sslmode=require&connect_timeout=20`.
3. Las migraciones las aplica Railway en cada despliegue (`prisma migrate deploy` en el
   pre-deploy). **Nunca** se corre `migrate dev` contra `main`.
4. Seed demo, idempotente. Se corre desde tu equipo con las variables de producción y sin leer el
   `.env` local:
   ```bash
   cd apps/api
   (set -a; . ~/.config/sol-y-luna/produccion.env; set +a; NODE_ENV=production pnpm exec tsx prisma/seed.ts)
   ```
   Crea el admin y el operador (desde `ADMIN_SEED_*` y `OPERATOR_SEED_*`), dos clientes de prueba,
   el catálogo, la comisión del 10%, el cupón `BIENVENIDA10` y pedidos de ejemplo.
5. **Rotar la contraseña del rol** (Neon → Branches → main → Roles → `solyluna_owner` →
   Reset password) cada vez que se exponga. Después hay que regenerar `DATABASE_URL` y `DIRECT_URL`
   en el archivo local y en Railway (paso 2.3).

## 2. Railway (API)

1. Servicio `api` del proyecto `solyluna`, conectado a `kevinenciso2020/sol_y_luna`, rama `main`.
   - **Build:** `NODE_ENV=development pnpm install --frozen-lockfile && pnpm build:shared && pnpm --filter @sol-y-luna/api build`.
     `NODE_ENV=development` hace que se instalen las dependencias de desarrollo, que se necesitan
     para compilar y para la CLI de Prisma.
   - **Pre-deploy:** `pnpm --filter @sol-y-luna/api db:deploy`.
   - **Start:** `pnpm --filter @sol-y-luna/api start`.
   - **Healthcheck:** `/health`. **Región:** `us-east4`, 1 réplica. El rate limit está en memoria:
     si se agregan réplicas, hay que pasar a un store compartido.
   - **Watch patterns:** `apps/api/**`, `packages/shared/**`, `pnpm-lock.yaml` y `package.json`.
     Un commit que solo toca la web no redespliega la API.
2. El dominio se genera en Railway → Settings → Networking (puerto 8080, el mismo de `PORT`).
3. Las variables se cargan **con la CLI, leyendo el archivo de secretos**. Así los valores no
   aparecen en pantalla. Los valores del archivo van entre comillas: las URLs de Neon tienen `&`.

   ```bash
   (set -a; . ~/.config/sol-y-luna/produccion.env; set +a
    railway variables --service api --environment production \
      --set "DATABASE_URL=$DATABASE_URL" --set "DIRECT_URL=$DIRECT_URL" >/dev/null)
   ```

   | Variable                                       | Producción                                                     |
   | ---------------------------------------------- | -------------------------------------------------------------- |
   | `NODE_ENV` / `PORT` / `LOG_LEVEL`              | `production` / `8080` / `info`                                 |
   | `DATABASE_URL`, `DIRECT_URL`                   | Neon `main` (paso 1.2)                                         |
   | `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`    | `openssl rand -base64 48` (uno distinto para cada una)         |
   | `ENCRYPTION_KEY`                               | `openssl rand -base64 32`                                      |
   | `BFF_SHARED_SECRET`                            | `openssl rand -base64 36`, **el mismo valor** que en el Worker |
   | `CORS_ORIGINS`, `WEB_URL`                      | URL de la web                                                  |
   | `API_URL`                                      | URL de la API                                                  |
   | `PAYMENTS_MODE`                                | `demo` → `live` al tener credenciales                          |
   | `MP_*`, `WOMPI_*`                              | ver pasos 5 y 6                                                |
   | `TURNSTILE_SECRET_KEY`                         | paso 4 (**obligatoria** en producción)                         |
   | `CLOUDINARY_*`, `RESEND_API_KEY`, `EMAIL_FROM` | pasos 7 y 8                                                    |
   | `ADMIN_SEED_EMAIL`, `OPERATOR_SEED_EMAIL`      | correos del seed (las contraseñas no se dejan en Railway)      |

   Si falta una variable obligatoria, la API no arranca y dice cuál es.

## 3. Cloudflare (web)

La web es un **Worker con Static Assets**, no Pages clásico (decisión en `DECISIONS.md`). Su
configuración está en `apps/web/wrangler.jsonc`.

1. KV de sesiones de Astro, una sola vez: `pnpm --filter @sol-y-luna/web exec wrangler kv namespace create SOL_Y_LUNA_SESSION`.
   El id va en `wrangler.jsonc`; no es secreto.
2. Secretos del Worker, una sola vez o al rotarlos:
   ```bash
   cd apps/web
   printf '%s' 'https://api-production-0a3d.up.railway.app' | pnpm exec wrangler secret put API_INTERNAL_URL
   (set -a; . ~/.config/sol-y-luna/produccion.env; set +a; printf '%s' "$BFF_SHARED_SECRET" | pnpm exec wrangler secret put BFF_SHARED_SECRET)
   ```
3. Despliegue, desde una **copia limpia del último commit** (así no se cuelan `.env` ni `.dev.vars`
   locales; Astro incrusta las `PUBLIC_*` al compilar):
   ```bash
   (set -a; . ~/.config/sol-y-luna/produccion.env; set +a
    PUBLIC_SITE_URL=https://sol-y-luna-web.kencisosanches.workers.dev scripts/deploy-web.sh)
   ```
   Opcionales: `PUBLIC_WHATSAPP_NUMBER` (sin él no aparece el botón flotante) y
   `PUBLIC_CLOUDINARY_CLOUD_NAME`.
4. **Dominio propio**, cuando exista: Workers → `sol-y-luna-web` → Settings → Domains & Routes →
   Custom domain. Después hay que actualizar `PUBLIC_SITE_URL` (redesplegar), `CORS_ORIGINS` y
   `WEB_URL` en Railway, y agregar el dominio al widget de Turnstile.

## 4. Turnstile (anti-bot)

1. Cloudflare → Turnstile → widget **"Sol y Luna Store"** en modo _Managed_, con el hostname
   `sol-y-luna-web.kencisosanches.workers.dev` (más el dominio propio cuando exista).
2. `PUBLIC_TURNSTILE_SITE_KEY` es pública y se pasa al desplegar la web. `TURNSTILE_SECRET_KEY` va
   en Railway.
3. Protege el registro, el login, la recuperación de contraseña y el checkout de invitado. Turnstile
   bloquea a los navegadores automatizados (Playwright), así que la prueba de compra en producción
   la hace una persona.

## 5. Mercado Pago (marketplace con split)

1. En https://www.mercadopago.com.co/developers/panel crea la aplicación con la cuenta de Kevin
   (integrador): producto _Checkout Pro_ y modelo _Marketplace_.
2. **OAuth:** URL de redirección `https://api-production-0a3d.up.railway.app/api/payments/mercadopago/oauth/callback`.
   - En Railway: `MP_CLIENT_ID`, `MP_CLIENT_SECRET` y `MP_REDIRECT_URI` con esa misma URL.
3. **Webhooks:** Tus integraciones → Webhooks → URL
   `https://api-production-0a3d.up.railway.app/api/webhooks/mercadopago`, evento _Pagos_.
   - La clave secreta va en `MP_WEBHOOK_SECRET`. La API verifica `x-signature` y consulta el pago
     en Mercado Pago antes de aprobar.
4. `MP_MODE=marketplace` y `PAYMENTS_MODE=live`.
5. El comercio conecta su cuenta desde **/admin/pagos → Conectar Mercado Pago**. Su token se guarda
   cifrado con `ENCRYPTION_KEY` y se renueva solo. Mientras no esté conectada, Mercado Pago no
   aparece en el checkout.
6. Para pruebas sin split existe `MP_MODE=direct` con `MP_ACCESS_TOKEN`.

## 6. Wompi (cuenta del cliente)

1. En el panel de Wompi del cliente → Desarrolladores, copia la llave pública, la privada, el
   secreto de **integridad** y el secreto de **eventos**: `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`,
   `WOMPI_INTEGRITY_SECRET` y `WOMPI_EVENTS_SECRET`.
2. URL de eventos: `https://api-production-0a3d.up.railway.app/api/webhooks/wompi`.
3. `WOMPI_ENV=sandbox` para probar y `production` al salir en vivo. Con `PAYMENTS_MODE=live`.
4. El dinero entra a la cuenta del cliente. La comisión de la plataforma se cobra en la liquidación
   (/admin/liquidaciones).

## 7. Cloudinary (imágenes)

1. Cuenta nueva, carpeta `sol-y-luna`. En Railway: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
   `CLOUDINARY_API_SECRET` y `CLOUDINARY_FOLDER=sol-y-luna`.
2. En la web: `PUBLIC_CLOUDINARY_CLOUD_NAME` al desplegar (paso 3.3) y agregar
   `https://res.cloudinary.com` a la CSP (ya está incluido).
3. Sin Cloudinary la tienda usa placeholders y la subida queda deshabilitada con un aviso.

## 8. Resend (correos)

1. Verifica el dominio de envío en Resend (registros DNS SPF/DKIM). Mientras no haya dominio
   propio, no se pueden enviar correos a clientes reales.
2. En Railway: `RESEND_API_KEY` y `EMAIL_FROM="Sol y Luna Store <no-reply@tudominio.co>"`.
3. Sin `RESEND_API_KEY`, los correos se escriben en el log de Railway (modo demo).

## 9. Sentry (opcional, pendiente)

`SENTRY_DSN` se valida al arrancar, pero el SDK de Sentry **todavía no está integrado** en la API
ni en la web. Integrarlo es un pendiente antes de producción si se quiere seguimiento de errores.

## Checklist: de demo a producción

- [ ] Rotar la contraseña de `solyluna_owner` en Neon `main` y actualizar `DATABASE_URL`/`DIRECT_URL` en Railway.
- [ ] Cambiar la contraseña del admin al primer ingreso y crear el operador real (o cambiarle el correo) en /admin/usuarios.
- [ ] Borrar o desactivar los datos de ejemplo del seed (clientes `@solyluna.test`, pedidos `[seed]`, producto +18 de ejemplo) y cargar el catálogo real.
- [ ] Revisar los textos legales en /admin/configuracion (términos, privacidad Ley 1581, retracto Ley 1480, envíos y devoluciones) y los datos de contacto.
- [ ] Dominio propio en Cloudflare, más Turnstile, `CORS_ORIGINS`, `WEB_URL`, `PUBLIC_SITE_URL` y `EMAIL_FROM` actualizados.
- [ ] Resend con el dominio verificado.
- [ ] Cloudinary configurado y fotos reales subidas.
- [ ] Mercado Pago (app, OAuth, webhook) y/o Wompi (llaves, eventos) configurados; `PAYMENTS_MODE=live`.
- [ ] El comercio conecta su cuenta de Mercado Pago desde /admin/pagos.
- [ ] Una compra real de bajo valor por cada pasarela: aprobada, webhook recibido, comisión fija y reembolso de prueba.
- [ ] `PUBLIC_WHATSAPP_NUMBER` con el número del cliente.
- [ ] (Opcional) Integrar Sentry.
- [ ] Copias de seguridad: confirmar la retención de historial (PITR) en el plan de Neon.

## Verificación después de cada despliegue

```bash
curl -s https://api-production-0a3d.up.railway.app/health        # {"status":"ok","database":"ok",...}
curl -sI https://sol-y-luna-web.kencisosanches.workers.dev/ | grep -i content-security-policy
```

Luego, en el navegador, haz una compra como invitado en modo demo (aprobar en la página de pago de
prueba) y despáchala desde /operador.
