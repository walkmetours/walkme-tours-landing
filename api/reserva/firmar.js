// POST /api/reserva/firmar
// Body: { reservaId, firmaPng: dataURL base64, contratoVersion }
// Guarda la firma en Storage con evidencia (timestamp de servidor, IP, user
// agent, versión del contrato) y pasa la reserva a estado 'firmada'.
const { supa, leerJson } = require('../_lib/supabase.js');

const MAX_FIRMA_BYTES = 300 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const b = leerJson(req);
  const reservaId = String(b.reservaId || '');
  const contratoVersion = String(b.contratoVersion || '').slice(0, 40);
  const dataUrl = String(b.firmaPng || '');
  if (!reservaId || !contratoVersion) return res.status(400).json({ error: 'datos_invalidos' });

  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'firma_invalida' });
  const png = Buffer.from(m[1], 'base64');
  if (png.length < 500 || png.length > MAX_FIRMA_BYTES) return res.status(400).json({ error: 'firma_invalida' });

  const s = supa();
  try {
    const { data: r, error: e1 } = await s.from('reservas')
      .select('id, estado, id_foto_path, hospedaje_path').eq('id', reservaId).single();
    if (e1 || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });
    if (r.estado !== 'borrador') return res.status(409).json({ error: 'reserva_cerrada' });
    if (!r.id_foto_path || !r.hospedaje_path) return res.status(400).json({ error: 'faltan_documentos' });

    const path = `firmas/${reservaId}.png`;
    const { error: e2 } = await s.storage.from('documentos')
      .upload(path, png, { contentType: 'image/png', upsert: true });
    if (e2) throw new Error(e2.message);

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 300) || null;
    const { error: e3 } = await s.from('reservas')
      .update({
        estado: 'firmada',
        firma_path: path,
        firma_ts: new Date().toISOString(),
        firma_ip: ip,
        firma_ua: ua,
        contrato_version: contratoVersion,
        updated_at: new Date().toISOString()
      })
      .eq('id', reservaId)
      .eq('estado', 'borrador');
    if (e3) throw new Error(e3.message);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('firmar:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
