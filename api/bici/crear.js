// POST /api/bici/crear — crea la reserva de bici y devuelve folio + token.
// El total SIEMPRE se recalcula aquí desde el catálogo; disponibilidad y
// creación son atómicas en el RPC crear_reserva_bici (advisory lock).
//
// Body: { idioma, duracionId, fecha, hora, cantidad, nombre, email,
//         telefono?, firma, aceptaTerminos, hp }
// 200 → { folio, folioLabel, token, total, moneda }
// 409 → { error:'sin_disponibilidad', disponibles:N }
const { supa, leerJson } = require('../_lib/supabase.js');
const { generarToken } = require('../_lib/token.js');
const { ventana, hoyCancun, RE_FECHA, RE_HORA } = require('../_lib/fechas.js');
const { calcularTotal } = require('../_lib/catalogo-bicis.js');

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HOLD_MIN = 30; // minutos de hold para pendiente_pago

// Compara firma≈nombre ignorando acentos, mayúsculas y espacios extra.
function normaliza(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'reservas_no_configuradas' });
  }

  const b = leerJson(req);

  // Honeypot: los bots lo llenan, los humanos no lo ven. Éxito falso para
  // no darles señal — y sin quemar un folio.
  if (b.hp) return res.status(200).json({ folio: 0, token: '', total: 0, moneda: 'MXN' });

  const idioma = b.idioma === 'en' ? 'en' : 'es';
  const duracionId = String(b.duracionId || '');
  const fecha = String(b.fecha || '');
  const hora = String(b.hora || '');
  const cantidad = parseInt(b.cantidad, 10);
  const nombre = String(b.nombre || '').trim();
  const email = String(b.email || '').trim();
  const telefono = String(b.telefono || '').replace(/[^\d+]/g, '');
  const firma = String(b.firma || '').trim();

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

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const ua = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const s = supa();

  try {
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
        nombre_completo: nombre,
        email,
        telefono: telefono || null,
        firma_nombre: firma,
        firma_ip: ip,
        firma_ua: ua,
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
