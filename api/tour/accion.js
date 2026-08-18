// POST /api/tour/accion — ÚNICO endpoint público de tours (sin sesión).
// Un solo archivo con switch sobre { accion, ... }, mismo patrón que
// api/crm/accion.js — así cabe dentro del límite de functions del plan
// Hobby de Vercel (17-ago-26: 12/12 usadas, se liberó 1 fusionando
// api/bici/ping.js en api/bici/crear.js).
//
// Hoy solo soporta 'lead_crear': el cliente pide una cotización desde
// tours.html/xcaret.html — no reserva ni paga nada, solo dice qué quiere.
// Crea una fila en `cotizaciones` con estado 'borrador' y origen
// 'lead_web'; María la completa y la manda desde el CRM. Reusar esta
// misma función para 'reservar'/'pagar' de tours más adelante (Fase 6),
// no crear archivos nuevos.
const { supa, leerJson } = require('../_lib/supabase.js');

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'no_configurado' });
  }

  const b = leerJson(req);
  const s = supa();

  try {
    switch (b.accion) {

      case 'lead_crear': {
        // Honeypot: los bots lo llenan, los humanos no lo ven. Éxito falso
        // para no darles señal (mismo patrón que api/bici/crear.js).
        if (b.hp) return res.status(200).json({ ok: true });

        const nombre = String(b.nombre || '').trim();
        const servicioNombre = String(b.servicio_nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'nombre_requerido' });
        if (!servicioNombre) return res.status(400).json({ error: 'servicio_requerido' });
        const email = String(b.email || '').trim();
        const telefono = String(b.telefono || '').trim();
        if (!email && !telefono) return res.status(400).json({ error: 'contacto_requerido' });
        if (email && !RE_EMAIL.test(email)) return res.status(400).json({ error: 'email_invalido' });

        const adultos = Math.max(1, Math.min(20, parseInt(b.adultos, 10) || 1));
        const menores = Math.max(0, Math.min(20, parseInt(b.menores, 10) || 0));

        const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
        const ua = String(req.headers['user-agent'] || '').slice(0, 300) || null;

        // Anti-abuso: máx 5 leads/hora por IP (mismo umbral que reservas de bici).
        if (ip) {
          const desde = new Date(Date.now() - 3600 * 1000).toISOString();
          const { count } = await s.from('cotizaciones')
            .select('id', { count: 'exact', head: true })
            .eq('origen_ip', ip).gte('created_at', desde);
          if ((count || 0) >= 5) return res.status(429).json({ error: 'demasiadas_solicitudes' });
        }

        const { data: cot, error: eCot } = await s.from('cotizaciones').insert({
          estado: 'borrador',
          origen: 'lead_web',
          idioma: b.idioma === 'en' ? 'en' : 'es',
          cliente_nombre: nombre,
          cliente_tel: telefono || null,
          cliente_email: email || null,
          notas: b.notas || null,
          origen_ip: ip,
          origen_ua: ua,
          creado_por: 'web'
        }).select('id, folio').single();
        if (eCot) {
          // Tablas de sql/cotizaciones.sql sin correr todavía en Supabase.
          console.error('lead_crear:', eCot.message);
          return res.status(503).json({ error: 'no_configurado' });
        }

        await s.from('cotizacion_items').insert({
          cotizacion_id: cot.id,
          servicio_id: b.servicio_id || null,
          servicio_nombre: servicioNombre,
          fecha: b.fecha || null,
          zona: b.zona || null,
          nacionalidad: b.nacionalidad === 'nacional' ? 'nacional' : 'extranjero',
          adultos, menores,
          precio_adulto: 0, precio_menor: 0,  // el precio lo pone María al cotizar, no el visitante
          orden: 0
        });

        return res.status(200).json({ ok: true, folio: cot.folio });
      }

      default:
        return res.status(400).json({ error: 'accion_invalida' });
    }
  } catch (e) {
    console.error('tour/accion:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
