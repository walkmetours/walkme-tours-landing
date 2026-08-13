// Cliente Supabase con service_role — SOLO para uso en /api.
// El front jamás recibe esta key; solo URLs firmadas temporales.
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

// Campos de la reserva que sí pueden viajar al navegador (cupón).
// Nunca exponer email/teléfono/paths de documentos por el endpoint público.
const CAMPOS_PUBLICOS = 'codigo, estado, idioma, tour_nombre, fecha_tour, adultos, menores, zona, total, moneda, metodo_pago';

function leerJson(req) {
  // Vercel ya parsea JSON; por si llega como string.
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return req.body || {};
}

module.exports = { supa, CAMPOS_PUBLICOS, leerJson };
