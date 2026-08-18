// POST /api/crm/accion — TODAS las escrituras del CRM en una función
// (límite de functions de Vercel). switch sobre { accion, ... }.
// La matriz de transiciones vive AQUÍ: el navegador nunca manda un estado
// que el servidor acepte a ciegas. Cada acción deja rastro en crm_eventos.
const Stripe = require('stripe');
const { supa, leerJson } = require('../_lib/supabase.js');
const { verificarCRM } = require('../_lib/auth-crm.js');
const { esTokenValido, generarToken } = require('../_lib/token.js');
const { ventana } = require('../_lib/fechas.js');
const { calcularTotal } = require('../_lib/catalogo-bicis.js');
const { notificarReservaBici, notificarDuenoFlota } = require('../_lib/notificar-bici.js');

// Depósito de garantía vía Stripe (hold, capture_method: manual) — desde
// qué deposito_estado se puede volver a disparar 'autorizar_deposito', y
// desde cuáles se puede 'capturar'/'liberar'. Ver sql/reservas-bicis-deposito.sql.
const DEPOSITO_AUTORIZABLE = ['none', 'liberado', 'expirado', 'requiere_atencion'];
const DEPOSITO_RESOLVIBLE = ['autorizado', 'requiere_atencion'];

// Espacios/saltos de línea invisibles al copiar la clave desde el dashboard
// de Stripe rompen el header Authorization sin dar un error claro (Stripe
// SDK lo reporta como "connection error", no como credencial inválida) —
// .trim() por si acaso, es gratis y evita ese dolor de cabeza.
function stripeClient() {
  return new Stripe(String(process.env.STRIPE_SECRET_KEY || '').trim());
}

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

// Campos que 'editar' puede tocar. folio/token jamás (identidad de la
// reserva). deposito_total tampoco: es columna generada en Postgres
// (deposito_unitario * cantidad_bicis), se edita vía deposito_unitario.
const EDITABLES = [
  'nombre_completo', 'email', 'telefono', 'hotel', 'nacionalidad',
  'documento', 'notas_internas', 'fecha_reserva', 'hora_inicio'
];

// Campos de dinero: María pidió poder corregirlos a mano desde el CRM
// (decisión 17-ago-26, amplía el candado que antes lo prohibía). Se
// auditan aparte con el valor ANTERIOR y el NUEVO — no solo el nombre del
// campo — porque un error de tecleo en un monto es más caro que en un
// nombre.
const EDITABLES_DINERO = ['total', 'deposito_unitario', 'cargo_retraso', 'cargo_danos'];

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
        // Si se cancela con un hold de depósito activo, se libera solo
        // (best-effort: si Stripe falla aquí no se bloquea la cancelación,
        // el hold expira solo a los 7 días y queda auditado el intento).
        if (destino === 'cancelada' && r.deposito_estado === 'autorizado' && r.deposito_pi_id
            && process.env.STRIPE_SECRET_KEY) {
          try {
            const stripe = stripeClient();
            await stripe.paymentIntents.cancel(r.deposito_pi_id, { cancellation_reason: 'abandoned' });
            await s.from('reservas_bicis').update({
              deposito_estado: 'liberado', deposito_liberado_at: new Date().toISOString()
            }).eq('id', r.id);
          } catch (e) {
            console.error('estado: liberar deposito al cancelar:', e.message);
          }
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

      // ---- Depósito de garantía: autorizar el hold (Stripe Checkout,
      //      capture_method: manual). El staff la dispara al entregar la
      //      bici; el cliente teclea su tarjeta en la página de Stripe. ----
      case 'autorizar_deposito': {
        if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'stripe_no_configurado' });
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        if (!['pagada', 'en_curso'].includes(r.estado)) {
          return res.status(409).json({ error: 'estado_invalido' });
        }

        // Candado atómico anti-doble-clic: solo avanza si el depósito
        // sigue en un estado "libre para empezar". Cero filas = ya hay
        // uno en curso, no se llama a Stripe dos veces.
        const { data: claimada } = await s.from('reservas_bicis')
          .update({ deposito_estado: 'pendiente', updated_at: new Date().toISOString() })
          .eq('id', r.id).in('deposito_estado', DEPOSITO_AUTORIZABLE)
          .select('*').single();
        if (!claimada) return res.status(409).json({ error: 'deposito_ya_activo' });

        const site = process.env.SITE_URL || 'https://www.walkmetours.com';
        const cuponBase = `${site}/${r.idioma === 'en' ? 'cupon-en.html' : 'cupon.html'}?t=${r.token}`;
        try {
          const stripe = stripeClient();
          const params = {
            mode: 'payment',
            customer_creation: 'always',
            client_reference_id: r.token,
            payment_intent_data: {
              capture_method: 'manual',
              setup_future_usage: 'off_session',
              metadata: { tipo: 'deposito_bici', reserva_id: r.id, token: r.token, folio: String(r.folio) }
            },
            metadata: { tipo: 'deposito_bici', reserva_id: r.id, token: r.token, folio: String(r.folio) },
            line_items: [{
              quantity: 1,
              price_data: {
                currency: 'mxn',
                unit_amount: Math.round(Number(r.deposito_total) * 100),
                product_data: { name: `Depósito de garantía · Folio WB-${r.folio}` }
              }
            }],
            success_url: cuponBase + '&deposito=1',
            cancel_url: cuponBase + '&deposito=cancelado'
          };
          // customer_email vacío/null hace que Stripe rechace la sesión con
          // "Invalid email address" — solo se manda si de verdad hay una.
          if (r.email) params.customer_email = r.email;

          const session = await stripe.checkout.sessions.create(
            params, { idempotencyKey: `deposito-crear-${r.token}` }
          );

          await s.from('reservas_bicis')
            .update({ deposito_checkout_session_id: session.id, updated_at: new Date().toISOString() })
            .eq('id', r.id);
          await auditar(r.id, 'autorizar_deposito', { checkout_session_id: session.id, monto: r.deposito_total });
          return res.status(200).json({ ok: true, url: session.url });
        } catch (e) {
          // Stripe falló: no dejar la reserva atorada en 'pendiente' —
          // regresarla al estado que tenía antes de reclamarla.
          console.error('autorizar_deposito:', e.message);
          await s.from('reservas_bicis')
            .update({ deposito_estado: r.deposito_estado, updated_at: new Date().toISOString() })
            .eq('id', r.id);
          return res.status(502).json({ error: 'stripe_error' });
        }
      }

      // ---- Depósito: capturar (total o parcial — daño/atraso) ----
      case 'capturar_deposito': {
        if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'stripe_no_configurado' });
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        if (!DEPOSITO_RESOLVIBLE.includes(r.deposito_estado) || !r.deposito_pi_id) {
          return res.status(409).json({ error: 'deposito_estado_invalido' });
        }
        try {
          const stripe = stripeClient();
          const opts = {};
          if (b.monto != null) {
            const monto = Math.max(0, Number(b.monto) || 0);
            opts.amount_to_capture = Math.round(monto * 100);
          }
          const pi = await stripe.paymentIntents.capture(r.deposito_pi_id, opts);
          const capturado = (pi.amount_received || 0) / 100;
          await s.from('reservas_bicis').update({
            deposito_estado: 'capturado',
            deposito_capturado: capturado,
            deposito_capturado_at: new Date().toISOString(),
            deposito_ultimo_error: null,
            updated_at: new Date().toISOString()
          }).eq('id', r.id);
          await auditar(r.id, 'capturar_deposito', { monto: capturado, pi: r.deposito_pi_id });
          return res.status(200).json({ ok: true, capturado });
        } catch (e) {
          console.error('capturar_deposito:', e.message);
          return res.status(409).json({ error: 'stripe_captura_fallo' });
        }
      }

      // ---- Depósito: liberar sin cobrar (bici regresó bien) ----
      case 'liberar_deposito': {
        if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'stripe_no_configurado' });
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        if (!DEPOSITO_RESOLVIBLE.includes(r.deposito_estado) || !r.deposito_pi_id) {
          return res.status(409).json({ error: 'deposito_estado_invalido' });
        }
        const stripe = stripeClient();
        try {
          await stripe.paymentIntents.cancel(r.deposito_pi_id, { cancellation_reason: 'requested_by_customer' });
        } catch (e) {
          // Puede ya estar cancelado/capturado del lado de Stripe (replay,
          // expiración natural) — se sigue liberando en la DB igual.
          console.error('liberar_deposito: stripe cancel:', e.message);
        }
        await s.from('reservas_bicis').update({
          deposito_estado: 'liberado',
          deposito_liberado_at: new Date().toISOString(),
          deposito_ultimo_error: null,
          updated_at: new Date().toISOString()
        }).eq('id', r.id);
        await auditar(r.id, 'liberar_deposito', { pi: r.deposito_pi_id });
        return res.status(200).json({ ok: true });
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
        if (!cambios.nombre_completo && 'nombre_completo' in cambios) {
          return res.status(400).json({ error: 'nombre_requerido' });
        }

        // Montos: número finito ≥ 0. Sin tope arriba — es una corrección
        // manual, María sabe lo que está cobrando.
        const cambiosDinero = {};
        for (const k of EDITABLES_DINERO) {
          if (!(k in campos)) continue;
          const v = Number(campos[k]);
          if (!Number.isFinite(v) || v < 0) {
            return res.status(400).json({ error: 'monto_invalido', campo: k });
          }
          cambiosDinero[k] = v;
        }
        Object.assign(cambios, cambiosDinero);

        if (!Object.keys(cambios).length) return res.status(400).json({ error: 'sin_cambios' });

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

        // deposito_total es columna generada (deposito_unitario × cantidad);
        // si se corrige deposito_unitario o los cargos de una renta YA
        // cerrada, el devuelto queda obsoleto — se recalcula igual que en
        // 'cerrar', con el deposito_total NUEVO (Postgres ya lo recalculó
        // para `r` no, pero sí lo hará al hacer update — por eso se calcula
        // aquí a mano con el mismo deposito_unitario nuevo).
        if (r.cerrada_at && ('deposito_unitario' in cambiosDinero ||
            'cargo_retraso' in cambiosDinero || 'cargo_danos' in cambiosDinero)) {
          const depUnit = cambiosDinero.deposito_unitario ?? r.deposito_unitario;
          const cRetraso = cambiosDinero.cargo_retraso ?? r.cargo_retraso;
          const cDanos = cambiosDinero.cargo_danos ?? r.cargo_danos;
          cambios.deposito_devuelto = Math.max(0, depUnit * r.cantidad_bicis - cRetraso - cDanos);
        }

        cambios.updated_at = new Date().toISOString();
        await s.from('reservas_bicis').update(cambios).eq('id', r.id);

        // Auditoría: los campos normales solo registran el nombre; los
        // montos registran antes→después, porque un typo en un monto sale
        // caro y hay que poder revisarlo después.
        const detalleDinero = {};
        for (const k of Object.keys(cambiosDinero)) detalleDinero[k] = { antes: r[k], despues: cambiosDinero[k] };
        await auditar(r.id, 'editar', {
          campos: Object.keys(cambios).filter(k => !(k in cambiosDinero) && k !== 'updated_at'),
          dinero: Object.keys(detalleDinero).length ? detalleDinero : undefined
        });
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

      // ---- Avisar a un dueño de flota en consignación (por correo) ----
      case 'avisar_dueno': {
        const dueno = String(b.dueno || '').trim();
        if (!dueno) return res.status(400).json({ error: 'dueno_requerido' });
        const { data: bicis } = await s.from('bikes_flota')
          .select('id, estado, bateria, dueno_email').eq('dueno', dueno);
        if (!bicis || !bicis.length) return res.status(404).json({ error: 'dueno_sin_bicis' });
        const correo = bicis[0].dueno_email;
        const r = await notificarDuenoFlota(dueno, correo, bicis);
        if (!r.enviado) return res.status(409).json({ error: r.motivo });
        await auditar(null, 'avisar_dueno', { dueno, bicis: bicis.map(x => x.id) });
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
