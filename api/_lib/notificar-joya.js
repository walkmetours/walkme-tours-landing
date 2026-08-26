// Notificaciones de reservas JOYÀ (Cirque du Soleil). Calcado de
// notificar-bici.js: best-effort, NUNCA lanza error hacia arriba.
// - Email vía Resend (REST, sin SDK): cliente + agencia.
// - WhatsApp a la agencia vía Cloud API (plantilla WA_TEMPLATE_JOYA).
// Sin pasarela de pago integrada: el mensaje siempre deja claro que el
// equipo manda el link de pago después de confirmar disponibilidad.

const DIRECCION = 'WalkMe Tours · 5ta Avenida entre Calle 10 y Calle 12, frente a Sala de Despecho, Playa del Carmen';
const WHATSAPP_PUBLICO = '+52 56 3974 8122';

function urlCupon(r) {
  const base = process.env.SITE_URL || 'https://www.walkmetours.com';
  const pagina = r.idioma === 'en' ? 'cupon-joya-en.html' : 'cupon-joya.html';
  return `${base}/${pagina}?t=${encodeURIComponent(r.token)}`;
}

function pesos(n) {
  return `$${Number(n || 0).toLocaleString('es-MX')} MXN`;
}

async function emailResend(destinatarios, asunto, html) {
  if (!process.env.RESEND_API_KEY) return;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'WalkMe Tours <reservas@walkmetours.com>',
      to: destinatarios,
      subject: asunto,
      html
    })
  });
  if (!resp.ok) console.error('notificar-joya: Resend fallo:', resp.status, await resp.text());
}

function filaHtml(l, v) {
  return `<tr><td style="padding:6px 14px 6px 0;color:#6b6f66;">${l}</td><td style="padding:6px 0;font-weight:bold;color:#0D2E1A;">${v}</td></tr>`;
}

function resumenHtml(r, lang) {
  const t = lang === 'en'
    ? { folio: 'Booking', experiencia: 'Experience', fecha: 'Date and show', personas: 'Guests', total: 'Estimated total' }
    : { folio: 'Folio', experiencia: 'Experiencia', fecha: 'Fecha y función', personas: 'Personas', total: 'Total estimado' };
  const paxTxt = `${r.adultos} ${lang === 'en' ? 'adult' + (r.adultos === 1 ? '' : 's') : 'adulto' + (r.adultos === 1 ? '' : 's')}` +
    (r.ninos ? ` · ${r.ninos} ${lang === 'en' ? 'child' + (r.ninos === 1 ? '' : 'ren') : 'niño' + (r.ninos === 1 ? '' : 's')}` : '');
  return `<table style="border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:14px;">
    ${filaHtml(t.folio, `WJ-${r.folio}`)}
    ${filaHtml(t.experiencia, `${r.tier_nombre} · ${r.seccion}`)}
    ${filaHtml(t.fecha, `${r.fecha_funcion} · ${r.horario}`)}
    ${filaHtml(t.personas, paxTxt)}
    ${filaHtml(t.total, pesos(r.total))}
  </table>`;
}

async function emailCliente(r, evento) {
  if (!r.email) return;
  const lang = r.idioma === 'en' ? 'en' : 'es';
  const asunto = lang === 'en'
    ? `Your JOYÀ booking request · WJ-${r.folio}`
    : `Tu solicitud de reserva JOYÀ · WJ-${r.folio}`;
  const saludo = lang === 'en' ? `Hi ${r.nombre_completo},` : `Hola ${r.nombre_completo},`;
  const linea = lang === 'en'
    ? 'We received your booking request. We are confirming availability and will send you a secure payment link shortly.'
    : 'Recibimos tu solicitud de reserva. Estamos confirmando disponibilidad y en breve te mandamos un link de pago seguro.';
  const botonTxt = lang === 'en' ? 'View my voucher' : 'Ver mi cupón';

  const html = `
  <div style="background:#f7f0dd;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#0D2E1A;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="font-size:18px;font-weight:bold;margin:0 0 4px;">JOYÀ · Cirque du Soleil</p>
      <p style="margin:0 0 16px;">${saludo}</p>
      <p style="font-size:15px;color:#0D2E1A;margin:0 0 20px;">${linea}</p>
      ${resumenHtml(r, lang)}
      <p style="margin:24px 0;">
        <a href="${urlCupon(r)}" style="display:inline-block;background:#F2DE4A;color:#0D2E1A;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;">${botonTxt}</a>
      </p>
      <p style="color:#6b6f66;font-size:13px;line-height:1.5;margin:0;">
        ${DIRECCION}<br>WhatsApp ${WHATSAPP_PUBLICO}
      </p>
    </div>
  </div>`;
  await emailResend([r.email], asunto, html);
}

async function emailAgencia(r) {
  const dest = process.env.AGENCIA_EMAIL;
  if (!dest) return;
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#0D2E1A;">
    <p>Nueva solicitud de reserva JOYÀ <strong>WJ-${r.folio}</strong>.</p>
    ${resumenHtml(r, 'es')}
    <p>Cliente: ${r.nombre_completo} · ${r.telefono || '-'} · ${r.email || '-'}<br>
    Transporte: ${r.transporte_id === 'no' ? 'No incluido' : r.transporte_id}<br>
    Hotel: ${r.hotel || '-'}<br>
    ${r.notas ? 'Notas: ' + r.notas + '<br>' : ''}
    Canal: ${r.canal || '-'}</p>
    <p><a href="${urlCupon(r)}">Cupón</a></p>
  </div>`;
  await emailResend([dest], `Nueva reserva JOYÀ WJ-${r.folio}`, html);
}

async function whatsAppAgencia(r) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  const destino = process.env.AGENCIA_WA;
  if (!token || !phoneId || !destino) return;
  const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destino,
      type: 'template',
      template: {
        name: process.env.WA_TEMPLATE_JOYA || 'nueva_reserva_joya',
        language: { code: 'es_MX' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: `WJ-${r.folio}` },
            { type: 'text', text: String(r.nombre_completo || '') },
            { type: 'text', text: `${r.tier_nombre || ''}` },
            { type: 'text', text: String(r.fecha_funcion || '') },
            { type: 'text', text: String(r.horario || '') },
            { type: 'text', text: `${r.adultos}A${r.ninos ? '+' + r.ninos + 'N' : ''}` },
            { type: 'text', text: pesos(r.total) }
          ]
        }]
      }
    })
  });
  if (!resp.ok) console.error('notificar-joya: WhatsApp fallo:', resp.status, await resp.text());
}

// Punto de entrada único. r = fila completa de reservas_joya.
async function notificarReservaJoya(r, evento) {
  try {
    if (!r) return;
    await Promise.allSettled([
      emailCliente(r, evento).catch(e => console.error('notificar-joya: emailCliente:', e.message)),
      emailAgencia(r).catch(e => console.error('notificar-joya: emailAgencia:', e.message)),
      whatsAppAgencia(r).catch(e => console.error('notificar-joya: whatsAppAgencia:', e.message))
    ]);
  } catch (e) {
    console.error('notificar-joya:', e && e.message);
  }
}

module.exports = { notificarReservaJoya };
