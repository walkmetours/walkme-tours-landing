// Cliente Supabase con service_role — SOLO para uso en /api.
// El front jamás recibe esta key. RLS está activo sin policies en todas
// las tablas: la anon key no puede leer nada; solo este cliente entra.
const { createClient } = require('@supabase/supabase-js');

let client = null;
function supa() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

// Campos de la reserva de bici que sí pueden viajar al navegador (cupón).
// El nombre SÍ va: el cupón es un comprobante y el mostrador verifica el
// nombre (el token inadivinable es la puerta). Nunca exponer
// email/teléfono/documento/firma_ip/firma_ua por el endpoint público.
const CAMPOS_PUBLICOS_BICI =
  'folio, token, estado, idioma, tipo_bici, duracion_id, duracion_nombre, ' +
  'fecha_reserva, hora_inicio, cantidad_bicis, precio_unitario, total, moneda, ' +
  'deposito_unitario, deposito_total, metodo_pago, nombre_completo';

function leerJson(req) {
  // Vercel ya parsea JSON; por si llega como string.
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return req.body || {};
}

module.exports = { supa, CAMPOS_PUBLICOS_BICI, leerJson };
