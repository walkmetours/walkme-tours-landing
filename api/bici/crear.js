// POST /api/bici/crear — crea la reserva de bici y devuelve folio + token.
// El total SIEMPRE se recalcula aquí desde el catálogo; disponibilidad y
// creación son atómicas en el RPC crear_reserva_bici (advisory lock).
//
// Body: { idioma, duracionId, fecha, hora, cantidad, garantiaTipo, nombre,
//         email, telefono?, nacionalidad?, documento?, hotel?, firma,
//         aceptaTerminos, foto, fotoReserva?, hp }
// 200 → { folio, folioLabel, token, total, moneda }
// 409 → { error:'sin_disponibilidad', disponibles:N }
const { supa, leerJson } = require('../_lib/supabase.js');
const { generarToken } = require('../_lib/token.js');
const { ventana, hoyCancun, RE_FECHA, RE_HORA } = require('../_lib/fechas.js');
const { calcularTotal, IDIOMAS } = require('../_lib/catalogo-bicis.js');

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_FOTO = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
// La reserva de hotel suele llegar como PDF, así que ese sí se acepta aquí.
// Un PDF no pasa por el canvas del navegador: llega sin comprimir.
const RE_DOC = /^data:(image\/(?:jpeg|jpg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;
const FOTO_MAX_BYTES = 8 * 1024 * 1024; // ya viene comprimida por el navegador (~1600px, JPEG 75%)
const HOLD_MIN = 30; // minutos de hold para pendiente_pago

// Compara firma≈nombre ignorando acentos, mayúsculas y espacios extra.
function normaliza(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// data URL → { buffer, contentType, ext }. null si no parsea o se pasa de
// tamaño; el llamador decide si eso es un error o "no adjuntó nada".
function parseArchivo(valor, permitirPdf) {
  const m = (permitirPdf ? RE_DOC : RE_FOTO).exec(String(valor || ''));
  if (!m) return null;
  const contentType = permitirPdf ? m[1] : 'image/' + m[1];
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0 || buffer.length > FOTO_MAX_BYTES) return null;
  return { buffer, contentType, ext: contentType === 'application/pdf' ? '.pdf' : '.jpg' };
}

// GET en esta misma función = smoke test (antes vivía en api/bici/ping.js,
// fusionado aquí 17-ago-26 para no pasarse del límite de functions del plan
// Hobby de Vercel — sin uso real de frontend, solo verificación manual).
async function ping(req, res) {
  let supabaseOk = false;
  try { require('@supabase/supabase-js'); supabaseOk = true; } catch (e) { /* dep ausente */ }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    deps: { supabase: supabaseOk },
    env: {
      supabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      mercadopago: !!process.env.MP_ACCESS_TOKEN,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      resend: !!process.env.RESEND_API_KEY,
      crm: !!process.env.SUPABASE_ANON_KEY && !!process.env.CRM_EMAILS
    }
  });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return ping(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'reservas_no_configuradas' });
  }

  const b = leerJson(req);

  // Honeypot: los bots lo llenan, los humanos no lo ven. Éxito falso para
  // no darles señal — y sin quemar un folio.
  if (b.hp) return res.status(200).json({ folio: 0, token: '', total: 0, moneda: 'MXN' });

  // 5 idiomas desde el catálogo (es/en/it/fr/pt). Cualquier otra cosa cae a
  // español en vez de rechazar: perder una reserva por un código de idioma
  // raro sería absurdo.
  const idioma = IDIOMAS.indexOf(b.idioma) >= 0 ? b.idioma : 'es';
  const duracionId = String(b.duracionId || '');
  const fecha = String(b.fecha || '');
  const hora = String(b.hora || '');
  const cantidad = parseInt(b.cantidad, 10);
  const nombre = String(b.nombre || '').trim();
  const email = String(b.email || '').trim();
  const telefono = String(b.telefono || '').replace(/[^\d+]/g, '');
  const firma = String(b.firma || '').trim();
  // Campos del formulario nuevo. Opcionales: si vienen vacíos se guardan null.
  const nacionalidad = String(b.nacionalidad || '').trim().slice(0, 80);
  const documento = String(b.documento || '').trim().slice(0, 60);
  const hotel = String(b.hotel || '').trim().slice(0, 200);
  // Modalidad de garantía (19-ago-26). Cualquier cosa que no sea 'tarjeta'
  // cae a 'efectivo' en vez de rechazar — mismo criterio que `idioma` de
  // arriba y por la misma razón: no perder una reserva por un valor raro.
  const garantiaTipo = b.garantiaTipo === 'tarjeta' ? 'tarjeta' : 'efectivo';

  // --- Validación ---
  const precio = calcularTotal(duracionId, cantidad);
  if (!precio) return res.status(400).json({ error: 'duracion_invalida' });

  if (!RE_FECHA.test(fecha)) return res.status(400).json({ error: 'fecha_invalida' });
  const hoy = hoyCancun();
  if (fecha < hoy) return res.status(400).json({ error: 'fecha_pasada' });
  const limite = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (fecha > limite) return res.status(400).json({ error: 'fecha_lejana' });

  if (!RE_HORA.test(hora)) return res.status(400).json({ error: 'hora_invalida' });

  if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 12) {
    return res.status(400).json({ error: 'cantidad_invalida' });
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
  if (!firma) return res.status(400).json({ error: 'firma_requerida' });
  if (normaliza(firma) !== normaliza(nombre)) {
    return res.status(400).json({ error: 'firma_no_coincide' });
  }
  if (b.aceptaTerminos !== true) return res.status(400).json({ error: 'terminos_no_aceptados' });

  const v = ventana(duracionId, fecha, hora);
  if (!v) return res.status(400).json({ error: 'ventana_invalida' });

  // Foto de identificación: OPCIONAL desde el 15-ago-26. El formulario en
  // producción (el de 728e6ae) no la pide, y exigirla aquí hacía fallar TODAS
  // las reservas con foto_requerida. El formulario nuevo sí la manda y se
  // guarda igual. Si viene pero no parsea, se avisa en vez de tirarla en
  // silencio: el cliente creería que la subió.
  let archivoId = null;
  if (b.foto) {
    archivoId = parseArchivo(b.foto, false);
    if (!archivoId) return res.status(400).json({ error: 'foto_invalida' });
  }

  // Foto de la reserva de hotel/Airbnb: OPCIONAL (decisión de María, 15-ago-26:
  // que no bloquee la reserva). Si vino pero no parsea, se avisa en vez de
  // tirarla en silencio — el cliente creería que la subió.
  let archivoReserva = null;
  if (b.fotoReserva) {
    archivoReserva = parseArchivo(b.fotoReserva, true);
    if (!archivoReserva) return res.status(400).json({ error: 'foto_reserva_invalida' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const ua = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const s = supa();

  try {
    // Se suben una sola vez con ruta propia (no atada al token de la reserva)
    // para no repetir la subida si el RPC reintenta por choque de token.
    let fotoPath = null;
    if (archivoId) {
      fotoPath = generarToken() + archivoId.ext;
      const { error: fotoError } = await s.storage
        .from('documentos-bicis')
        .upload(fotoPath, archivoId.buffer, { contentType: archivoId.contentType });
      if (fotoError) {
        console.error('crear:foto:', fotoError.message);
        return res.status(500).json({ error: 'error_interno' });
      }
    }

    // La de la reserva es opcional: si falla la subida NO se cae la reserva,
    // solo se queda sin ese adjunto. Perder la renta por una foto de cortesía
    // sería peor que no tenerla.
    let fotoReservaPath = null;
    if (archivoReserva) {
      const p = generarToken() + archivoReserva.ext;
      const { error: e2 } = await s.storage
        .from('documentos-bicis')
        .upload(p, archivoReserva.buffer, { contentType: archivoReserva.contentType });
      if (e2) console.error('crear:fotoReserva:', e2.message);
      else fotoReservaPath = p;
    }

    // Anti-abuso: cada inserción quema un folio público. Máx 5/hora por IP.
    if (ip) {
      const desde = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await s.from('reservas_bicis')
        .select('id', { count: 'exact', head: true })
        .eq('firma_ip', ip).gte('created_at', desde);
      if ((count || 0) >= 5) return res.status(429).json({ error: 'demasiadas_reservas' });
    }

    // Reintento solo por colisión de token (prob. ínfima, pero gratis).
    for (let intento = 0; intento < 3; intento++) {
      const token = generarToken();
      const payload = {
        token,
        idioma,
        canal: 'web',
        duracion_id: duracionId,
        duracion_nombre: precio.duracion.nombre[idioma],
        fecha_reserva: fecha,
        hora_inicio: hora,
        inicio: v.inicio.toISOString(),
        fin: v.fin.toISOString(),
        cantidad_bicis: cantidad,
        precio_unitario: precio.precioUnitario,
        total: precio.total,
        deposito_unitario: precio.depositoUnitario,
        // Se sellan SIEMPRE los dos montos, no solo el de la modalidad
        // elegida: si el mostrador la cambia, se cobra el precio que
        // estaba vigente cuando el cliente firmó, no el de hoy.
        garantia_tipo: garantiaTipo,
        deposito_tarjeta_unitario: precio.depositoTarjetaUnitario,
        nombre_completo: nombre,
        email,
        telefono: telefono || null,
        nacionalidad: nacionalidad || null,
        documento: documento || null,
        hotel: hotel || null,
        firma_nombre: firma,
        firma_ip: ip,
        firma_ua: ua,
        foto_id_path: fotoPath,
        foto_reserva_path: fotoReservaPath,
        expira_at: new Date(Date.now() + HOLD_MIN * 60 * 1000).toISOString()
      };

      const { data, error } = await s.rpc('crear_reserva_bici', { payload });

      if (error) {
        if (/duplicate|unique/i.test(error.message || '')) continue; // token chocó: otro intento
        console.error('crear_reserva_bici:', error.message);
        return res.status(500).json({ error: 'error_interno' });
      }
      if (data && data.ok === false) {
        return res.status(409).json({ error: data.error, disponibles: data.disponibles });
      }
      if (data && data.ok === true) {
        return res.status(200).json({
          folio: data.folio,
          folioLabel: 'WB-' + data.folio,
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
};
