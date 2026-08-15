// GET /api/crm/foto?token=<token> — signed URL temporal para ver la foto
// de identificación de una reserva. Requiere sesión CRM válida.
// El bucket 'documentos-bicis' es PRIVADO: nunca se expone una URL fija.
const { supa } = require('../_lib/supabase.js');
const { verificarCRM } = require('../_lib/auth-crm.js');
const { esTokenValido } = require('../_lib/token.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const quien = await verificarCRM(req, res);
  if (!quien) return; // verificarCRM ya respondió 401/403/503

  const token = String(req.query.token || '').toUpperCase();
  if (!esTokenValido(token)) return res.status(400).json({ error: 'token_invalido' });

  const s = supa();
  try {
    const { data: r, error } = await s.from('reservas_bicis')
      .select('foto_id_path')
      .eq('token', token)
      .single();

    if (error || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });
    if (!r.foto_id_path) return res.status(404).json({ error: 'sin_foto' });

    const { data: signed, error: signError } = await s.storage
      .from('documentos-bicis')
      .createSignedUrl(r.foto_id_path, 300); // 5 min, suficiente para abrirla

    if (signError || !signed) {
      console.error('crm/foto:', signError && signError.message);
      return res.status(500).json({ error: 'error_interno' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ url: signed.signedUrl });
  } catch (e) {
    console.error('crm/foto:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
