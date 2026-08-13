// POST /api/reserva/crear
// Crea (o actualiza, si llega reservaId en estado borrador) la reserva.
// El total SIEMPRE se recalcula aquí desde el catálogo; el del navegador
// es solo informativo. Devuelve { reservaId, codigo, total }.
const { supa, leerJson } = require('../_lib/supabase.js');
const { calcularTotal } = require('../_lib/catalogo.js');
const { generarCodigo } = require('../_lib/codigo.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const b = leerJson(req);

  const idioma = b.idioma === 'en' ? 'en' : 'es';
  const tourId = String(b.tourId || '');
  const fecha = String(b.fecha || '');
  const adultos = parseInt(b.adultos, 10);
  const menores = parseInt(b.menores, 10) || 0;
  const zona = ['pdc', 'rm', 'cun'].includes(b.zona) ? b.zona : null;
  const hotel = String(b.hotel || '').trim().slice(0, 200);
  const nombre = String(b.nombre || '').trim().slice(0, 160);
  const email = String(b.email || '').trim().slice(0, 160);
  const telefono = String(b.telefono || '').trim().slice(0, 40);

  const manana = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  if (!tourId || !zona) return res.status(400).json({ error: 'datos_invalidos' });
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < manana) return res.status(400).json({ error: 'fecha_invalida' });
  if (!(adultos >= 1 && adultos <= 30) || !(menores >= 0 && menores <= 20)) return res.status(400).json({ error: 'pax_invalido' });
  if (nombre.split(/\s+/).length < 2) return res.status(400).json({ error: 'nombre_invalido' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'email_invalido' });
  if (telefono.replace(/\D/g, '').length < 8) return res.status(400).json({ error: 'telefono_invalido' });
  if (!hotel) return res.status(400).json({ error: 'hotel_invalido' });

  const calc = calcularTotal(tourId, zona, adultos, menores);
  if (!calc) return res.status(400).json({ error: 'sin_precio_en_linea' });

  const fila = {
    idioma,
    tour_id: tourId,
    tour_nombre: calc.tour.nombre[idioma],
    fecha_tour: fecha,
    adultos, menores, zona, hotel,
    precio_adulto: calc.precioAdulto,
    precio_menor: calc.precioMenor,
    total: calc.total,
    moneda: 'MXN',
    nombre_completo: nombre,
    email, telefono,
    updated_at: new Date().toISOString()
  };

  const s = supa();
  try {
    // Actualización de un borrador existente (el cliente volvió atrás y cambió algo)
    if (b.reservaId) {
      const { data, error } = await s.from('reservas')
        .update(fila)
        .eq('id', b.reservaId)
        .eq('estado', 'borrador')
        .select('id, codigo, total')
        .single();
      if (!error && data) return res.status(200).json({ reservaId: data.id, codigo: data.codigo, total: data.total });
      // Si no se pudo (no existe o ya no es borrador) → crear una nueva
    }

    for (let intento = 0; intento < 3; intento++) {
      const codigo = generarCodigo(fecha);
      const { data, error } = await s.from('reservas')
        .insert({ ...fila, codigo, estado: 'borrador' })
        .select('id, codigo, total')
        .single();
      if (!error) return res.status(200).json({ reservaId: data.id, codigo: data.codigo, total: data.total });
      if (!String(error.message).includes('duplicate')) throw new Error(error.message);
    }
    throw new Error('codigo_agotado');
  } catch (e) {
    console.error('crear reserva:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
