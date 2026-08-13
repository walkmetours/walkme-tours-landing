// POST /api/pago/stripe — { reservaId }
// Crea una Stripe Checkout Session (tarjetas internacionales) y devuelve
// la URL del checkout hosted. client_reference_id = código de reserva.
const { supa, leerJson } = require('../_lib/supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'stripe_no_configurado' });
  const b = leerJson(req);
  const reservaId = String(b.reservaId || '');
  if (!reservaId) return res.status(400).json({ error: 'datos_invalidos' });

  const site = process.env.SITE_URL || 'https://www.walkmetours.com';
  const s = supa();
  try {
    const { data: r, error } = await s.from('reservas')
      .select('id, codigo, estado, idioma, tour_nombre, total, email').eq('id', reservaId).single();
    if (error || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });
    if (r.estado !== 'firmada' && r.estado !== 'pendiente_efectivo') {
      return res.status(409).json({ error: 'estado_invalido' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const gracias = `${site}/${r.idioma === 'en' ? 'gracias-en.html' : 'gracias.html'}?codigo=${r.codigo}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: r.codigo,
      customer_email: r.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'mxn',
          unit_amount: Math.round(Number(r.total) * 100),
          product_data: { name: `${r.tour_nombre} · WalkMe Tours ${r.codigo}` }
        }
      }],
      success_url: gracias,
      cancel_url: `${site}/${r.idioma === 'en' ? 'reserva-en.html' : 'reserva.html'}`
    }, { idempotencyKey: `checkout-${r.codigo}` });

    await s.from('reservas').update({ metodo_pago: 'stripe', updated_at: new Date().toISOString() }).eq('id', r.id);
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('stripe:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
