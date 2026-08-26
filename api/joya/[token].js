// /api/joya/[token] — fusiona crear + consulta en UN solo archivo/función.
// Motivo: el plan Hobby de Vercel tiene tope de 12 Serverless Functions y
// el proyecto ya estaba justo en el límite antes de agregar JOYÀ (ver nota
// en api/bici/crear.js, que fusionó ping.js por la misma razón). Como
// [token].js es una ruta dinámica, también matchea literalmente
// /api/joya/crear — así que "crear" se trata como un token especial en vez
// de vivir en su propio archivo.
//
// GET  /api/joya/<token>  → cupón (público, allowlist de campos)
// GET  /api/joya/crear    → smoke test (deps/env), sin uso de frontend
// POST /api/joya/crear    → crea la reserva y devuelve folio + token
//
// Body de POST: { idioma, tierId, fecha, horario, adultos, ninos,
//                 transporteId, hotel?, nombre, email, telefono?, notas?, hp }
const { supa, leerJson, CAMPOS_PUBLICOS_JOYA } = require('../_lib/supabase.js');
const { generarToken, esTokenValido } = require('../_lib/token.js');
const { hoyCancun, RE_FECHA } = require('../_lib/fechas.js');
const { calcularTotal, folioLabel } = require('../_lib/catalogo-joya.js');
const { notificarReservaJoya } = require('../_lib/notificar-joya.js');

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HORARIOS_JOYA = ['19:00', '20:30'];
const HORARIOS_JUNGALA = ['10:00', '12:00', '14:00'];

async function ping(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    env: {
      supabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      resend: !!process.env.RESEND_API_KEY,
      whatsapp: !!process.env.WA_TOKEN && !!process.env.WA_PHONE_ID
    }
  });
}

async function obtenerCupon(req, res, token) {
  const t = String(token || '').toUpperCase();
  if (!esTokenValido(t)) return res.status(400).json({ error: 'token_invalido' });

  try {
    const { data: r, error } = await supa()
      .from('reservas_joya')
      .select(CAMPOS_PUBLICOS_JOYA)
      .eq('token', t)
      .single();

    if (error || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...r, folioLabel: folioLabel(r.folio) });
  } catch (e) {
    console.error('joya:obtenerCupon:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
}

async function crear(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'reservas_no_configuradas' });
  }

  const b = leerJson(req);

  // Honeypot: los bots lo llenan, los humanos no lo ven.
  if (b.hp) return res.status(200).json({ folio: 0, token: '', total: 0, moneda: 'MXN' });

  const idioma = b.idioma === 'en' ? 'en' : 'es';
  const tierId = String(b.tierId || '');
  const esJungala = tierId.indexOf('jungala-') === 0;
  const fecha = String(b.fecha || '');
  const horario = String(b.horario || '');
  const adultos = parseInt(b.adultos, 10);
  const ninos = parseInt(b.ninos, 10) || 0;
  const transporteId = ['no', 'pdc', 'riviera', 'cun'].indexOf(b.transporteId) >= 0 ? b.transporteId : 'no';
  const hotel = String(b.hotel || '').trim().slice(0, 200);
  const nombre = String(b.nombre || '').trim();
  const email = String(b.email || '').trim();
  const telefono = String(b.telefono || '').replace(/[^\d+]/g, '');
  const notas = String(b.notas || '').trim().slice(0, 500);

  // --- Validación ---
  const precio = calcularTotal(tierId, adultos, ninos, transporteId);
  if (!precio) return res.status(400).json({ error: 'tier_invalido' });

  if (!RE_FECHA.test(fecha)) return res.status(400).json({ error: 'fecha_invalida' });
  const hoy = hoyCancun();
  if (fecha < hoy) return res.status(400).json({ error: 'fecha_pasada' });
  // Tarifas vigentes solo hasta el 24 de diciembre de 2026 (ver catálogo).
  if (fecha > '2026-12-24') return res.status(400).json({ error: 'fecha_fuera_de_temporada' });

  const horariosValidos = esJungala ? HORARIOS_JUNGALA : HORARIOS_JOYA;
  if (horariosValidos.indexOf(horario) < 0) return res.status(400).json({ error: 'horario_invalido' });

  if (!Number.isFinite(adultos) || adultos < 1 || adultos > 20) {
    return res.status(400).json({ error: 'adultos_invalido' });
  }
  if (!Number.isFinite(ninos) || ninos < 0 || ninos > 20) {
    return res.status(400).json({ error: 'ninos_invalido' });
  }
  if (nombre.split(/\s+/).length < 2 || nombre.length > 160) {
    return res.status(400).json({ error: 'nombre_invalido' });
  }
  if (!RE_EMAIL.test(email) || email.length > 160) {
    return res.status(400).json({ error: 'email_invalido' });
  }
  if (telefono && telefono.replace(/\D/g, '').length < 8) {
    return res.status(400).json({ error: 'telefono_invalido' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const ua = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const s = supa();

  try {
    // Anti-abuso: máx 5 reservas/hora por IP, igual que bicis.
    if (ip) {
      const desde = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await s.from('reservas_joya')
        .select('id', { count: 'exact', head: true })
        .eq('firma_ip', ip).gte('created_at', desde);
      if ((count || 0) >= 5) return res.status(429).json({ error: 'demasiadas_reservas' });
    }

    for (let intento = 0; intento < 3; intento++) {
      const token = generarToken();
      const payload = {
        token,
        idioma,
        canal: 'web',
        tier_id: tierId,
        tier_nombre: precio.tier.nombre[idioma],
        seccion: precio.tier.seccion[idioma],
        fecha_funcion: fecha,
        horario,
        adultos,
        ninos,
        transporte_id: transporteId,
        transporte_tarifa: precio.transporte.tarifa,
        hotel: hotel || null,
        precio_adulto: precio.precioAdulto,
        precio_nino: precio.precioNino,
        subtotal_boletos: precio.subtotalBoletos,
        subtotal_transporte: precio.subtotalTransporte,
        total: precio.total,
        nombre_completo: nombre,
        email,
        telefono: telefono || null,
        notas: notas || null,
        firma_ip: ip,
        firma_ua: ua
      };

      const { data, error } = await s.rpc('crear_reserva_joya', { payload });

      if (error) {
        if (/duplicate|unique/i.test(error.message || '')) continue; // token chocó: otro intento
        console.error('crear_reserva_joya:', error.message);
        return res.status(500).json({ error: 'error_interno' });
      }
      if (data && data.ok === true) {
        // Notificación best-effort: nunca bloquea la respuesta al cliente.
        const { data: fila } = await s.from('reservas_joya').select('*').eq('token', token).single();
        if (fila) notificarReservaJoya(fila, 'pendiente_pago').catch(e => console.error('crear:notificar:', e.message));

        return res.status(200).json({
          folio: data.folio,
          folioLabel: folioLabel(data.folio),
          token: data.token,
          total: precio.total,
          moneda: 'MXN'
        });
      }
      return res.status(500).json({ error: 'respuesta_inesperada' });
    }
    return res.status(500).json({ error: 'token_agotado' });
  } catch (e) {
    console.error('crear:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
}

module.exports = async (req, res) => {
  const token = req.query.token;

  if (token === 'crear') {
    if (req.method === 'GET') return ping(req, res);
    if (req.method === 'POST') return crear(req, res);
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'reservas_no_configuradas' });
  }
  return obtenerCupon(req, res, token);
};
