// POST /api/webhooks/stripe
// Verifica la firma con el RAW body (bodyParser desactivado — requisito de
// stripe.webhooks.constructEvent). checkout.session.completed → 'pagada'.
// Idempotente por estado.
const { supa } = require('../_lib/supabase.js');
const { notificarConfirmacion } = require('../_lib/notificar.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let event;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('firma stripe invalida:', e.message);
    return res.status(400).json({ error: 'firma_invalida' });
  }

  try {
    if (event.type !== 'checkout.session.completed') return res.status(200).json({ ok: true, ignorado: true });
    const session = event.data.object;
    const codigo = String(session.client_reference_id || '').toUpperCase();
    if (!codigo || session.payment_status !== 'paid') return res.status(200).json({ ok: true });

    const s = supa();
    const { data: r } = await s.from('reservas').select('id, estado').eq('codigo', codigo).single();
    if (!r) return res.status(200).json({ ok: true });
    if (r.estado === 'pagada' || r.estado === 'confirmada') return res.status(200).json({ ok: true, ya: true });

    const { data: actualizada } = await s.from('reservas')
      .update({
        estado: 'pagada',
        metodo_pago: 'stripe',
        pago_ref: String(session.id),
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
    console.error('webhook stripe:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};

// Desactiva el parseo del body: constructEvent necesita los bytes crudos.
module.exports.config = { api: { bodyParser: false } };
