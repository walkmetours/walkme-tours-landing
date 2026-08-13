// POST /api/pago/mercadopago — { reservaId }
// Crea una preferencia de Checkout Pro y devuelve init_point para redirigir.
// external_reference = código de reserva; el webhook confirma el pago.
const { supa, leerJson } = require('../_lib/supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ error: 'mp_no_configurado' });
  const b = leerJson(req);
  const reservaId = String(b.reservaId || '');
  if (!reservaId) return res.status(400).json({ error: 'datos_invalidos' });

  const site = process.env.SITE_URL || 'https://www.walkmetours.com';
  const s = supa();
  try {
    const { data: r, error } = await s.from('reservas')
      .select('id, codigo, estado, idioma, tour_nombre, total').eq('id', reservaId).single();
    if (error || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });
    if (r.estado !== 'firmada' && r.estado !== 'pendiente_efectivo') {
      return res.status(409).json({ error: 'estado_invalido' });
    }

    const gracias = `${site}/${r.idioma === 'en' ? 'gracias-en.html' : 'gracias.html'}?codigo=${r.codigo}`;
    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pref-${r.codigo}`
      },
      body: JSON.stringify({
        items: [{
          title: `${r.tour_nombre} · WalkMe Tours ${r.codigo}`,
          quantity: 1,
          unit_price: Number(r.total),
          currency_id: 'MXN'
        }],
        external_reference: r.codigo,
        back_urls: { success: gracias, pending: gracias, failure: `${site}/${r.idioma === 'en' ? 'reserva-en.html' : 'reserva.html'}` },
        auto_return: 'approved',
        notification_url: `${site}/api/webhooks/mercadopago`,
        statement_descriptor: 'WALKME TOURS'
      })
    });
    if (!resp.ok) {
      console.error('MP preferencia:', resp.status, await resp.text());
      return res.status(502).json({ error: 'mp_error' });
    }
    const pref = await resp.json();

    await s.from('reservas').update({ metodo_pago: 'mercadopago', updated_at: new Date().toISOString() }).eq('id', r.id);
    return res.status(200).json({ url: pref.init_point });
  } catch (e) {
    console.error('mercadopago:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
