// GET /api/reserva/:codigo — datos públicos mínimos del cupón para gracias.html.
// Nunca expone email, teléfono ni rutas de documentos.
const { supa, CAMPOS_PUBLICOS } = require('../_lib/supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const codigo = String(req.query.codigo || '').toUpperCase().slice(0, 20);
  if (!/^WM-\d{6}-[A-Z0-9]{4}$/.test(codigo)) return res.status(400).json({ error: 'codigo_invalido' });

  try {
    const { data, error } = await supa().from('reservas')
      .select(CAMPOS_PUBLICOS).eq('codigo', codigo).single();
    if (error || !data) return res.status(404).json({ error: 'no_encontrada' });
    // Solo el primer nombre, para saludo del cupón sin exponer datos completos
    return res.status(200).json(data);
  } catch (e) {
    console.error('cupon:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
