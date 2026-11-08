/**
 * Minimal branded transactional templates. Phase 6 extends this set
 * (orders, payments, shipments, wholesale responses).
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
