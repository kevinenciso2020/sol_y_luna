# Especificación — Sol y Luna Store

> Documento fuente entregado por el dueño del proyecto (2026-11-07). Es la referencia funcional; las decisiones no cubiertas aquí se registran en `docs/DECISIONS.md`.

Vas a construir desde cero el ecommerce de Sol y Luna Store (Instagram @solylunastore1), una tienda colombiana que importa y vende suplementos, potenciadores, cremas, skincare y productos de bienestar. El repositorio es https://github.com/kevinenciso2020/sol_y_luna.git y está vacío.

El objetivo es un producto funcional de producción, con base de datos real, que solo necesite poner credenciales para salir en vivo. Mientras no haya credenciales, todo debe funcionar en modo demo para presentárselo al cliente.

Este proyecto NO tiene relación con ningún otro ecommerce previo. No copies código, datos ni configuración de otros repos.

## 0. Cómo debes trabajar (léelo primero)

Usa tus skills. Antes de empezar, revisa qué skills tienes disponibles en este entorno y úsalas siempre que apliquen: por ejemplo la de diseño frontend para toda la UI, y las de testing, seguridad, revisión de código, git o despliegue que tengas instaladas. Antes de cada fase, di qué skills vas a usar en ella.

Crea la memoria del proyecto. Lo primero que haces es guardar este documento como docs/SPEC.md. Después creas un CLAUDE.md en la raíz con lo esencial: stack, estructura, comandos, convenciones, reglas de seguridad y estado de las fases. Mantén CLAUDE.md actualizado al cerrar cada fase.

Trabaja por fases (sección 11). Al iniciar cada fase, muéstrame un plan corto. Al terminarla:

- corre lint, typecheck y tests,
- haz un commit con un mensaje claro (conventional commits),
- dame un resumen de lo hecho y de lo pendiente,
- espera mi confirmación antes de pasar a la siguiente.

Nunca pongas secretos en el código ni en commits. Todo va en .env, y .env.example lleva solo valores de ejemplo.

Si una decisión no está en este documento, elige la opción más segura y estándar, y anótala en docs/DECISIONS.md.

Usa pnpm siempre, nunca npm ni yarn.

El código va en inglés (variables, funciones, modelos). Todo lo que ve el usuario va en español de Colombia. Los precios se muestran en COP con formato $89.900.

## 1. Stack

| Capa | Tecnología |
| --- | --- |
| Monorepo | pnpm workspaces |
| Frontend | Astro (SSR) + Tailwind CSS + islas en JS/TS donde haga falta interactividad; adapter @astrojs/cloudflare |
| Backend | Node.js + Express + TypeScript |
| ORM / DB | Prisma + PostgreSQL en Neon (proyecto nuevo y exclusivo) |
| Validación | Zod (esquemas compartidos entre front y back) |
| Imágenes | Cloudinary (carpeta sol-y-luna/) |
| Pagos | Mercado Pago (modo marketplace con split) + Wompi (cuenta del cliente) + proveedor mock para demo |
| Emails | Resend (si no hay API key, se escriben al log) |
| Anti-bot | Cloudflare Turnstile (si no hay clave, se desactiva en dev/demo) |
| Errores | Sentry (opcional por variable de entorno) |
| Tests | Vitest + Supertest (API); Playwright para el flujo de compra principal |
| CI | GitHub Actions |
| Deploy | API en Railway; web en Cloudflare Pages |

## 2. Estructura del monorepo

```
sol_y_luna/
├── apps/
│   ├── web/          # Astro + Tailwind (tienda, cuenta, admin, operador)
│   └── api/          # Express + Prisma
├── packages/
│   └── shared/       # esquemas Zod, tipos, constantes, dataset DIVIPOLA, utilidades de dinero
├── docs/             # SPEC.md, DECISIONS.md, DEPLOY.md
├── .github/workflows/
├── CLAUDE.md
├── .env.example
└── pnpm-workspace.yaml
```

El dinero se maneja siempre en enteros de pesos COP, nunca con floats.

La API valida sus variables de entorno al arrancar con Zod. Si falta algo obligatorio, falla con un mensaje claro que dice qué variable es.

## 3. Branding y diseño (sacado del Instagram)

Paleta (tokens de Tailwind):

- luna (azul principal, botones, títulos): #1747B5
- sol (naranja acento, círculos detrás del producto, precio en oferta): #E9552E
- crema (fondo principal): #FBF5EA
- noche (texto principal): #0F2557

Más el blanco y escalas claras y oscuras de cada color. Verifica contraste AA.

Tipografía: Fraunces (serif pesada) para títulos, nombres de producto y precios; DM Sans para el cuerpo. Ambas de Google Fonts, autoalojadas con @fontsource.

Elementos visuales que hay que replicar:

- Producto sobre un círculo naranja con un anillo azul desplazado alrededor.
- Hojas y ramas folclóricas en azul y naranja en las esquinas, como SVG propios y originales.
- Chip de categoría arriba a la derecha (PARA ÉL, PARA ELLA, CUIDADO ÍNTIMO, ALIVIO, SKINCARE), en píldora azul con texto crema.
- Pastillas con borde azul para atributos ("84 cápsulas", "Uso tópico").
- CTA en píldora azul con flecha →.
- Dos variantes de tarjeta, que se alternan: fondo crema con círculo naranja, o fondo azul con bloque naranja.
- Las páginas de marca pueden tener tema propio. Ejemplo: la marca WILD (mentas y energía) usa estética oscura, graffiti y neón solo en su página.
- Logo: espacio para un SVG que entregará el cliente. Mientras tanto, un wordmark provisional "Sol y Luna" en Fraunces.

Experiencia:

- Mobile-first: casi todo el tráfico viene de Instagram desde el celular.
- Rápido: imágenes optimizadas vía Cloudinary con f_auto,q_auto y tamaños responsive.
- Accesible: navegación por teclado, labels y alt.
- Botón flotante de WhatsApp que lee PUBLIC_WHATSAPP_NUMBER. Si está vacío, no se muestra.

Mientras no haya fotos reales, usa imágenes placeholder con el estilo de la marca (SVG con círculo naranja y silueta de frasco). No uses imágenes de Instagram.

## 4. Roles y permisos

| Rol | Qué puede hacer |
| --- | --- |
| ADMIN (Kevin) | Todo: catálogo, usuarios, roles, pedidos, configuración, comisiones y liquidaciones, auditoría |
| OPERATOR (el cliente, que despacha desde su bodega) | Ver pedidos pagados, cambiar estado a preparando, despachado o entregado, cargar transportadora y número de guía, ajustar stock, ver sus liquidaciones. No puede ver ni editar la configuración de comisiones |
| CUSTOMER | Cuenta, carrito, checkout, historial, direcciones, lista de deseos, reseñas |
| Mayorista | Un CUSTOMER con wholesaleStatus = APPROVED. Lo aprueba el ADMIN |

Los permisos se verifican en el servidor: middleware de Express más middleware de Astro para las rutas /admin y /operador. Nunca se protege solo en el cliente.

## 5. Modelo de datos (Prisma) — mínimo esperado

- **User**: email único, passwordHash (argon2), nombre, teléfono, documento opcional, role, emailVerifiedAt, wholesaleStatus (NONE | PENDING | APPROVED | REJECTED), failedLoginCount, lockedUntil, timestamps.
- **RefreshToken**: hash del token, familyId, userId, expiresAt, revokedAt, replacedById, userAgent, IP.
- **EmailToken**: hash, tipo (VERIFY | RESET), expiresAt, usedAt.
- **Address**: userId, nombre del destinatario, teléfono, departmentCode, municipalityCode (DIVIPOLA), dirección, barrio, indicaciones, isDefault.
- **Category**: nombre, slug, descripción, imagen, parentId opcional (subcategorías), orden, activa. Al borrar una categoría con productos, los productos quedan sin categoría; nunca se borran en cascada.
- **Brand**: nombre, slug, logo, descripción, theme en JSON (para páginas de marca como WILD).
- **Product**: nombre, slug, descripción corta y larga, benefits (JSON con lista de viñetas), modo de uso, ingredientes, advertencias, categoryId opcional, brandId opcional, audience (HIM | HER | UNISEX), isAdult (+18), invimaStatus (REGISTERED | IN_PROCESS | NOT_REQUIRED | NOT_REGISTERED), invimaCode (obligatorio si es REGISTERED, validado con Zod), disclaimer, status (DRAFT | ACTIVE | ARCHIVED), featured, comisión opcional por producto, campos SEO, timestamps, soft delete (deletedAt).
- **ProductVariant**: productId, nombre de presentación ("60 cápsulas", "30 ml"), SKU único, retailPrice, compareAtPrice opcional, wholesalePrice opcional, wholesaleMinQty, stock, reservedStock, activo, peso opcional. Todo producto tiene al menos una presentación.
- **ProductImage**: productId, variantId opcional, cloudinaryPublicId (o la ruta local del placeholder), alt, orden.
- **Cart / CartItem**: carrito por usuario o por invitado (guestToken en cookie). Al iniciar sesión, el carrito de invitado se une con el del usuario.
- **WishlistItem**.
- **Review**: solo de compradores con pedido entregado. Calificación de 1 a 5, comentario y estado de moderación.
- **Coupon**: código, tipo (porcentaje o valor fijo), valor, mínimo de compra, usos máximos, usos por usuario, vigencia, activo, si aplica a mayoristas.
- **Order**: número legible (SYL-000123), userId, copia de la dirección y del contacto, priceTier (RETAIL | WHOLESALE), subtotal, descuento, envío (0, el envío es gratis), total, status, paymentProvider, notas, discreetPackaging, más los campos de comisión (sección 7).
- **OrderItem**: copia de nombre, SKU, presentación y precio unitario al momento de la compra; cantidad; total de la línea.
- **OrderStatusHistory**: estado anterior, estado nuevo, quién lo cambió, nota, fecha.
- **Shipment**: orderId, transportadora, número de guía, URL de seguimiento, fechas de despacho y entrega.
- **Payment**: orderId, provider, referencia externa, estado, monto, rawPayload (JSON), timestamps.
- **WebhookEvent**: provider, externalEventId único (para no procesar dos veces el mismo evento), payload, processedAt, error.
- **InventoryMovement**: variantId, delta, motivo (SALE | RESTOCK | ADJUSTMENT | RETURN | RESERVATION | RELEASE), referencia, usuario, fecha.
- **CommissionRule**: alcance (GLOBAL | CATEGORY | PRODUCT), referencia, priceTier opcional, porcentaje en puntos básicos (1000 = 10%), valor fijo por pedido, vigencia.
- **Settlement**: periodo desde y hasta, estado (OPEN | CLOSED | PAID), totales, notas, fecha de pago. Sus pedidos se relacionan con él.
- **StoreSettings**: un solo registro con nombre de la tienda, WhatsApp, emails, textos legales, banners del home y la frecuencia de liquidación.
- **AuditLog**: actor, acción, entidad, entityId, diff (JSON), IP, fecha.

Las transiciones válidas de estado del pedido son: PENDING_PAYMENT → PAID → PREPARING → SHIPPED → DELIVERED, y además CANCELLED, REFUNDED y PAYMENT_FAILED. Cualquier transición inválida se rechaza en el servidor.

## 6. Funcionalidades

### Tienda (público y cliente)

- Home: hero con branding, categorías destacadas, productos destacados, sección "Para él" / "Para ella", marcas, y un bloque de confianza (envío gratis, pago seguro, registro INVIMA).
- Catálogo: búsqueda por texto, filtros (categoría, audiencia, marca, rango de precio, "con registro INVIMA") y orden. Paginación con URLs que se pueden compartir.
- "Todos los productos", que incluye los productos sin categoría.
- Ficha de producto:
  - galería, selector de presentación, precio detal (y mayorista si aplica),
  - stock disponible, beneficios, modo de uso, ingredientes, advertencias,
  - sello INVIMA con el número cuando aplique, disclaimer ("Este producto es un suplemento dietario, no es un medicamento…"),
  - reseñas y productos relacionados.
- Productos +18: verificación de edad (modal con fecha de nacimiento, guardada en cookie) antes de mostrar el producto o la categoría. Las imágenes de esos productos se ven borrosas en los listados hasta confirmar la edad.
- Carrito: persistente, con validación de stock en tiempo real y aplicación de cupón.
- Checkout:
  - se puede comprar como invitado o con cuenta,
  - dirección con el selector en cascada de departamento y municipio (dataset DIVIPOLA completo del DANE en packages/shared),
  - opción de empaque discreto,
  - el resumen muestra "Envío gratis",
  - aceptación de términos y de tratamiento de datos,
  - elección de medio de pago.
- Páginas de resultado: pago aprobado, pendiente y rechazado.
- Mi cuenta: perfil, cambio de contraseña, direcciones, historial y detalle de pedidos con su seguimiento, lista de deseos, reseñas, y solicitud para volverse mayorista.
- Precio mayorista: se aplica solo si el usuario está aprobado y la cantidad de esa presentación es igual o mayor a wholesaleMinQty. Si no se cumple, se usa el precio detal. Siempre se calcula en el servidor.
- Páginas legales: términos y condiciones, política de privacidad y tratamiento de datos (Ley 1581 de 2012), derecho de retracto y garantías (Ley 1480 de 2011), política de envíos y de devoluciones. Todos los textos se editan desde el admin.
- SEO: metadatos, Open Graph, sitemap, robots, datos estructurados Product, y URLs con slug.

### Panel ADMIN (/admin)

- Dashboard: ventas del periodo, número de pedidos, ticket promedio, productos más vendidos, stock bajo y comisión acumulada.
- CRUD completo (crear, ver, editar, borrar o archivar, buscar, filtrar) de: productos (con presentaciones e imágenes), categorías (con subcategorías y orden), marcas, cupones, usuarios (incluido cambio de rol), reseñas (moderación) y pedidos.
- Formulario de producto:
  - categoría opcional,
  - selector de estado INVIMA; si se elige REGISTERED, se pide el número de registro,
  - interruptor de producto +18,
  - editor de beneficios como lista,
  - varias presentaciones,
  - subida de varias imágenes con orden por arrastre.
- Aprobación y rechazo de solicitudes de mayorista.
- Configuración de comisiones y liquidaciones (sección 7).
- Configuración de la tienda (StoreSettings).
- Visor del log de auditoría.

### Panel OPERATOR (/operador)

- Lista de pedidos por preparar y despachar, con filtros.
- Detalle del pedido con dirección y empaque discreto, cambio de estado, y registro de transportadora y número de guía.
- Ajuste de stock con motivo.
- Consulta de sus liquidaciones: ventas brutas, comisión de la plataforma y neto.

### Emails transaccionales

Verificación de cuenta, recuperación de contraseña, pedido recibido, pago confirmado, pedido despachado (con la guía) y respuesta a la solicitud de mayorista. Plantillas HTML con el branding.

## 7. Pagos y comisión de la plataforma

### Comisión

- La comisión de la plataforma (Kevin) es del 10% por pedido y se configura desde el admin.
- La regla que aplica es la más específica: primero PRODUCT, luego CATEGORY, luego GLOBAL. Pueden existir reglas distintas para RETAIL y WHOLESALE; por ahora ambas valen 10%. También hay un valor fijo por pedido opcional, que por defecto es 0.
- Base del cálculo: subtotal de productos menos descuentos. No incluye el envío ni la comisión de la pasarela. La comisión de la pasarela la asume el comercio (el cliente).
- Cada pedido guarda: commissionRateBps, commissionFixed, commissionAmount, gatewayFeeAmount (si la pasarela la reporta), merchantNetAmount, y la referencia a la regla aplicada. Así, cambiar el porcentaje después no altera pedidos viejos.
- Si el pedido se reembolsa completo, la comisión se reversa. Si el reembolso es parcial, se recalcula de forma proporcional.
- Liquidaciones: se generan por periodo (quincenal o mensual, configurable) con los pedidos PAID o posteriores. Se pueden cerrar, marcar como pagadas y exportar a CSV.

### Proveedores (patrón adaptador, una interfaz común PaymentProvider)

- **mock** (por defecto cuando faltan credenciales, o con PAYMENTS_MODE=demo): una página de pago simulada donde se elige "aprobar", "rechazar" o "dejar pendiente". Dispara el mismo flujo interno que un webhook real.
- **Mercado Pago, modo marketplace (split)**:
  - La aplicación de Mercado Pago es la de Kevin (integrador). El comercio conecta su cuenta por OAuth desde el panel admin, y el token se guarda cifrado (AES-256-GCM con ENCRYPTION_KEY) y se renueva solo.
  - Las preferencias de Checkout Pro se crean con el token del comercio y con marketplace_fee igual a la comisión calculada.
  - Con MP_MODE=direct hay un modo alterno sin split, para pruebas.
- **Wompi (cuenta del cliente)**:
  - Widget o web checkout con la firma de integridad (SHA256 de referencia + monto en centavos + moneda + secreto de integridad).
  - El dinero entra a la cuenta del cliente. La comisión se registra en el pedido y se cobra después, vía liquidación.

### Webhooks (crítico)

- Wompi: verificar signature.checksum calculando el SHA256 de los valores de signature.properties concatenados en orden, más timestamp, más WOMPI_EVENTS_SECRET. La comparación es en tiempo constante.
- Mercado Pago: verificar el header x-signature (ts y v1) con HMAC-SHA256 sobre el manifiesto `id:{data.id};request-id:{x-request-id};ts:{ts};` usando MP_WEBHOOK_SECRET. Después se consulta el pago en la API de Mercado Pago para confirmar su estado real; nunca se confía solo en el body.
- Idempotencia: se guarda cada evento en WebhookEvent con id único. Un evento repetido responde 200 sin volver a procesarse.
- Cuando un pago queda aprobado, en una sola transacción de Prisma: el pedido pasa a PAID, se descuenta el stock, se libera la reserva, se crean los InventoryMovement, se calcula y fija la comisión, y se escribe el OrderStatusHistory. Luego se envía el email.
- Al crear el pedido, el stock se reserva con expiración (30 minutos). Un job programado libera las reservas vencidas y cancela los pedidos sin pagar.
- El monto pagado debe coincidir con el total del pedido; si no coincide, el pedido se marca para revisión y no se aprueba.

## 8. Seguridad (obligatorio)

### Autenticación

- Access token JWT de 15 minutos, firmado con JWT_ACCESS_SECRET, con iss, aud, sub, role y jti.
- Refresh token opaco y aleatorio que se guarda hasheado, dura 7 días, y viaja en una cookie httpOnly, Secure, SameSite=Lax y Path=/api/auth.
- Rotación en cada uso con detección de reutilización: si llega un refresh token ya rotado, se revoca toda su familia (todas las sesiones de ese login).
- Contraseñas con argon2id y una política mínima razonable.
- Bloqueo temporal de la cuenta tras 5 intentos fallidos. Los mensajes de error son genéricos, para no revelar si el email existe.
- Verificación de email, y recuperación de contraseña con token de un solo uso, hasheado y de 30 minutos. Al cambiar la contraseña se revocan todas las sesiones.

### API

- helmet, CORS con lista de orígenes permitidos (CORS_ORIGINS), express-rate-limit en auth, checkout, reseñas y webhooks, límite de tamaño del body, y trust proxy configurado para Railway.
- Validación Zod en params, query y body de todos los endpoints, con mensajes en español.
- Nunca se aceptan precios, totales, descuentos ni comisiones desde el cliente: todo se recalcula en el servidor.
- Protección contra acceso a recursos ajenos (IDOR): un usuario solo ve sus propios pedidos, direcciones y carrito.
- Turnstile en registro, login, recuperación de contraseña y checkout de invitado.
- Subida de imágenes: solo ADMIN y OPERATOR, con firma de Cloudinary generada en el servidor, validación de tipo MIME y tamaño máximo de 5 MB.
- Manejo de errores centralizado: sin stack traces en producción y con un id de request para rastrear.
- Logs estructurados con pino, sin datos sensibles (contraseñas, tokens, números de documento).
- Log de auditoría para todos los cambios de precio, stock, rol, comisión y estado de pedido.

### Frontend: patrón BFF (reenvío por el mismo dominio)

- Mientras no haya dominio, la web vive en *.pages.dev y la API en *.up.railway.app. Son sitios distintos y los navegadores bloquean las cookies entre ellos.
- Por eso Astro expone /api/[...path], que reenvía las peticiones a la API (API_INTERNAL_URL) pasando las cookies. El navegador solo habla con su mismo dominio.
- Las cookies quedan de primera parte. Esto debe seguir funcionando igual cuando se ponga un dominio propio.
- Cabeceras de seguridad en la web: CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- El access token vive solo en memoria. Nunca en localStorage.

### Dependencias

pnpm audit --audit-level=high en CI, con lockfile comprometido en el repo.

## 9. Variables de entorno y modo demo

.env.example debe estar completo, comentado y dividido en tres archivos: raíz, apps/api y apps/web. Solo las variables públicas llevan el prefijo PUBLIC_.

Comportamiento cuando falta una credencial:

- Sin credenciales de pago → proveedor mock, con un banner discreto "Modo demo" en el checkout.
- Sin Cloudinary → imágenes placeholder locales y la subida queda deshabilitada con un mensaje claro.
- Sin Resend → los emails se escriben en el log.
- Sin Turnstile → se omite fuera de producción. En producción es obligatorio.
- Sin WhatsApp → el botón flotante no aparece.

Variables mínimas: DATABASE_URL, DIRECT_URL, JWT_ACCESS_SECRET, REFRESH_TOKEN_PEPPER, ENCRYPTION_KEY, CORS_ORIGINS, WEB_URL, API_URL, API_INTERNAL_URL, PAYMENTS_MODE, MP_MODE, MP_CLIENT_ID, MP_CLIENT_SECRET, MP_ACCESS_TOKEN, MP_PUBLIC_KEY, MP_WEBHOOK_SECRET, MP_REDIRECT_URI, WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET, WOMPI_ENV, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_FOLDER=sol-y-luna, RESEND_API_KEY, EMAIL_FROM, TURNSTILE_SECRET_KEY, PUBLIC_TURNSTILE_SITE_KEY, PUBLIC_WHATSAPP_NUMBER, SENTRY_DSN, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, OPERATOR_SEED_EMAIL, OPERATOR_SEED_PASSWORD.

Datos de ejemplo (pnpm db:seed), idempotentes:

- Usuarios: un admin y un operador (desde las variables de entorno), dos clientes de prueba, uno de ellos mayorista aprobado.
- Categorías: Bienestar y defensas, Para él, Para ella, Cuidado íntimo, Potenciadores (+18), Alivio y neuropatía, Skincare, Energía, Hogar y carro.
- Marcas: WILD, Old School, FlujoVital, True Fem y Perky.
- Productos (precios de ejemplo realistas en COP, con estados INVIMA variados y al menos uno sin categoría): Turkesterone con Tongkat Ali (120 cápsulas), Muscle Complex 185 (84 cápsulas), Spray Dictamni, Aceite Hip Lift Up 30 ml, Aceite Perky 30 ml, True Fem 60 cápsulas, Crema Neuropatía 120 g, Allicarp Neuropatía 30 cápsulas, Sérum facial rejuvenecedor 30 ml, Smoothing Solution vellos encarnados 50 ml, Saúco Negro con Vitamina C y Zinc 60 cápsulas, Blood Sugar Complex, WILD mentas energía (3 sabores como presentaciones), Interior Detailer para carro, y un producto de ejemplo marcado +18.
- Una regla de comisión global del 10%, un cupón de ejemplo y algunos pedidos de ejemplo en distintos estados.

## 10. CI/CD y despliegue

GitHub Actions (en cada PR y en cada push a main), con jobs paralelos para api y web:

- install con caché de pnpm,
- lint, typecheck, tests y build,
- prisma validate,
- pnpm audit.

Railway (API):

- Servicio desde apps/api, conectado al repo con autodeploy en main.
- prisma migrate deploy en el pre-deploy.
- Healthcheck en GET /health, que también comprueba la conexión a la base de datos.
- Las tareas programadas (liberar reservas vencidas) corren con un scheduler dentro del proceso, protegido contra ejecuciones simultáneas.

Cloudflare Pages (web):

- Build de apps/web con el adapter de Cloudflare y las variables configuradas en Pages.

Escribe docs/DEPLOY.md con el paso a paso exacto para Neon, Railway, Cloudflare Pages, Cloudinary, Mercado Pago (crear la app, OAuth, URL del webhook), Wompi (llaves y URL de eventos), Resend y Turnstile. Incluye también la checklist para pasar de demo a producción.

## 11. Fases (detente al final de cada una)

| Fase | Entregable | Criterio de aceptación |
| --- | --- | --- |
| 0. Base | Monorepo con pnpm, TypeScript, ESLint y Prettier, Tailwind con los tokens de marca, CLAUDE.md, docs/SPEC.md, .env.example, validación de env, CI | pnpm install, pnpm dev, pnpm lint y pnpm build funcionan; el CI pasa |
| 1. Datos | Esquema Prisma completo, migración inicial, seed y dataset DIVIPOLA | pnpm db:migrate y pnpm db:seed corren contra Neon sin errores |
| 2. Auth y seguridad | Registro, login, refresh con rotación, logout, verificación, recuperación, middleware de roles, rate limit, helmet, Turnstile, BFF en Astro | Tests de auth: rotación, reutilización de token, bloqueo de cuenta, IDOR |
| 3. Catálogo y admin | API de catálogo con filtros; CRUD de productos, presentaciones, categorías (y productos sin categoría), marcas, cupones y usuarios; subida a Cloudinary; auditoría | Desde /admin se crea, edita y borra todo; los tests pasan |
| 4. Tienda | Home, catálogo, ficha de producto, marcas, verificación +18, páginas legales, SEO y WhatsApp, con el branding completo | Lighthouse en móvil ≥ 90 en rendimiento y accesibilidad en home y ficha |
| 5. Compra | Carrito (invitado y usuario, con unión al iniciar sesión), checkout con DIVIPOLA, pedidos, reservas de stock, proveedores mock, Mercado Pago y Wompi, webhooks verificados e idempotentes | Test de Playwright de la compra completa en modo demo; tests de webhooks con firmas válidas e inválidas |
| 6. Negocio | Comisiones, liquidaciones con exportación CSV, panel del operador, despacho con guía, emails transaccionales | La comisión del 10% se calcula y queda fija en cada pedido; la liquidación cuadra al peso |
| 7. Cuenta | Historial, seguimiento, direcciones, lista de deseos, reseñas verificadas, solicitud y aprobación de mayorista con precios por cantidad | Un mayorista aprobado ve y paga el precio mayorista solo si cumple la cantidad mínima |
| 8. Despliegue | docs/DEPLOY.md, API en Railway, web en Cloudflare Pages, seed en producción en modo demo, prueba completa | URL pública navegable para presentar al cliente, con compra de punta a punta en modo demo |
