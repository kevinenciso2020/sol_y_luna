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

### Neon en aws-us-east-1 (Virginia), junto a la API

Primero se creó en São Paulo (aws-sa-east-1), la región de Neon más cercana a Colombia. Pero Railway solo tiene regiones en US West, US East, Europe West y Asia Southeast: la API quedaría en Virginia y cada consulta haría un viaje de ida y vuelta a São Paulo (unos 120 ms). Una página con varias consultas sumaría más de medio segundo. El dueño pidió elegir la opción más rápida (2026-11-08), así que la base se movió a **aws-us-east-1** y la API irá en **Railway US East (us-east4)**: entre ambas hay 1 o 2 ms. Desde Colombia el usuario hace un solo viaje a Virginia (unos 60 ms) y Cloudflare sirve lo estático desde su POP en Bogotá.

Proyecto `sol-y-luna` con tres ramas: `main` (producción), `dev` (desarrollo local) y `test` (pruebas de integración; se vacía en cada corrida).

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

## 2026-11-08 — Fase 2

### Rutas de la API bajo `/api`

Toda la API vive bajo `/api/*` (excepto `GET /health`). El BFF reenvía la misma ruta, así la cookie de refresh con `Path=/api/auth` coincide en la web y en la API, con o sin dominio propio.

### Tokens y sesiones

- Access token: JWT HS256 de 15 min (`iss=sol-y-luna-api`, `aud=sol-y-luna-web`, `sub`, `role`, `jti`, `fam`). Vive solo en memoria en el navegador.
- Refresh token: 32 bytes aleatorios; en la base se guarda `HMAC-SHA256(REFRESH_TOKEN_PEPPER, token)`. Cookie `syl_refresh` httpOnly, `SameSite=Lax`, `Path=/api/auth`, 7 días; `Secure` en producción.
- Rotación en cada uso con reclamo atómico (`updateMany ... where revokedAt is null`). Si llega un token ya rotado, o dos peticiones usan el mismo a la vez, se revoca **toda la familia** (ese login). El cliente web hace un solo refresh a la vez para no disparar falsos positivos.
- `requireAuth` consulta la base en cada petición: el rol sale de la base (no del token), la familia debe seguir viva (el logout y la detección de reutilización invalidan también los access tokens vigentes) y se rechazan tokens anteriores a `passwordChangedAt`.

### Cookie de sesión para páginas (`syl_session`)

La cookie de refresh no viaja a `/admin`, `/operador` ni `/cuenta` (por su `Path`), y el access token no existe en el servidor de Astro. Para proteger esas páginas en el servidor se agrega `syl_session`: un JWT httpOnly (`Path=/`, 7 días) con audiencia `sol-y-luna-pages`, distinta de la del access token, así que la API **no** lo acepta como Bearer. El middleware de Astro lo valida con `GET /api/auth/session`, que comprueba la firma, el usuario y que la familia de la sesión siga activa. Se renueva en cada refresh y se borra en el logout.

### CSRF

Los endpoints que se autentican por cookie (`/auth/refresh`, `/auth/logout`) exigen la cabecera `x-syl-csrf: 1` (un formulario de otro sitio no puede enviarla) y, si el navegador manda `Origin`, que esté en `CORS_ORIGINS`. Las páginas de Astro usan `security.checkOrigin`.

### Anti-enumeración

- Login: un único mensaje para correo inexistente, contraseña incorrecta y cuenta bloqueada. Con un correo inexistente igual se hace un `argon2.verify` contra un hash de relleno, para igualar el tiempo.
- Registro: la misma respuesta si el correo ya existe; en ese caso se envía al dueño un correo de "ya tienes una cuenta". Por eso el registro no inicia sesión automáticamente.
- "Olvidé mi contraseña": la misma respuesta exista o no el correo.

### Bloqueo y contraseñas

- 5 intentos fallidos → bloqueo de 15 minutos (el contador se reinicia al bloquear y con un login correcto).
- argon2id. Política: de 10 a 128 caracteres, al menos una letra y un número, distinta del correo.
- La verificación del correo no es obligatoria para ingresar (en modo demo los correos van al log). Se exigirá para reseñas y para pedir ser mayorista (fase 7).
- Recuperación: token de un solo uso, guardado como hash, que vence en 30 minutos. Al usarlo se revocan todas las sesiones y se marca el correo como verificado. Cambiar la contraseña revoca las demás sesiones y deja viva la actual.

### IP real del cliente (`BFF_SHARED_SECRET`)

Detrás del BFF, la API vería la IP del Worker de Cloudflare para todos los usuarios, y el rate limit sería compartido. El BFF envía `x-client-ip` (de `cf-connecting-ip`) junto con `x-bff-secret`; la API solo confía en esa IP si el secreto coincide (comparación en tiempo constante). Obligatorio en producción.

### Rate limit

`express-rate-limit` en memoria: global 300/min, login 20/15 min, registro 10/h, recuperación 5/15 min y refresh 60/15 min por IP. Sirve con una sola instancia de Railway; si se escalan réplicas, hay que pasar a un store compartido.

### Cabeceras de la web

Astro `security.csp` genera la CSP con hashes (en páginas SSR la manda como cabecera); el middleware agrega `frame-ancestors 'none'` sin pisarla, además de `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `COOP` y HSTS en https. Los dominios de Turnstile están permitidos; los de las pasarelas de pago se agregan en la fase 5.

### Variables de la web con `astro:env`

`API_INTERNAL_URL` y `BFF_SHARED_SECRET` son secretos de servidor; `PUBLIC_*` son públicas. En Cloudflare se leen en tiempo de ejecución. Para `pnpm preview` (workerd local) el script copia `apps/web/.dev.vars` junto al Worker generado.

### Direcciones adelantadas a la fase 2

`/api/account/addresses` (CRUD) se implementó ahora como recurso con dueño para probar IDOR. Un recurso ajeno responde 404 (no 403) para no revelar que existe.

### Pruebas de integración

Usan `TEST_DATABASE_URL`: la rama `test` de Neon en local (`apps/api/.env.test`) y un contenedor de Postgres 18 en el CI. Nunca leen `DATABASE_URL`. Se aplican las migraciones una vez por corrida y se vacían las tablas antes de cada test.

## 2026-11-08 — Fase 3

### `Product.minRetailPrice`

Columna derivada con el precio detal más bajo entre las presentaciones activas. La API la recalcula en cada creación o edición. Permite filtrar y ordenar por precio en SQL (Prisma no ordena por agregados de relaciones). Los productos sin presentaciones activas (`minRetailPrice` nulo) no aparecen en la tienda.

### Catálogo público

- Visible = `status ACTIVE`, sin `deletedAt` y con al menos una presentación activa.
- El filtro por categoría incluye todas sus subcategorías. "Todos los productos" incluye los que no tienen categoría.
- `audience=HIM` muestra solo productos marcados "para él" (los unisex no se mezclan).
- El precio mayorista solo se envía a mayoristas aprobados (autenticación opcional en el catálogo; esas respuestas son `private, no-store`). Las demás respuestas del catálogo tienen caché pública corta (60 a 300 s).
- La marca `+18` del producto también se hereda de su categoría.

### Admin

- Borrar un producto es un soft delete: se marca `deletedAt`, se archiva, se libera el slug (se le agrega el sufijo `-eliminado-xxxx`) y se quita de los carritos. Los SKU no se liberan, porque las presentaciones guardadas los conservan.
- Al quitar una presentación de un producto: si tiene ventas o stock reservado, se desactiva; si no, se borra.
- El stock no puede quedar por debajo del reservado. Cada cambio de stock crea un `InventoryMovement` (`ADJUSTMENT`, o `RESTOCK` si es inicial).
- Borrar una categoría deja sus productos sin categoría (FK `SET NULL`) y sube sus subcategorías al primer nivel. No se permiten ciclos padre/hijo.
- Borrar una marca deja sus productos sin marca. Borrar un cupón no altera pedidos (guardan el código como copia).
- Usuarios: un admin no puede cambiar su propio rol ni borrarse, y siempre queda al menos un admin. Los usuarios creados desde el admin reciben un enlace para crear su contraseña.
- Auditoría: se registran todas las mutaciones del admin; los precios y el stock van como acciones aparte (`variant.price.update`, `variant.stock.update`) con el diff. De los textos legales solo se registra cuáles cambiaron.
- Los errores de unicidad de Prisma se responden con 409 y un mensaje por campo (slug, SKU, código, correo). Con driver adapters, Prisma 7 informa el índice (`Brand_slug_key`) y el campo se extrae de ahí.

### Subida de imágenes (Cloudinary)

Subida directa del navegador a Cloudinary con firma generada en el servidor (`allowed_formats` + `folder` + `timestamp`, SHA-1 con el secreto). Después la API verifica con la Admin API de Cloudinary el formato (JPG, PNG, WebP o AVIF), el tamaño (5 MB como máximo) y la carpeta; si no cumple, borra el archivo y responde 400. Solo ADMIN y OPERATOR. Un producto solo acepta `publicId` de la carpeta de la tienda o placeholders locales. Sin credenciales, la subida responde 503 con un mensaje claro y el admin ofrece las imágenes de ejemplo (`/placeholders/*.svg`). La CSP de la web permite `connect-src https://api.cloudinary.com`.

### Margen de reutilización del refresh token (15 s)

Lo encontraron las pruebas E2E: al navegar rápido, el navegador cancela un refresh que el servidor ya rotó y se queda con el token viejo, lo que se veía como robo y cerraba la sesión. Si un token rotado vuelve dentro de 15 s y la familia sigue viva, se reemplaza el token vivo de la familia (que nunca llegó al navegador) por uno nuevo. Fuera del margen, o si la familia ya no tiene un token vivo, se revoca toda la familia. Es la misma idea que el "reuse interval" de Auth0 o el "grace period" de Okta.

### Panel admin con islas de Preact (`client:only`)

Los formularios del admin (presentaciones dinámicas, editor de beneficios, imágenes ordenables) son islas de Preact (≈4 KB), en vez de TS puro. Se cargan con `client:only` porque el admin es `noindex` y no necesita render en el servidor; así se evita que la hidratación pise lo que el usuario ya escribió. La protección sigue en el servidor (middleware de Astro y API).

### Responsive

Todas las pantallas son mobile-first. Las listas del admin son tarjetas por debajo de `md` y tabla desde `md`. La navegación del admin es un menú desplegable por debajo de `lg` y una barra lateral desde `lg`. Los controles tienen al menos 44 px de alto. Las pruebas E2E fallan si una página del admin tiene scroll horizontal en celular (Pixel 7) o en escritorio (1366 px).

### Pruebas E2E (Playwright)

`pnpm e2e` levanta una API (puerto 4100) y una web (puerto 4400) aparte, contra la rama `test` de Neon, que se migra, se vacía y se siembra antes de cada corrida. Corren en los perfiles "mobile" y "desktop". Astro 7 se manda solo al fondo cuando lo ejecuta un agente; `--ignore-lock` lo mantiene en primer plano para Playwright. El job de E2E en el CI se agrega en la fase 5, junto con la compra completa.

## 2026-11-08 — Fase 4

### Railway: servicio nuevo sin autodeploy

Por pedido del dueño se borró el servicio `solyluna-backend` (código anterior: carpeta `backend/`, Dockerfile, `/api/health`) del proyecto `solyluna` y se creó el servicio `api`, sin repo conectado (no hay autodeploy). Ya está configurado para el monorepo: Railpack, build `pnpm install --frozen-lockfile && pnpm build:shared && pnpm --filter @sol-y-luna/api build`, start `pnpm --filter @sol-y-luna/api start`, pre-deploy `pnpm --filter @sol-y-luna/api db:deploy`, healthcheck `/health`, región `us-east4`, reinicio ante fallos y watch patterns de `apps/api`, `packages/shared` y el lockfile. En la fase 8 se conecta el repo, se cargan las variables y se genera el dominio.

### Tienda renderizada en el servidor, sin framework en el cliente

Las páginas públicas son HTML desde el servidor: las páginas consultan la API directamente (`API_INTERNAL_URL`, de servidor a servidor). La interactividad es mínima y sin frameworks (selector de presentación y galería), y los filtros del catálogo son un formulario GET que funciona sin JS y deja URLs que se pueden compartir. Resultado en Lighthouse móvil, sobre el build de producción en workerd: inicio 100/100/100/100 y ficha 99/100/100/100 (rendimiento, accesibilidad, buenas prácticas y SEO).

### Fuentes

Solo el eje de peso de Fraunces y DM Sans (`wght.css`, unos 36 KB + 40 KB en latin), con precarga del archivo latin. Se descartaron los ejes SOFT/WONK de Fraunces porque triplican el peso.

### Composición del producto

El círculo naranja y el anillo azul desplazado se dibujan con CSS (`ProductMedia`). Para los placeholders se usan siluetas sin fondo (`/placeholders/solo/*.svg`); los placeholders completos (con su propio círculo) quedan para el admin. Las fotos reales de Cloudinary pasan por `f_auto,q_auto`, con `srcset` y `sizes`, y tienen dimensiones fijas para que la página no salte (CLS 0).

### Verificación +18 en el servidor

La ficha de un producto +18 o de una categoría +18 no se renderiza sin la cookie `syl_edad` (httpOnly, 30 días). El formulario de fecha de nacimiento hace un POST a `/verificar-edad` (funciona sin JS), calcula la edad exacta y vuelve a la página original (con `safeNextPath`, sin redirecciones abiertas). En los listados, las imágenes +18 se ven borrosas con la etiqueta "+18" hasta verificar. El contenido +18 queda fuera del sitemap y es `noindex` mientras está bloqueado.

### Chips de las tarjetas

Muestran la audiencia ("PARA ÉL" / "PARA ELLA") o, si no hay, el nombre de la categoría en mayúsculas, como en el Instagram. Las tarjetas alternan las dos variantes de marca: crema con círculo naranja, o azul con bloque naranja.

### Tema de marca (WILD)

La página `/marcas/[slug]` usa el tema guardado en `Brand.theme`: con `mode: dark` la página entera pasa a fondo oscuro, con título en neón y "grafiti" (trazos SVG) usando los acentos de la marca. Los colores vienen validados del admin (`#RRGGBB`).

### Textos legales

Se escriben en Markdown desde el admin. Al publicarlos se escapa todo el HTML antes de convertir y se neutralizan los enlaces que no son `http(s)`, `mailto` o relativos.

### SEO

Canonical en todas las páginas (los filtros apuntan a la URL limpia del catálogo), Open Graph con una imagen por defecto (`/og-default.png`, 1200×630), JSON-LD `Store` en el inicio, `Product` con `Offer` o `AggregateOffer` en COP y envío gratis en la ficha, y `BreadcrumbList`. Además, `sitemap.xml` dinámico y `robots.txt` que excluye `/admin`, `/operador`, `/cuenta` y `/api`.

### Botón "Agregar al carrito"

La ficha deja reservado el espacio (`data-cart-slot`) para el botón del carrito de la fase 5. Mientras tanto, si hay número de WhatsApp configurado, muestra "Pregunta por WhatsApp".
