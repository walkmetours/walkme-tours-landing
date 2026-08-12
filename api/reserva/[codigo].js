// GET /api/reserva/:codigo — datos minimos del cupon para gracias.html
// Fase 0: responde dummy para verificar que estatico + functions conviven.
// Fase 2+: consultara la reserva real en Supabase.
module.exports = (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const codigo = String(req.query.codigo || '').toUpperCase();
  res.status(200).json({
    ok: true,
    codigo: codigo,
    estado: 'demo',
    mensaje: 'API de reservas WalkMe Tours activa (fase 0)'
  });
};
