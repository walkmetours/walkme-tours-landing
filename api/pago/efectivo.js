// POST /api/pago/efectivo — { reservaId }
// El cliente pagará en persona: la reserva queda 'pendiente_efectivo',
// se genera el cupón y se disparan las notificaciones.
const { supa, leerJson } = require('../_lib/supabase.js');
const { notificarConfirmacion } = require('../_lib/notificar.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const b = leerJson(req);
  const reservaId = String(b.reservaId || '');
  if (!reservaId) return res.status(400).json({ error: 'datos_invalidos' });

  const s = supa();
  try {
    const { data, error } = await s.from('reservas')
      .update({ estado: 'pendiente_efectivo', metodo_pago: 'efectivo', updated_at: new Date().toISOString() })
      .eq('id', reservaId)
      .eq('estado', 'firmada')
      .select('*')
      .single();
    if (error || !data) return res.status(409).json({ error: 'estado_invalido' });

    await notificarConfirmacion(data);
    return res.status(200).json({ codigo: data.codigo });
  } catch (e) {
    console.error('efectivo:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
