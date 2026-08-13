// POST /api/webhooks/mercadopago
// Mercado Pago notifica (type=payment). Se consulta el pago por API con el
// access token (fuente de verdad, no el body del webhook), y si está aprobado
// la reserva pasa a 'pagada' y se notifica. Idempotente: si ya está pagada,
// responde 200 y sale. Siempre responde rápido con 200 para evitar reintentos.
const { supa } = require('../_lib/supabase.js');
const { notificarConfirmacion } = require('../_lib/notificar.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tipo = body.type || req.query.type || req.query.topic;
    const pagoId = (body.data && body.data.id) || req.query['data.id'] || req.query.id;
    if (tipo !== 'payment' || !pagoId) return res.status(200).json({ ok: true, ignorado: true });

    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    if (!resp.ok) {
      console.error('MP consulta pago:', resp.status);
      return res.status(200).json({ ok: true });
    }
    const pago = await resp.json();
    const codigo = String(pago.external_reference || '').toUpperCase();
    if (!codigo || pago.status !== 'approved') return res.status(200).json({ ok: true, estado: pago.status });

    const s = supa();
    const { data: r } = await s.from('reservas').select('id, estado').eq('codigo', codigo).single();
    if (!r) return res.status(200).json({ ok: true });
    if (r.estado === 'pagada' || r.estado === 'confirmada') return res.status(200).json({ ok: true, ya: true });

    const { data: actualizada } = await s.from('reservas')
      .update({
        estado: 'pagada',
        metodo_pago: 'mercadopago',
        pago_ref: String(pago.id),
        pago_ts: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', r.id)
      .in('estado', ['firmada', 'pendiente_efectivo'])
      .select('*')
      .single();

    if (actualizada) await notificarConfirmacion(actualizada);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('webhook MP:', e.message);
    return res.status(200).json({ ok: true }); // 200 igualmente: no provocar tormenta de reintentos
  }
};
