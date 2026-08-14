// POST /api/pago/bici-efectivo — { token }
// El cliente elige "pagar al recoger": el cupón ya existe desde crear.js,
// aquí solo se registra la elección. Sin redirect: la página re-renderiza.
// También quita el hold de 30 min (la reserva ya es firme).
const { supa, leerJson } = require('../_lib/supabase.js');
const { esTokenValido } = require('../_lib/token.js');
const { notificarReservaBici } = require('../_lib/notificar-bici.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'reservas_no_configuradas' });
  }

  const b = leerJson(req);
  const token = String(b.token || '').toUpperCase();
  if (!esTokenValido(token)) return res.status(400).json({ error: 'token_invalido' });

  try {
    const { data: r, error } = await supa()
      .from('reservas_bicis')
      .update({
        estado: 'pendiente_efectivo',
        metodo_pago: 'efectivo',
        expira_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('token', token)
      .eq('estado', 'pendiente_pago')   // solo desde el estado inicial
      .select('*')
      .single();

    if (error || !r) return res.status(409).json({ error: 'estado_invalido' });
    await notificarReservaBici(r, 'pendiente_efectivo'); // best-effort, nunca lanza
    return res.status(200).json({ folio: r.folio, estado: r.estado });
  } catch (e) {
    console.error('bici-efectivo:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
