// Notificaciones tras confirmar una reserva (pagada o pendiente de efectivo).
// Best-effort: NUNCA lanzan error hacia arriba; si algo falla se registra en
// consola (visible en logs de Vercel) y la reserva sigue confirmada.
// - Email vía Resend (REST, sin SDK): cliente + agencia.
// - WhatsApp a la agencia vía Cloud API (plantilla 'nueva_reserva').
const { supa } = require('./supabase.js');

const ETIQUETA_ESTADO = {
  es: { pagada: 'Pagada', pendiente_efectivo: 'Pendiente de pago en efectivo', firmada: 'Firmada' },
  en: { pagada: 'Paid', pendiente_efectivo: 'Cash payment pending', firmada: 'Signed' }
};
const ZONA_NOMBRE = { pdc: 'Playa del Carmen', rm: 'Riviera Maya', cun: 'Cancún' };

function urlCupon(r) {
  const base = process.env.SITE_URL || 'https://www.walkmetours.com';
  const pagina = r.idioma === 'en' ? 'gracias-en.html' : 'gracias.html';
  return `${base}/${pagina}?codigo=${encodeURIComponent(r.codigo)}`;
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
      from: 'WalkMe Tours <reservas@walkmetours.com>',
      to: destinatarios,
      subject: asunto,
      html
    })
  });
  if (!resp.ok) console.error('Resend fallo:', resp.status, await resp.text());
}

function filaHtml(l, v) {
  return `<tr><td style="padding:6px 12px 6px 0;color:#777;">${l}</td><td style="padding:6px 0;font-weight:bold;color:#0d2e1a;">${v}</td></tr>`;
}

function resumenHtml(r, lang) {
  const t = lang === 'en'
    ? { tour: 'Experience', fecha: 'Date', pax: 'Guests', zona: 'Departure', total: 'Total', estado: 'Status', cod: 'Booking code' }
    : { tour: 'Experiencia', fecha: 'Fecha', pax: 'Personas', zona: 'Salida', total: 'Total', estado: 'Estado', cod: 'Código de reserva' };
  return `<table style="border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:14px;">
    ${filaHtml(t.cod, r.codigo)}
    ${filaHtml(t.tour, r.tour_nombre)}
    ${filaHtml(t.fecha, r.fecha_tour)}
    ${filaHtml(t.pax, `${r.adultos} + ${r.menores}`)}
    ${filaHtml(t.zona, ZONA_NOMBRE[r.zona] || r.zona)}
    ${filaHtml(t.total, `$${Number(r.total).toLocaleString('es-MX')} ${r.moneda}`)}
    ${filaHtml(t.estado, (ETIQUETA_ESTADO[lang] || ETIQUETA_ESTADO.es)[r.estado] || r.estado)}
  </table>`;
}

async function emailCliente(r) {
  const lang = r.idioma === 'en' ? 'en' : 'es';
  const asunto = lang === 'en'
    ? `Your WalkMe Tours booking ${r.codigo}`
    : `Tu reserva WalkMe Tours ${r.codigo}`;
  const intro = lang === 'en'
    ? `<p>Hi ${r.nombre_completo},</p><p>Here is your booking confirmation. Show this code (or the voucher link) on the day of your tour:</p>`
    : `<p>Hola ${r.nombre_completo},</p><p>Aquí está la confirmación de tu reserva. Muestra este código (o el enlace de tu cupón) el día de tu tour:</p>`;
  const nota = r.estado === 'pendiente_efectivo'
    ? (lang === 'en'
        ? `<p style="color:#a66a00;"><strong>Payment pending:</strong> you chose to pay in cash. Your spot is held; payment is due in person before the tour.</p>`
        : `<p style="color:#a66a00;"><strong>Pago pendiente:</strong> elegiste pagar en efectivo. Tu lugar queda apartado; el pago se realiza en persona antes del tour.</p>`)
    : '';
  const html = `${intro}
    <p style="font-size:26px;font-weight:bold;letter-spacing:2px;color:#0d2e1a;">${r.codigo}</p>
    ${resumenHtml(r, lang)}
    ${nota}
    <p><a href="${urlCupon(r)}" style="color:#D4821A;">${lang === 'en' ? 'View my voucher' : 'Ver mi cupón'}</a></p>
    <p style="color:#777;font-size:12px;">WalkMe Tours · Playa del Carmen · WhatsApp +52 56 3974 8122</p>`;
  await emailResend([r.email], asunto, html);
}

async function emailAgencia(r) {
  const dest = process.env.AGENCIA_EMAIL || 'walkmetravel@gmail.com';
  // Enlaces temporales (1h) a los documentos, solo para la agencia.
  let docsHtml = '';
  try {
    const s = supa();
    const links = [];
    for (const [etq, path] of [['ID', r.id_foto_path], ['Hospedaje', r.hospedaje_path], ['Firma', r.firma_path]]) {
      if (!path) continue;
      const { data } = await s.storage.from('documentos').createSignedUrl(path, 3600);
      if (data && data.signedUrl) links.push(`<a href="${data.signedUrl}">${etq}</a>`);
    }
    if (links.length) docsHtml = `<p>Documentos (enlaces válidos 1 hora): ${links.join(' · ')}</p>`;
  } catch (e) { console.error('Signed URLs fallo:', e.message); }

  const html = `<p>Nueva reserva <strong>${r.codigo}</strong> (${(ETIQUETA_ESTADO.es)[r.estado] || r.estado}).</p>
    ${resumenHtml(r, 'es')}
    <p>Cliente: ${r.nombre_completo} · ${r.email} · ${r.telefono}<br>Hotel: ${r.hotel || '-'}</p>
    ${docsHtml}
    <p><a href="${urlCupon(r)}">Cupón</a></p>`;
  await emailResend([dest], `Reserva ${r.codigo} · ${r.tour_nombre} · ${r.fecha_tour}`, html);
}

async function whatsAppAgencia(r) {
  const token = process.env.WA_TOKEN, phoneId = process.env.WA_PHONE_ID;
  const destino = process.env.AGENCIA_WA || '525639748122';
  if (!token || !phoneId) return; // fase 8: se activa al configurar la API
  const resp = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destino,
      type: 'template',
      template: {
        name: 'nueva_reserva',
        language: { code: 'es_MX' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: r.codigo },
            { type: 'text', text: r.tour_nombre },
            { type: 'text', text: String(r.fecha_tour) },
            { type: 'text', text: `${r.adultos}+${r.menores}` },
            { type: 'text', text: `${Number(r.total).toLocaleString('es-MX')} ${r.moneda}` },
            { type: 'text', text: (ETIQUETA_ESTADO.es)[r.estado] || r.estado }
          ]
        }]
      }
    })
  });
  if (!resp.ok) console.error('WhatsApp fallo:', resp.status, await resp.text());
}

// Punto de entrada único. r = fila completa de la reserva.
async function notificarConfirmacion(r) {
  const tareas = [
    emailCliente(r).catch(e => console.error('emailCliente:', e.message)),
    emailAgencia(r).catch(e => console.error('emailAgencia:', e.message)),
    whatsAppAgencia(r).catch(e => console.error('whatsAppAgencia:', e.message))
  ];
  await Promise.allSettled(tareas);
}

module.exports = { notificarConfirmacion };
