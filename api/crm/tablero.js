// GET /api/crm/tablero — toda la pantalla del CRM en una llamada.
// { flota[], rentas[], solicitudes[], kpis }
// Requiere sesión válida + email en CRM_EMAILS (verificarCRM).
// Con <200 filas y una usuaria en 4G, una respuesta desnormalizada le
// gana a 4 round-trips.
const { supa } = require('../_lib/supabase.js');
const { verificarCRM } = require('../_lib/auth-crm.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const quien = await verificarCRM(req, res);
  if (!quien) return; // verificarCRM ya respondió 401/403/503

  const s = supa();
  const ahora = new Date();
  const hace60d = new Date(ahora.getTime() - 60 * 24 * 3600 * 1000).toISOString();

  try {
    const [flotaQ, rentasQ, cotizacionesQ, itemsQ, serviciosQ, tarifasQ, operadoresQ, ofertasQ] = await Promise.all([
      s.from('bikes_flota').select('*').order('orden'),
      s.from('reservas_bicis').select('*')
        .gte('created_at', hace60d)
        .order('inicio', { ascending: false })
        .limit(200),
      s.from('cotizaciones').select('*').order('created_at', { ascending: false }).limit(200),
      s.from('cotizacion_items').select('*').order('orden'),
      s.from('catalogo_servicios').select('*').order('orden'),
      s.from('servicio_tarifas').select('*'),
      s.from('operadores').select('*').order('nombre'),
      s.from('operador_ofertas').select('*')
    ]);

    if (flotaQ.error) throw new Error(flotaQ.error.message);
    if (rentasQ.error) throw new Error(rentasQ.error.message);
    // Cotizaciones/tarifario son tablas nuevas (sql/cotizaciones.sql). Si
    // todavía no se corrió esa migración, degradan a listas vacías en vez
    // de tronar el tablero completo de bicis.
    const cotizaciones = cotizacionesQ.error ? [] : (cotizacionesQ.data || []);
    const cotizacionItems = itemsQ.error ? [] : (itemsQ.data || []);
    const catalogoServicios = serviciosQ.error ? [] : (serviciosQ.data || []);
    const servicioTarifas = tarifasQ.error ? [] : (tarifasQ.data || []);
    const operadores = operadoresQ.error ? [] : (operadoresQ.data || []);
    const operadorOfertas = ofertasQ.error ? [] : (ofertasQ.data || []);

    const itemsPorCotizacion = {};
    cotizacionItems.forEach(it => {
      (itemsPorCotizacion[it.cotizacion_id] = itemsPorCotizacion[it.cotizacion_id] || []).push(it);
    });
    const cotizacionesConItems = cotizaciones.map(c => ({ ...c, items: itemsPorCotizacion[c.id] || [] }));

    const flota = flotaQ.data || [];
    const rentas = rentasQ.data || [];
    const ahoraISO = ahora.toISOString();

    // Solicitudes = reservas web activas sin unidades asignadas.
    // (Sin tabla propia ni paso de "aprobación": atenderla = asignar.)
    const solicitudes = rentas.filter(r =>
      r.canal === 'web' &&
      (!r.unidades || r.unidades.length === 0) &&
      r.fin > ahoraISO &&
      (
        ['pendiente_efectivo', 'pagada'].includes(r.estado) ||
        (r.estado === 'pendiente_pago' && r.expira_at && r.expira_at > ahoraISO)
      )
    );

    // KPIs del día (los estados "vence hoy"/"retrasada" son derivados).
    const hoyRango = fechaCancun(ahora);
    const enCurso = rentas.filter(r => r.estado === 'en_curso');
    const kpis = {
      bicisFuera: enCurso.reduce((n, r) => n + r.cantidad_bicis, 0),
      devolucionesHoy: enCurso.filter(r => fechaCancun(new Date(r.fin)) === hoyRango).length,
      retrasadas: enCurso.filter(r => r.fin < ahoraISO).length,
      porCobrar: rentas.filter(r => r.estado === 'pendiente_efectivo').length,
      solicitudes: solicitudes.length,
      leadsSinAtender: cotizaciones.filter(c => c.origen === 'lead_web' && c.estado === 'borrador').length
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      flota, rentas, solicitudes, kpis,
      cotizaciones: cotizacionesConItems,
      catalogoServicios, servicioTarifas, operadores, operadorOfertas
    });
  } catch (e) {
    console.error('crm/tablero:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};

// 'YYYY-MM-DD' en hora de Cancún (UTC-5 fijo).
function fechaCancun(d) {
  return new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
