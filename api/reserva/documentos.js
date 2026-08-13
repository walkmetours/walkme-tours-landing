// POST /api/reserva/documentos
// Body: { reservaId, tipo: 'id'|'hospedaje', ext: 'jpg'|'jpeg'|'png'|'webp'|'pdf' }
// Genera una URL firmada de subida directa a Storage (el archivo no pasa por
// esta function) y registra el path en la reserva. La URL vale para UN objeto.
const { supa, leerJson } = require('../_lib/supabase.js');

const EXT_OK = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const CAMPO = { id: 'id_foto_path', hospedaje: 'hospedaje_path' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const b = leerJson(req);
  const reservaId = String(b.reservaId || '');
  const tipo = b.tipo === 'hospedaje' ? 'hospedaje' : (b.tipo === 'id' ? 'id' : null);
  const ext = EXT_OK.includes(String(b.ext || '').toLowerCase()) ? String(b.ext).toLowerCase() : null;
  if (!reservaId || !tipo || !ext) return res.status(400).json({ error: 'datos_invalidos' });

  const s = supa();
  try {
    const { data: r, error: e1 } = await s.from('reservas')
      .select('id, estado').eq('id', reservaId).single();
    if (e1 || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });
    if (r.estado !== 'borrador') return res.status(409).json({ error: 'reserva_cerrada' });

    const carpeta = tipo === 'id' ? 'ids' : 'hospedaje';
    const path = `${carpeta}/${reservaId}.${ext}`;

    // upsert:true permite reintentar la subida del mismo documento
    const { data: firma, error: e2 } = await s.storage.from('documentos')
      .createSignedUploadUrl(path, { upsert: true });
    if (e2) throw new Error(e2.message);

    const { error: e3 } = await s.from('reservas')
      .update({ [CAMPO[tipo]]: path, updated_at: new Date().toISOString() })
      .eq('id', reservaId);
    if (e3) throw new Error(e3.message);

    return res.status(200).json({ uploadUrl: firma.signedUrl, path });
  } catch (e) {
    console.error('documentos:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
