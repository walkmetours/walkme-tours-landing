// POST /api/crm/accion — TODAS las escrituras del CRM en una función
// (límite de functions de Vercel). switch sobre { accion, ... }.
// La matriz de transiciones vive AQUÍ: el navegador nunca manda un estado
// que el servidor acepte a ciegas. Cada acción deja rastro en crm_eventos.
const { supa, leerJson } = require('../_lib/supabase.js');
const { verificarCRM } = require('../_lib/auth-crm.js');
const { esTokenValido, generarToken } = require('../_lib/token.js');
const { ventana } = require('../_lib/fechas.js');
const { calcularTotal } = require('../_lib/catalogo-bicis.js');
const { notificarReservaBici } = require('../_lib/notificar-bici.js');

// De qué estado a qué estados se puede pasar a mano desde el CRM.
// (pagada vía webhook no pasa por aquí.)
const TRANSICIONES = {
  pendiente_pago:     ['pendiente_efectivo', 'pagada', 'cancelada'],
  pendiente_efectivo: ['pagada', 'cancelada', 'no_show'],
  pagada:             ['en_curso', 'cancelada'],
  en_curso:           [], // en_curso → cerrada SOLO vía la acción 'cerrar'
  cerrada:            [],
  cancelada:          [],
  no_show:            []
};

// Campos que 'editar' puede tocar. folio/token/total jamás.
const EDITABLES = [
  'nombre_completo', 'email', 'telefono', 'hotel', 'nacionalidad',
  'documento', 'notas_internas', 'fecha_reserva', 'hora_inicio'
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const quien = await verificarCRM(req, res);
  if (!quien) return;

  const b = leerJson(req);
  const s = supa();

  async function auditar(reservaId, accion, detalle) {
    try {
      await s.from('crm_eventos').insert({ reserva_id: reservaId, actor: quien.email, accion, detalle });
    } catch (e) { console.error('auditoria:', e.message); }
  }

  async function cargarReserva(token) {
    if (!esTokenValido(String(token || '').toUpperCase())) return null;
    const { data } = await s.from('reservas_bicis').select('*')
      .eq('token', String(token).toUpperCase()).single();
    return data || null;
  }

  try {
    switch (b.accion) {

      // ---- Transición de estado validada ----
      case 'estado': {
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        const destino = String(b.estado || '');
        const permitidos = TRANSICIONES[r.estado] || [];
        if (!permitidos.includes(destino)) {
          return res.status(409).json({ error: 'transicion_invalida', desde: r.estado, hacia: destino });
        }
        if (destino === 'en_curso' && (!r.unidades || r.unidades.length === 0)) {
          return res.status(409).json({ error: 'sin_unidades_asignadas' });
        }

        const cambios = { estado: destino, updated_at: new Date().toISOString() };
        if (destino === 'pagada' && !r.pago_ts) {
          cambios.metodo_pago = 'efectivo';       // cobro en mostrador
          cambios.pago_ts = new Date().toISOString();
        }
        if (destino === 'pendiente_efectivo' || destino === 'pagada') cambios.expira_at = null;

        const { data: actualizada } = await s.from('reservas_bicis')
          .update(cambios).eq('id', r.id).select('*').single();
        if (destino === 'pagada' && actualizada) {
          await notificarReservaBici(actualizada, 'pagada'); // best-effort, nunca lanza
        }

        // La bici sale a la calle: sus unidades pasan a 'rentada' AHORA
        // (no al asignarlas — asignar a futuro no cambia la flota de hoy).
        if (destino === 'en_curso' && r.unidades.length) {
          await s.from('bikes_flota').update({ estado: 'rentada' }).in('id', r.unidades);
        }
        // Cancelación de una renta con unidades asignadas: liberarlas.
        if ((destino === 'cancelada' || destino === 'no_show') && r.unidades.length) {
          await s.from('bikes_flota').update({ estado: 'disponible' })
            .in('id', r.unidades).eq('estado', 'rentada');
        }

        await auditar(r.id, 'estado', { desde: r.estado, hacia: destino, nota: b.nota || null });
        return res.status(200).json({ ok: true, estado: destino });
      }

      // ---- Asignar unidades de la flota ----
      case 'unidades': {
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        if (['cerrada', 'cancelada', 'no_show'].includes(r.estado)) {
          return res.status(409).json({ error: 'estado_invalido' });
        }
        const unidades = Array.isArray(b.unidades) ? b.unidades.map(String) : [];
        if (unidades.length > r.cantidad_bicis) {
          return res.status(400).json({ error: 'demasiadas_unidades' });
        }
        if (unidades.length) {
          const { data: flota } = await s.from('bikes_flota').select('id').in('id', unidades);
          if (!flota || flota.length !== unidades.length) {
            return res.status(400).json({ error: 'unidad_inexistente' });
          }
          // Sin doble asignación: ninguna unidad puede estar en otra renta
          // abierta que solape la ventana de esta.
          const { data: choques } = await s.from('reservas_bicis')
            .select('folio, unidades')
            .neq('id', r.id)
            .in('estado', ['pendiente_efectivo', 'pagada', 'en_curso'])
            .lt('inicio', r.fin)
            .gt('fin', r.inicio)
            .overlaps('unidades', unidades);
          if (choques && choques.length) {
            return res.status(409).json({ error: 'unidad_ocupada', folios: choques.map(c => c.folio) });
          }
        }
        await s.from('reservas_bicis')
          .update({ unidades, updated_at: new Date().toISOString() }).eq('id', r.id);
        await auditar(r.id, 'unidades', { unidades });
        return res.status(200).json({ ok: true, unidades });
      }

      // ---- Cerrar renta (devolución) ----
      case 'cerrar': {
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        if (r.estado !== 'en_curso') return res.status(409).json({ error: 'estado_invalido' });

        const cargoRetraso = Math.max(0, Number(b.cargo_retraso) || 0);
        const cargoDanos = Math.max(0, Number(b.cargo_danos) || 0);
        const devuelto = Math.max(0, Number(r.deposito_total) - cargoRetraso - cargoDanos);

        await s.from('reservas_bicis').update({
          estado: 'cerrada',
          cargo_retraso: cargoRetraso,
          cargo_danos: cargoDanos,
          cargo_nota: b.nota || null,
          deposito_devuelto: devuelto,
          cerrada_at: new Date().toISOString(),
          cerrada_por: quien.email,
          updated_at: new Date().toISOString()
        }).eq('id', r.id);

        if (r.unidades && r.unidades.length) {
          await s.from('bikes_flota').update({ estado: 'disponible' }).in('id', r.unidades);
        }
        await auditar(r.id, 'cerrar', {
          cargo_retraso: cargoRetraso, cargo_danos: cargoDanos,
          deposito_devuelto: devuelto, nota: b.nota || null
        });
        return res.status(200).json({ ok: true, deposito_devuelto: devuelto });
      }

      // ---- Editar campos (whitelist) ----
      case 'editar': {
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        const campos = b.campos || {};
        const cambios = {};
        for (const k of EDITABLES) {
          if (k in campos) cambios[k] = campos[k] === '' ? null : campos[k];
        }
        if (!Object.keys(cambios).length) return res.status(400).json({ error: 'sin_cambios' });
        if (!cambios.nombre_completo && 'nombre_completo' in cambios) {
          return res.status(400).json({ error: 'nombre_requerido' });
        }

        // Cambiar fecha/hora recalcula la ventana (sin re-chequear
        // disponibilidad: la operadora sabe lo que hace — queda auditado).
        const nuevaFecha = cambios.fecha_reserva || r.fecha_reserva;
        const nuevaHora = (cambios.hora_inicio || String(r.hora_inicio)).slice(0, 5);
        if (cambios.fecha_reserva || cambios.hora_inicio) {
          const v = ventana(r.duracion_id, nuevaFecha, nuevaHora);
          if (!v) return res.status(400).json({ error: 'ventana_invalida' });
          cambios.inicio = v.inicio.toISOString();
          cambios.fin = v.fin.toISOString();
          cambios.hora_inicio = nuevaHora;
        }

        cambios.updated_at = new Date().toISOString();
        await s.from('reservas_bicis').update(cambios).eq('id', r.id);
        await auditar(r.id, 'editar', { campos: Object.keys(cambios) });
        return res.status(200).json({ ok: true });
      }

      // ---- Flota: editar/crear/borrar unidad ----
      case 'flota': {
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_requerido' });
        if (b.borrar === true) {
          await s.from('bikes_flota').delete().eq('id', id);
          await auditar(null, 'flota_borrar', { id });
          return res.status(200).json({ ok: true });
        }
        const cambios = {};
        if ('modelo' in b) cambios.modelo = String(b.modelo);
        if ('bateria' in b) cambios.bateria = Math.max(0, Math.min(100, parseInt(b.bateria, 10) || 0));
        if ('estado' in b) {
          if (!['disponible', 'rentada', 'cargando', 'mantenimiento'].includes(b.estado)) {
            return res.status(400).json({ error: 'estado_invalido' });
          }
          cambios.estado = b.estado;
        }
        if ('notas' in b) cambios.notas = b.notas || null;
        if ('dueno' in b) cambios.dueno = b.dueno || null;
        if ('orden' in b) cambios.orden = parseInt(b.orden, 10) || 0;

        const { data: existe } = await s.from('bikes_flota').select('id').eq('id', id).single();
        if (existe) {
          await s.from('bikes_flota').update(cambios).eq('id', id);
        } else {
          await s.from('bikes_flota').insert({ id, ...cambios });
        }
        await auditar(null, 'flota', { id, ...cambios });
        return res.status(200).json({ ok: true });
      }

      // ---- Renta de mostrador (walk-in) ----
      case 'renta_mostrador': {
        const precio = calcularTotal(String(b.duracionId || ''), b.cantidad);
        if (!precio) return res.status(400).json({ error: 'duracion_invalida' });
        const nombre = String(b.nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'nombre_requerido' });
        const v = ventana(String(b.duracionId), String(b.fecha || ''), String(b.hora || ''));
        if (!v) return res.status(400).json({ error: 'ventana_invalida' });

        const token = generarToken();
        const payload = {
          token,
          idioma: b.idioma === 'en' ? 'en' : 'es',
          canal: 'mostrador',
          duracion_id: String(b.duracionId),
          duracion_nombre: precio.duracion.nombre[b.idioma === 'en' ? 'en' : 'es'],
          fecha_reserva: String(b.fecha),
          hora_inicio: String(b.hora),
          inicio: v.inicio.toISOString(),
          fin: v.fin.toISOString(),
          cantidad_bicis: parseInt(b.cantidad, 10),
          precio_unitario: precio.precioUnitario,
          total: precio.total,
          deposito_unitario: precio.depositoUnitario,
          nombre_completo: nombre,
          email: String(b.email || '').trim(),
          telefono: String(b.telefono || '').trim(),
          firma_nombre: nombre,               // en mostrador firma el contrato en papel
          terminos_version: 'bici-v1-2026-08',
          estado: 'pendiente_efectivo',       // walk-in: paga en el momento
          expira_at: null,
          forzar: b.forzar === true           // saltar disponibilidad si María sabe que una bici volvió
        };

        const { data, error } = await s.rpc('crear_reserva_bici', { payload });
        if (error) {
          console.error('renta_mostrador:', error.message);
          return res.status(500).json({ error: 'error_interno' });
        }
        if (data && data.ok === false) {
          return res.status(409).json({ error: data.error, disponibles: data.disponibles });
        }
        await auditar(null, 'renta_mostrador', { folio: data.folio, forzar: b.forzar === true });
        // Walk-in: cupón por email solo si el cliente dejó correo.
        // (La agencia está en el mostrador; el módulo omite avisos internos.)
        if (payload.email) {
          const { data: nueva } = await s.from('reservas_bicis')
            .select('*').eq('token', data.token).single();
          if (nueva) await notificarReservaBici(nueva, 'mostrador');
        }
        return res.status(200).json({ ok: true, folio: data.folio, token: data.token });
      }

      default:
        return res.status(400).json({ error: 'accion_invalida' });
    }
  } catch (e) {
    console.error('crm/accion:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
