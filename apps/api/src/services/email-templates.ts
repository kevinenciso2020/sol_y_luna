/**
 * Branded transactional templates: account, orders, payments, shipments and wholesale responses.
 * Every user-supplied value goes through escapeHtml.
 */
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

function layout(title: string, bodyHtml: string) {
  return `<!doctype html>
<html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#fbf5ea;font-family:Arial,Helvetica,sans-serif;color:#0f2557">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf5ea;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px;padding:32px">
        <tr><td style="font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#1747b5;padding-bottom:16px">Sol <span style="color:#c9411d">y</span> Luna</td></tr>
        <tr><td style="font-size:16px;line-height:1.6">${bodyHtml}</td></tr>
        <tr><td style="padding-top:24px;font-size:12px;color:#34508b">Sol y Luna Store · Colombia. Si no solicitaste este correo, puedes ignorarlo.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#1747b5;color:#fbf5ea;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`;
}

export function verifyEmailTemplate(input: { name: string; link: string }) {
  const subject = 'Confirma tu correo en Sol y Luna';
  const html = layout(
    subject,
    `<p>Hola, ${escapeHtml(input.name)}.</p><p>Confirma tu correo para terminar de crear tu cuenta. El enlace vence en 24 horas.</p>${button(input.link, 'Confirmar correo')}<p style="font-size:13px">Si el botón no funciona, copia este enlace: ${escapeHtml(input.link)}</p>`,
  );
  const text = `Hola, ${input.name}. Confirma tu correo (vence en 24 horas): ${input.link}`;
  return { subject, html, text };
}

export function accountExistsTemplate(input: {
  name: string;
  loginLink: string;
  resetLink: string;
}) {
  const subject = 'Ya tienes una cuenta en Sol y Luna';
  const html = layout(
    subject,
    `<p>Hola, ${escapeHtml(input.name)}.</p><p>Alguien intentó crear una cuenta con este correo, pero ya tienes una. Puedes ingresar o, si no recuerdas tu contraseña, crear una nueva.</p>${button(input.loginLink, 'Ingresar')}<p><a href="${escapeHtml(input.resetLink)}" style="color:#1747b5">Crear una nueva contraseña</a></p>`,
  );
  const text = `Ya tienes una cuenta en Sol y Luna. Ingresa: ${input.loginLink} · Nueva contraseña: ${input.resetLink}`;
  return { subject, html, text };
}

export function resetPasswordTemplate(input: { name: string; link: string }) {
  const subject = 'Crea una nueva contraseña';
  const html = layout(
    subject,
    `<p>Hola, ${escapeHtml(input.name)}.</p><p>Recibimos una solicitud para cambiar tu contraseña. El enlace sirve una sola vez y vence en 30 minutos.</p>${button(input.link, 'Crear nueva contraseña')}<p style="font-size:13px">Si no fuiste tú, ignora este correo: tu contraseña sigue igual.</p>`,
  );
  const text = `Crea una nueva contraseña (vence en 30 minutos, un solo uso): ${input.link}`;
  return { subject, html, text };
}

export function passwordChangedTemplate(input: { name: string }) {
  const subject = 'Tu contraseña cambió';
  const html = layout(
    subject,
    `<p>Hola, ${escapeHtml(input.name)}.</p><p>La contraseña de tu cuenta cambió y cerramos tus sesiones abiertas. Si no fuiste tú, recupera tu cuenta de inmediato desde "¿Olvidaste tu contraseña?".</p>`,
  );
  const text = `La contraseña de tu cuenta de Sol y Luna cambió y cerramos tus sesiones. Si no fuiste tú, recupérala de inmediato.`;
  return { subject, html, text };
}

interface OrderEmailData {
  number: string;
  customerName: string;
  subtotal: number;
  discount: number;
  total: number;
  discreetPackaging: boolean;
  items: { productName: string; variantName: string; quantity: number; lineTotal: number }[];
  shipping: {
    recipientName: string;
    addressLine: string;
    municipality: string;
    department: string;
  };
}

const cop = (n: number) => `$${n.toLocaleString('es-CO')}`;

function orderTable(order: OrderEmailData) {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0">${escapeHtml(i.productName)} · ${escapeHtml(i.variantName)} × ${i.quantity}</td><td style="padding:6px 0;text-align:right">${cop(i.lineTotal)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:15px">${rows}
<tr><td style="padding-top:10px;border-top:1px solid #d9e3f8">Subtotal</td><td style="padding-top:10px;border-top:1px solid #d9e3f8;text-align:right">${cop(order.subtotal)}</td></tr>
${order.discount ? `<tr><td>Descuento</td><td style="text-align:right">-${cop(order.discount)}</td></tr>` : ''}
<tr><td>Envío</td><td style="text-align:right">Gratis</td></tr>
<tr><td style="font-weight:bold;font-size:17px">Total</td><td style="font-weight:bold;font-size:17px;text-align:right">${cop(order.total)}</td></tr></table>
<p style="font-size:14px;margin-top:16px">Entrega a ${escapeHtml(order.shipping.recipientName)}: ${escapeHtml(order.shipping.addressLine)}, ${escapeHtml(order.shipping.municipality)} (${escapeHtml(order.shipping.department)}).${order.discreetPackaging ? ' Con empaque discreto.' : ''}</p>`;
}

const orderText = (order: OrderEmailData) =>
  `${order.items.map((i) => `- ${i.productName} · ${i.variantName} x${i.quantity}: ${cop(i.lineTotal)}`).join('\n')}\nTotal: ${cop(order.total)} (envío gratis)`;

export function orderReceivedTemplate(input: { order: OrderEmailData; link: string }) {
  const subject = `Recibimos tu pedido ${input.order.number}`;
  const html = layout(
    subject,
    `<p>Hola, ${escapeHtml(input.order.customerName)}.</p><p>Recibimos tu pedido <strong>${input.order.number}</strong>. Apartamos los productos por 30 minutos mientras se confirma el pago.</p>${orderTable(input.order)}`,
  );
  const text = `Recibimos tu pedido ${input.order.number}. Apartamos los productos por 30 minutos mientras se confirma el pago.\n${orderText(input.order)}`;
  return { subject, html, text };
}

export function orderPaidTemplate(input: { order: OrderEmailData }) {
  const subject = `Pago confirmado: pedido ${input.order.number}`;
  const html = layout(
    subject,
    `<p>Hola, ${escapeHtml(input.order.customerName)}.</p><p>Confirmamos el pago de tu pedido <strong>${input.order.number}</strong>. Lo preparamos y te avisamos con la guía cuando salga.</p>${orderTable(input.order)}`,
  );
  const text = `Confirmamos el pago de tu pedido ${input.order.number}. Te avisamos con la guía cuando salga.\n${orderText(input.order)}`;
  return { subject, html, text };
}

export function orderShippedTemplate(input: {
  order: OrderEmailData;
  shipment: { carrier: string; trackingNumber: string; trackingUrl: string | null };
}) {
  const { order, shipment } = input;
  const subject = `Tu pedido ${order.number} va en camino`;
  const html = layout(
    subject,
    `<p>Hola, ${escapeHtml(order.customerName)}.</p><p>Tu pedido <strong>${order.number}</strong> ya salió de nuestra bodega.</p>
<p style="background:#fbf5ea;border-radius:16px;padding:16px">Transportadora: <strong>${escapeHtml(shipment.carrier)}</strong><br>Número de guía: <strong>${escapeHtml(shipment.trackingNumber)}</strong></p>
${shipment.trackingUrl ? button(shipment.trackingUrl, 'Seguir mi envío') : ''}${orderTable(order)}`,
  );
  const text = `Tu pedido ${order.number} va en camino. Transportadora: ${shipment.carrier}. Guía: ${shipment.trackingNumber}.${shipment.trackingUrl ? ` Seguimiento: ${shipment.trackingUrl}` : ''}\n${orderText(order)}`;
  return { subject, html, text };
}

export function wholesaleResponseTemplate(input: {
  name: string;
  approved: boolean;
  link: string;
}) {
  const subject = input.approved
    ? 'Tu cuenta mayorista fue aprobada'
    : 'Respuesta a tu solicitud de cuenta mayorista';
  const body = input.approved
    ? `<p>Hola, ${escapeHtml(input.name)}.</p><p>Aprobamos tu cuenta mayorista. Desde ahora ves el precio mayorista en los productos que lo tienen, y se aplica al comprar la cantidad mínima de cada presentación.</p>${button(input.link, 'Ver productos')}`
    : `<p>Hola, ${escapeHtml(input.name)}.</p><p>Revisamos tu solicitud de cuenta mayorista y por ahora no podemos aprobarla. Puedes seguir comprando con precio detal y, si tienes preguntas, escríbenos.</p>`;
  const text = input.approved
    ? `Aprobamos tu cuenta mayorista. Ver productos: ${input.link}`
    : 'Revisamos tu solicitud de cuenta mayorista y por ahora no podemos aprobarla.';
  return { subject, html: layout(subject, body), text };
}
