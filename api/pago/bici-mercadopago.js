// POST /api/pago/bici-mercadopago — { token }
// Crea una preferencia de Checkout Pro y devuelve init_point para redirigir.
// external_reference = token de la reserva; el webhook confirma el pago.
// 503 si MP no está configurado: el sitio funciona igual sin la llave.
const { supa, leerJson } = require('../_lib/supabase.js');
const { esTokenValido } = require('../_lib/token.js');
const { folioLabel } = require('../_lib/catalogo-bicis.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ error: 'mp_no_configurado' });

  const b = leerJson(req);
  const token = String(b.token || '').toUpperCase();
  if (!esTokenValido(token)) return res.status(400).json({ error: 'token_invalido' });

  const site = process.env.SITE_URL || 'https://www.walkmetours.com';
  const s = supa();
  try {
    const { data: r, error } = await s.from('reservas_bicis')
      .select('id, token, folio, estado, idioma, total, email')
      .eq('token', token).single();
    if (error || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });
    // Se puede pagar en línea desde el estado inicial O si ya había elegido
    // pagar en agencia y cambió de opinión.
    if (r.estado !== 'pendiente_pago' && r.estado !== 'pendiente_efectivo') {
      return res.status(409).json({ error: 'estado_invalido' });
    }

    const cupon = `${site}/${r.idioma === 'en' ? 'cupon-en.html' : 'cupon.html'}?t=${r.token}&pagando=1`;
    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pref-bici-${r.token}`
      },
      body: JSON.stringify({
        items: [{
          title: `Renta de bici WalkMe · Folio ${folioLabel(r.folio)}`,
          quantity: 1,
          unit_price: Number(r.total),
          currency_id: 'MXN'
        }],
        payer: { email: r.email },
        external_reference: r.token,
        back_urls: {
          success: cupon,
          pending: cupon,
          failure: `${site}/${r.idioma === 'en' ? 'cupon-en.html' : 'cupon.html'}?t=${r.token}`
        },
        auto_return: 'approved',
        notification_url: `${site}/api/webhooks/bici-mercadopago`,
        statement_descriptor: 'WALKME BIKES'
      })
    });
    if (!resp.ok) {
      console.error('MP preferencia:', resp.status, await resp.text());
      return res.status(502).json({ error: 'mp_error' });
    }
    const pref = await resp.json();

    await s.from('reservas_bicis')
      .update({ metodo_pago: 'mercadopago', updated_at: new Date().toISOString() })
      .eq('id', r.id);
    return res.status(200).json({ url: pref.init_point });
  } catch (e) {
    console.error('bici-mercadopago:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
