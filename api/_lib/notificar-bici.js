// Notificaciones de reservas de bicis (WalkMe Bikes).
// Best-effort: NUNCA lanza error hacia arriba; si algo falla se registra en
// consola (visible en logs de Vercel) y la reserva sigue igual de firme.
// - Email vía Resend (REST, sin SDK): cliente + agencia.
// - WhatsApp a la agencia vía Cloud API (plantilla WA_TEMPLATE_BICI).
// evento: 'pendiente_efectivo' | 'pagada' | 'mostrador'
// En 'mostrador' NO se avisa a la agencia (está físicamente presente);
// solo se manda el cupón al cliente si dejó email.

const ESTADO_CLIENTE = {
  es: {
    pagada: 'Tu pago está confirmado ✓',
    pendiente_efectivo: 'Tu reserva está apartada: pagas al recoger',
    mostrador: 'Tu renta quedó registrada en mostrador'
  },
  en: {
    pagada: 'Your payment is confirmed ✓',
    pendiente_efectivo: 'Your reservation is on hold: pay at pickup',
    mostrador: 'Your walk-in rental is registered'
  }
};

const ESTADO_AGENCIA = {
  pagada: 'Pagada',
  pendiente_efectivo: 'Pendiente de efectivo',
  mostrador: 'Mostrador'
};

const DIRECCION = 'WalkMe Tours · 5ta Avenida entre Calle 10 y Calle 12, frente a Sala de Despecho, Playa del Carmen';
const WHATSAPP_PUBLICO = '+52 56 3974 8122';

function urlCupon(r) {
  const base = process.env.SITE_URL || 'https://www.walkmetours.com';
  const pagina = r.idioma === 'en' ? 'cupon-en.html' : 'cupon.html';
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
      from: process.env.RESEND_FROM || 'WalkMe Bikes <reservas@walkmetours.com>',
      to: destinatarios,
      subject: asunto,
      html
    })
  });
  if (!resp.ok) console.error('notificar-bici: Resend fallo:', resp.status, await resp.text());
}

function filaHtml(l, v) {
  return `<tr><td style="padding:6px 14px 6px 0;color:#6b6f66;">${l}</td><td style="padding:6px 0;font-weight:bold;color:#0D2E1A;">${v}</td></tr>`;
}

function resumenHtml(r, lang) {
  const t = lang === 'en'
    ? { folio: 'Booking', plan: 'Plan', fecha: 'Date and time', bicis: 'Bikes', total: 'Total', garantia: 'Deposit (cash)' }
    : { folio: 'Folio', plan: 'Plan', fecha: 'Fecha y hora', bicis: 'Bicis', total: 'Total', garantia: 'Garantía (efectivo)' };
  const hora = String(r.hora_inicio || '').slice(0, 5);
  return `<table style="border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:14px;">
    ${filaHtml(t.folio, `WB-${r.folio}`)}
    ${filaHtml(t.plan, r.duracion_nombre || '')}
    ${filaHtml(t.fecha, `${r.fecha_reserva} · ${hora}`)}
    ${filaHtml(t.bicis, String(r.cantidad_bicis))}
    ${filaHtml(t.total, pesos(r.total))}
    ${filaHtml(t.garantia, pesos(r.deposito_total))}
  </table>`;
}

async function emailCliente(r, evento) {
  if (!r.email) return;
  const lang = r.idioma === 'en' ? 'en' : 'es';
  const asunto = lang === 'en'
    ? `Your WalkMe Bikes voucher · WB-${r.folio}`
    : `Tu cupón WalkMe Bikes · WB-${r.folio}`;
  const saludo = lang === 'en' ? `Hi ${r.nombre_completo},` : `Hola ${r.nombre_completo},`;
  const estadoLinea = (ESTADO_CLIENTE[lang] || ESTADO_CLIENTE.es)[evento] || '';
  const botonTxt = lang === 'en' ? 'View my voucher' : 'Ver mi cupón';
  const pieWa = lang === 'en' ? 'WhatsApp' : 'WhatsApp';

  const html = `
  <div style="background:#F7F5EF;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#0D2E1A;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="font-size:18px;font-weight:bold;margin:0 0 4px;">WalkMe Bikes</p>
      <p style="margin:0 0 16px;">${saludo}</p>
      <p style="font-size:16px;font-weight:bold;color:#0D2E1A;margin:0 0 20px;">${estadoLinea}</p>
      ${resumenHtml(r, lang)}
      <p style="margin:24px 0;">
        <a href="${urlCupon(r)}" style="display:inline-block;background:#F2DE4A;color:#0D2E1A;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;">${botonTxt}</a>
      </p>
      <p style="color:#6b6f66;font-size:13px;line-height:1.5;margin:0;">
        ${DIRECCION}<br>${pieWa} ${WHATSAPP_PUBLICO}
      </p>
    </div>
  </div>`;
  await emailResend([r.email], asunto, html);
}

async function emailAgencia(r, evento) {
  const dest = process.env.AGENCIA_EMAIL;
  if (!dest) return;
  const estado = ESTADO_AGENCIA[evento] || evento;
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#0D2E1A;">
    <p>Nueva reserva bici <strong>WB-${r.folio}</strong> (${estado}).</p>
    ${resumenHtml(r, 'es')}
    <p>Cliente: ${r.nombre_completo} · ${r.telefono || '-'} · ${r.email || '-'}<br>
    Canal: ${r.canal || '-'} · Método: ${r.metodo_pago || '-'}</p>
    <p><a href="${urlCupon(r)}">Cupón</a></p>
  </div>`;
  await emailResend([dest], `Nueva reserva bici WB-${r.folio} · ${estado}`, html);
}

async function whatsAppAgencia(r, evento) {
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
        name: process.env.WA_TEMPLATE_BICI || 'nueva_reserva_bici',
        language: { code: 'es_MX' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: `WB-${r.folio}` },
            { type: 'text', text: String(r.nombre_completo || '') },
            { type: 'text', text: String(r.fecha_reserva || '') },
            { type: 'text', text: String(r.hora_inicio || '').slice(0, 5) },
            { type: 'text', text: String(r.cantidad_bicis || '') },
            { type: 'text', text: pesos(r.total) },
            { type: 'text', text: ESTADO_AGENCIA[evento] || evento }
          ]
        }]
      }
    })
  });
  if (!resp.ok) console.error('notificar-bici: WhatsApp fallo:', resp.status, await resp.text());
}

// Punto de entrada único. r = fila completa de reservas_bicis.
async function notificarReservaBici(r, evento) {
  try {
    if (!r) return;
    const tareas = [
      emailCliente(r, evento).catch(e => console.error('notificar-bici: emailCliente:', e.message))
    ];
    // Walk-in de mostrador: la agencia está presente, no se auto-notifica.
    if (evento !== 'mostrador') {
      tareas.push(
        emailAgencia(r, evento).catch(e => console.error('notificar-bici: emailAgencia:', e.message)),
        whatsAppAgencia(r, evento).catch(e => console.error('notificar-bici: whatsAppAgencia:', e.message))
      );
    }
    await Promise.allSettled(tareas);
  } catch (e) {
    console.error('notificar-bici:', e && e.message);
  }
}

// Avisar a un dueño de flota en consignación el estado de SUS bicis
// (acción manual desde el CRM — botón "avisar a dueños"). No inventa
// cálculos de ganancia/reparto: solo informa id + estado de cada unidad,
// que es el dato real que existe en bikes_flota hoy.
const ETIQUETA_ESTADO_BICI = {
  disponible: 'Disponible', rentada: 'Rentada',
  cargando: 'Cargando', mantenimiento: 'Mantenimiento'
};

async function notificarDuenoFlota(nombreDueno, correoDueno, bicis) {
  if (!correoDueno) return { enviado: false, motivo: 'sin_correo' };
  if (!process.env.RESEND_API_KEY) return { enviado: false, motivo: 'sin_resend_configurado' };
  const filas = bicis.map(b =>
    filaHtml(b.id, `${ETIQUETA_ESTADO_BICI[b.estado] || b.estado} · batería ${b.bateria}%`)
  ).join('');
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#0D2E1A;">
    <p>Hola ${nombreDueno},</p>
    <p>Este es el estado actual de tus bicis en WalkMe:</p>
    <table style="border-collapse:collapse;font-size:14px;">${filas}</table>
    <p style="color:#6b6f66;font-size:13px;">${DIRECCION}<br>WhatsApp ${WHATSAPP_PUBLICO}</p>
  </div>`;
  await emailResend([correoDueno], `Estado de tus bicis WalkMe — ${bicis.length} unidad(es)`, html);
  return { enviado: true };
}

// Depósito de garantía (hold de Stripe) que necesita que un humano lo
// revise: la tarjeta fue rechazada, pidió 3DS y no se pudo confirmar sin
// que el cliente esté presente, o el hold expiró sin que nadie lo cerrara.
// Best-effort igual que el resto del archivo — nunca lanza.
async function notificarDepositoAtencion(r, error) {
  const mensajeError = (error && error.message) || String(error || 'motivo desconocido');
  const asunto = `Depósito WB-${r.folio} requiere atención`;
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#0D2E1A;">
    <p><strong>El depósito de la renta WB-${r.folio} necesita que lo revises a mano.</strong></p>
    <p>Motivo: ${mensajeError}</p>
    ${resumenHtml(r, 'es')}
    <p>Cliente: ${r.nombre_completo} · ${r.telefono || '-'} · ${r.email || '-'}</p>
    <p>Revísalo en el CRM (pantalla Bikes → esta reserva → Capturar/Liberar depósito).</p>
  </div>`;
  const dest = process.env.AGENCIA_EMAIL;
  if (dest) {
    await emailResend([dest], asunto, html).catch(e => console.error('notificar-bici: depositoAtencion email:', e.message));
  }
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  const destino = process.env.AGENCIA_WA;
  if (token && phoneId && destino) {
    await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: destino, type: 'text',
        text: { body: `⚠ Depósito WB-${r.folio} requiere atención: ${mensajeError}` }
      })
    }).then(resp => { if (!resp.ok) return resp.text().then(t => console.error('notificar-bici: depositoAtencion WA:', resp.status, t)); })
      .catch(e => console.error('notificar-bici: depositoAtencion WA:', e.message));
  }
}

module.exports = { notificarReservaBici, notificarDuenoFlota, notificarDepositoAtencion };
