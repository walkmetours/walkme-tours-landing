// POST /api/webhooks/bici-mercadopago
// MP notifica (type=payment). NUNCA se confía en el body del webhook: se
// re-consulta el pago por API con el access token (fuente de verdad).
// Verificación de firma x-signature (MP_WEBHOOK_SECRET) — mejora sobre el
// código de tours; si la variable no está, se sigue confiando en el
// re-fetch (un id forjado no tendrá nuestro external_reference).
// Idempotente. Siempre responde 200 para no provocar tormenta de reintentos.
const crypto = require('crypto');
const { supa } = require('../_lib/supabase.js');
const { esTokenValido } = require('../_lib/token.js');
const { notificarReservaBici } = require('../_lib/notificar-bici.js');

// Firma de MP: x-signature = "ts=...,v1=..."; el manifest firmado es
// "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con HMAC-SHA256.
function firmaValida(req, pagoId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // sin secreto configurado: no bloquear (defensa = re-fetch)
  try {
    const sig = String(req.headers['x-signature'] || '');
    const reqId = String(req.headers['x-request-id'] || '');
    const partes = Object.fromEntries(sig.split(',').map(p => p.trim().split('=')));
    if (!partes.ts || !partes.v1) return false;
    const manifest = `id:${String(pagoId).toLowerCase()};request-id:${reqId};ts:${partes.ts};`;
    const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(partes.v1));
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(200).json({ ok: true, ignorado: true });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tipo = body.type || req.query.type || req.query.topic;
    const pagoId = (body.data && body.data.id) || req.query['data.id'] || req.query.id;
    if (tipo !== 'payment' || !pagoId) return res.status(200).json({ ok: true, ignorado: true });

    if (!firmaValida(req, pagoId)) {
      console.error('MP firma invalida');
      return res.status(200).json({ ok: true, firma: false });
    }

    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    if (!resp.ok) {
      console.error('MP consulta pago:', resp.status);
      return res.status(200).json({ ok: true });
    }
    const pago = await resp.json();
    const token = String(pago.external_reference || '').toUpperCase();
    if (!esTokenValido(token) || pago.status !== 'approved') {
      return res.status(200).json({ ok: true, estado: pago.status });
    }

    const s = supa();
    const { data: r } = await s.from('reservas_bicis')
      .select('id, estado').eq('token', token).single();
    if (!r) return res.status(200).json({ ok: true });
    if (['pagada', 'en_curso', 'cerrada'].includes(r.estado)) {
      return res.status(200).json({ ok: true, ya: true });
    }

    const { data: actualizada } = await s.from('reservas_bicis')
      .update({
        estado: 'pagada',
        metodo_pago: 'mercadopago',
        pago_ref: String(pago.id),
        pago_ts: new Date().toISOString(),
        expira_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', r.id)
      .in('estado', ['pendiente_pago', 'pendiente_efectivo'])
      .select('*')
      .single();

    if (actualizada) await notificarReservaBici(actualizada, 'pagada');
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('webhook MP:', e.message);
    return res.status(200).json({ ok: true });
  }
};
