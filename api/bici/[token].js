// GET /api/bici/[token] — alimenta la página del cupón.
// Solo campos del allowlist: jamás email/teléfono/documento/IP/UA.
const { supa, CAMPOS_PUBLICOS_BICI } = require('../_lib/supabase.js');
const { esTokenValido } = require('../_lib/token.js');
const { folioLabel } = require('../_lib/catalogo-bicis.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'reservas_no_configuradas' });
  }

  const token = String(req.query.token || '').toUpperCase();
  if (!esTokenValido(token)) return res.status(400).json({ error: 'token_invalido' });

  try {
    const { data: r, error } = await supa()
      .from('reservas_bicis')
      .select(CAMPOS_PUBLICOS_BICI)
      .eq('token', token)
      .single();

    if (error || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...r, folioLabel: folioLabel(r.folio) });
  } catch (e) {
    console.error('[token]:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
