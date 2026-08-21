// POST /api/crm/accion — TODAS las escrituras del CRM en una función
// (límite de functions de Vercel). switch sobre { accion, ... }.
// La matriz de transiciones vive AQUÍ: el navegador nunca manda un estado
// que el servidor acepte a ciegas. Cada acción deja rastro en crm_eventos.
const Stripe = require('stripe');
const { supa, leerJson } = require('../_lib/supabase.js');
const { verificarCRM } = require('../_lib/auth-crm.js');
const { esTokenValido, generarToken } = require('../_lib/token.js');
const { ventana, instante, RE_FECHA } = require('../_lib/fechas.js');
const { calcularTotal } = require('../_lib/catalogo-bicis.js');
const { notificarReservaBici, notificarDuenoFlota } = require('../_lib/notificar-bici.js');

// Depósito de garantía vía Stripe (hold, capture_method: manual) — desde
// qué deposito_estado se puede volver a disparar 'autorizar_deposito', y
// desde cuáles se puede 'capturar'/'liberar'. Ver sql/reservas-bicis-deposito.sql.
const DEPOSITO_AUTORIZABLE = ['none', 'liberado', 'expirado', 'requiere_atencion'];
const DEPOSITO_RESOLVIBLE = ['autorizado', 'requiere_atencion'];

// Modalidad de garantía (19-ago-26, ver sql/reservas-bicis-garantia.sql):
// 'efectivo' = dinero en el mostrador + identificación en resguardo,
// 'tarjeta'  = hold de Stripe y ningún documento retenido.
const GARANTIA_ID_TIPOS = ['ine', 'licencia', 'pasaporte', 'otro'];

function esTarjeta(r) { return (r.garantia_tipo || 'efectivo') === 'tarjeta'; }

// Tope de captura: lo que Stripe autorizó DE VERDAD, no lo que hoy dice el
// catálogo. Los holds creados antes de esta migración no tienen ese dato y
// se hicieron por deposito_total — ofrecer capturar más rebotaría en Stripe.
function montoHold(r) {
  const m = r.deposito_autorizado_monto;
  return Number(m == null ? r.deposito_total : m);
}

// ¿Queda un documento del cliente en el cajón? Es la pregunta que no se
// puede olvidar antes de cerrar o cancelar una renta.
function idEnResguardo(r) {
  return !!r.garantia_id_retenido_at && !r.garantia_id_devuelto_at;
}

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
const EDITABLES_DINERO = [
  'total', 'deposito_unitario', 'deposito_tarjeta_unitario',
  'deposito_efectivo_recibido', 'cargo_retraso', 'cargo_danos'
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

  // El movimiento de dinero del hold vive en estos dos helpers y no en tres
  // copias: los usan 'capturar_deposito', 'liberar_deposito' y 'cerrar'.
  async function capturarHold(r, monto) {
    const stripe = stripeClient();
    const opts = {};
    if (monto != null) opts.amount_to_capture = Math.round(Number(monto) * 100);
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
    return capturado;
  }

  async function liberarHold(r) {
    const stripe = stripeClient();
    try {
      await stripe.paymentIntents.cancel(r.deposito_pi_id, { cancellation_reason: 'requested_by_customer' });
    } catch (e) {
      // Puede ya estar cancelado/capturado del lado de Stripe (replay,
      // expiración natural) — se sigue liberando en la DB igual.
      console.error('liberarHold: stripe cancel:', e.message);
    }
    await s.from('reservas_bicis').update({
      deposito_estado: 'liberado',
      deposito_liberado_at: new Date().toISOString(),
      deposito_ultimo_error: null,
      updated_at: new Date().toISOString()
    }).eq('id', r.id);
    await auditar(r.id, 'liberar_deposito', { pi: r.deposito_pi_id });
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
        // Una renta no se cancela con el pasaporte del cliente todavía en
        // el cajón: después de cancelarla nada en el CRM lo recuerda.
        if ((destino === 'cancelada' || destino === 'no_show')
            && idEnResguardo(r) && b.id_devuelto !== true) {
          return res.status(409).json({ error: 'id_en_resguardo', tipo: r.garantia_id_tipo });
        }

        const cambios = { estado: destino, updated_at: new Date().toISOString() };
        if (idEnResguardo(r) && b.id_devuelto === true) {
          cambios.garantia_id_devuelto_at = new Date().toISOString();
          cambios.garantia_id_devuelto_por = quien.email;
        }
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
        if (destino === 'cancelada' && esTarjeta(r) && r.deposito_estado === 'autorizado'
            && r.deposito_pi_id && process.env.STRIPE_SECRET_KEY) {
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

        // El documento del cliente no se queda en el cajón de una renta ya
        // cerrada: si hay uno en resguardo, hay que confirmar que se devolvió.
        if (idEnResguardo(r) && b.id_devuelto !== true) {
          return res.status(409).json({ error: 'id_en_resguardo', tipo: r.garantia_id_tipo });
        }

        const cargoRetraso = Math.max(0, Number(b.cargo_retraso) || 0);
        const cargoDanos = Math.max(0, Number(b.cargo_danos) || 0);

        // Devolver efectivo y liberar un hold NO son la misma operación.
        // En tarjeta no se devuelve nada: se captura una parte y el resto
        // lo suelta el banco. deposito_devuelto queda null (no 0: cero
        // significaría "me quedé con todo") para no inflar ningún reporte.
        const tarjeta = esTarjeta(r);
        const baseEfectivo = Number(
          r.deposito_efectivo_recibido == null ? r.deposito_total : r.deposito_efectivo_recibido
        );
        const devuelto = tarjeta ? null : Math.max(0, baseEfectivo - cargoRetraso - cargoDanos);

        const cambios = {
          estado: 'cerrada',
          cargo_retraso: cargoRetraso,
          cargo_danos: cargoDanos,
          cargo_nota: b.nota || null,
          deposito_devuelto: devuelto,
          cerrada_at: new Date().toISOString(),
          cerrada_por: quien.email,
          updated_at: new Date().toISOString()
        };
        if (idEnResguardo(r)) {
          cambios.garantia_id_devuelto_at = new Date().toISOString();
          cambios.garantia_id_devuelto_por = quien.email;
        }
        await s.from('reservas_bicis').update(cambios).eq('id', r.id);

        if (r.unidades && r.unidades.length) {
          await s.from('bikes_flota').update({ estado: 'disponible' }).in('id', r.unidades);
        }
        await auditar(r.id, 'cerrar', {
          cargo_retraso: cargoRetraso, cargo_danos: cargoDanos,
          garantia_tipo: r.garantia_tipo, deposito_devuelto: devuelto,
          id_devuelto: idEnResguardo(r) || undefined, nota: b.nota || null
        });

        // Cerrar NO mueve dinero en Stripe: la captura sigue siendo una
        // acción humana explícita. Se le dice al CRM cuál es el paso que
        // falta para que lo encadene sin que nadie tenga que acordarse.
        const pendienteDeposito = tarjeta && DEPOSITO_RESOLVIBLE.includes(r.deposito_estado)
          ? ((cargoRetraso + cargoDanos) > 0 ? 'capturar' : 'liberar')
          : null;
        return res.status(200).json({
          ok: true,
          deposito_devuelto: devuelto,
          pendiente_deposito: pendienteDeposito,
          monto_a_capturar: pendienteDeposito === 'capturar' ? cargoRetraso + cargoDanos : null
        });
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
        // El hold solo existe en la modalidad de tarjeta. Si el cliente
        // reservó en efectivo y llegó sin dinero, primero se cambia la
        // modalidad (acción 'garantia_tipo'): así nunca hay efectivo
        // cobrado Y dinero apartado en la tarjeta por la misma renta.
        if (!esTarjeta(r)) return res.status(409).json({ error: 'garantia_no_es_tarjeta' });

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
        const montoHoldCentavos = Math.round(Number(r.deposito_tarjeta_total) * 100);
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
                unit_amount: montoHoldCentavos,
                product_data: { name: `Depósito de garantía · Folio WB-${r.folio}` }
              }
            }],
            success_url: cuponBase + '&deposito=1',
            cancel_url: cuponBase + '&deposito=cancelado'
          };
          // customer_email vacío/null hace que Stripe rechace la sesión con
          // "Invalid email address" — solo se manda si de verdad hay una.
          if (r.email) params.customer_email = r.email;

          // La llave incluye el MONTO. Keyeada solo por token, un segundo
          // intento con otro importe (cambió el precio, o se liberó el
          // hold y se rehace) hace que Stripe replaye la sesión vieja o
          // falle duro con "same parameters". Es dinero real.
          const session = await stripe.checkout.sessions.create(
            params, { idempotencyKey: `deposito-crear-${r.token}-${montoHoldCentavos}` }
          );

          await s.from('reservas_bicis')
            .update({
              deposito_checkout_session_id: session.id,
              deposito_autorizado_monto: Number(r.deposito_tarjeta_total),
              updated_at: new Date().toISOString()
            })
            .eq('id', r.id);
          await auditar(r.id, 'autorizar_deposito', {
            checkout_session_id: session.id, monto: r.deposito_tarjeta_total
          });
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
        if (!esTarjeta(r)) return res.status(409).json({ error: 'garantia_no_es_tarjeta' });
        if (!DEPOSITO_RESOLVIBLE.includes(r.deposito_estado) || !r.deposito_pi_id) {
          return res.status(409).json({ error: 'deposito_estado_invalido' });
        }
        // Tope explícito contra el monto autorizado: un typo de más
        // rebotaría en Stripe con un error opaco a media operación.
        let monto = null;
        if (b.monto != null) {
          monto = Math.max(0, Number(b.monto) || 0);
          const tope = montoHold(r);
          if (monto > tope) return res.status(400).json({ error: 'monto_mayor_al_hold', maximo: tope });
        }
        try {
          const capturado = await capturarHold(r, monto);
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
        if (!esTarjeta(r)) return res.status(409).json({ error: 'garantia_no_es_tarjeta' });
        if (!DEPOSITO_RESOLVIBLE.includes(r.deposito_estado) || !r.deposito_pi_id) {
          return res.status(409).json({ error: 'deposito_estado_invalido' });
        }
        await liberarHold(r);
        return res.status(200).json({ ok: true });
      }

      // ---- Garantía: cambiar de modalidad en el mostrador ----
      //      El cliente eligió en línea, pero llegó sin efectivo o sin la
      //      tarjeta. Nunca puede haber las dos garantías vivas a la vez.
      case 'garantia_tipo': {
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        const tipo = b.tipo === 'tarjeta' ? 'tarjeta' : 'efectivo';
        if (['cerrada', 'cancelada', 'no_show'].includes(r.estado)) {
          return res.status(409).json({ error: 'estado_invalido' });
        }
        if (tipo === (r.garantia_tipo || 'efectivo')) {
          return res.status(200).json({ ok: true, garantia_tipo: tipo, sin_cambio: true });
        }
        // Con dinero apartado en la tarjeta, primero se libera: si no,
        // quedaría un hold vivo en la tarjeta de alguien que ya pagó en
        // efectivo, y nadie volvería a esa pantalla a soltarlo.
        if (esTarjeta(r) && ['pendiente', 'autorizado'].includes(r.deposito_estado)) {
          return res.status(409).json({ error: 'hold_activo' });
        }
        // Al revés: pasar a tarjeta con la identificación todavía en el
        // cajón exige devolverla primero.
        if (tipo === 'tarjeta' && idEnResguardo(r) && b.id_devuelto !== true) {
          return res.status(409).json({ error: 'id_en_resguardo', tipo: r.garantia_id_tipo });
        }

        const cambios = { garantia_tipo: tipo, updated_at: new Date().toISOString() };
        if (tipo === 'tarjeta' && idEnResguardo(r)) {
          cambios.garantia_id_devuelto_at = new Date().toISOString();
          cambios.garantia_id_devuelto_por = quien.email;
        }
        await s.from('reservas_bicis').update(cambios).eq('id', r.id);
        await auditar(r.id, 'garantia_tipo', { antes: r.garantia_tipo || 'efectivo', despues: tipo });
        return res.status(200).json({ ok: true, garantia_tipo: tipo });
      }

      // ---- Garantía en efectivo: registrar el dinero y la identificación
      //      que quedan en el mostrador. Es el equivalente de
      //      'autorizar_deposito' para la modalidad de efectivo. ----
      case 'deposito_efectivo': {
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        if (esTarjeta(r)) return res.status(409).json({ error: 'garantia_no_es_efectivo' });
        if (!['pagada', 'en_curso'].includes(r.estado)) {
          return res.status(409).json({ error: 'estado_invalido' });
        }
        const idTipo = String(b.id_tipo || '');
        if (!GARANTIA_ID_TIPOS.includes(idTipo)) {
          return res.status(400).json({ error: 'id_tipo_invalido' });
        }
        const monto = b.monto == null ? Number(r.deposito_total) : Math.max(0, Number(b.monto) || 0);
        if (!Number.isFinite(monto)) return res.status(400).json({ error: 'monto_invalido' });

        const ahora = new Date().toISOString();
        await s.from('reservas_bicis').update({
          deposito_estado: 'autorizado',       // mismo chip que el hold: "la garantía está puesta"
          deposito_autorizado_at: ahora,
          deposito_efectivo_recibido: monto,
          garantia_id_tipo: idTipo,
          garantia_id_detalle: String(b.id_detalle || '').trim().slice(0, 120) || null,
          garantia_id_retenido_at: ahora,
          garantia_id_retenido_por: quien.email,
          garantia_id_devuelto_at: null,
          garantia_id_devuelto_por: null,
          updated_at: ahora
        }).eq('id', r.id);
        await auditar(r.id, 'deposito_efectivo', { monto, id_tipo: idTipo });
        return res.status(200).json({ ok: true, monto, id_tipo: idTipo });
      }

      // ---- Garantía en efectivo: devolver la identificación sin cerrar
      //      la renta (p. ej. el cliente la necesita a medio alquiler) ----
      case 'devolver_id': {
        const r = await cargarReserva(b.token);
        if (!r) return res.status(404).json({ error: 'reserva_no_encontrada' });
        if (!idEnResguardo(r)) return res.status(409).json({ error: 'sin_id_en_resguardo' });
        await s.from('reservas_bicis').update({
          garantia_id_devuelto_at: new Date().toISOString(),
          garantia_id_devuelto_por: quien.email,
          updated_at: new Date().toISOString()
        }).eq('id', r.id);
        await auditar(r.id, 'devolver_id', { tipo: r.garantia_id_tipo });
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
        // Con un hold vivo en Stripe, mover el monto de la retención deja
        // a la base diciendo un número y a Stripe reteniendo otro. Primero
        // se libera el hold, luego se corrige, luego se vuelve a autorizar.
        if ('deposito_tarjeta_unitario' in cambiosDinero
            && ['pendiente', 'autorizado'].includes(r.deposito_estado)) {
          return res.status(409).json({ error: 'hold_activo' });
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
        // Solo aplica en efectivo: en tarjeta deposito_devuelto es null a
        // propósito (no se devuelve dinero, se libera un hold).
        if (!esTarjeta(r) && r.cerrada_at &&
            ('deposito_unitario' in cambiosDinero || 'deposito_efectivo_recibido' in cambiosDinero ||
             'cargo_retraso' in cambiosDinero || 'cargo_danos' in cambiosDinero)) {
          const depUnit = cambiosDinero.deposito_unitario ?? r.deposito_unitario;
          const recibido = cambiosDinero.deposito_efectivo_recibido ?? r.deposito_efectivo_recibido;
          const base = recibido == null ? depUnit * r.cantidad_bicis : Number(recibido);
          const cRetraso = cambiosDinero.cargo_retraso ?? r.cargo_retraso;
          const cDanos = cambiosDinero.cargo_danos ?? r.cargo_danos;
          cambios.deposito_devuelto = Math.max(0, base - cRetraso - cDanos);
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
          garantia_tipo: b.garantiaTipo === 'tarjeta' ? 'tarjeta' : 'efectivo',
          deposito_tarjeta_unitario: precio.depositoTarjetaUnitario,
          nombre_completo: nombre,
          email: String(b.email || '').trim(),
          telefono: String(b.telefono || '').trim(),
          firma_nombre: nombre,               // en mostrador firma el contrato en papel
          terminos_version: 'bici-v2-2026-08',
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

      // ==========================================================
      // Cotizaciones (sql/cotizaciones.sql) — Fase 3, 17-ago-26.
      // Mismo archivo/función que todo lo demás del CRM (límite de
      // functions del plan Hobby de Vercel, ya está en el tope).
      // ==========================================================

      case 'cotizacion_crear': {
        const clienteNombre = String(b.cliente_nombre || '').trim();
        if (!clienteNombre) return res.status(400).json({ error: 'cliente_requerido' });
        const items = Array.isArray(b.items) ? b.items : [];
        if (!items.length) return res.status(400).json({ error: 'sin_items' });
        for (const it of items) {
          if (!it.servicio_nombre || !Number.isFinite(Number(it.precio_adulto))) {
            return res.status(400).json({ error: 'item_invalido' });
          }
        }

        const { data: cot, error: eCot } = await s.from('cotizaciones').insert({
          estado: 'borrador',
          origen: 'crm',
          idioma: b.idioma === 'en' ? 'en' : 'es',
          cliente_nombre: clienteNombre,
          cliente_tel: b.cliente_tel || null,
          cliente_email: b.cliente_email || null,
          descuento: Math.max(0, Number(b.descuento) || 0),
          notas: b.notas || null,
          creado_por: quien.email
        }).select('*').single();
        if (eCot) { console.error('cotizacion_crear:', eCot.message); return res.status(500).json({ error: 'error_interno' }); }

        const filas = items.map((it, i) => ({
          cotizacion_id: cot.id,
          servicio_id: it.servicio_id || null,
          servicio_nombre: String(it.servicio_nombre).trim(),
          fecha: it.fecha || null,
          zona: it.zona || null,
          nacionalidad: it.nacionalidad === 'nacional' ? 'nacional' : 'extranjero',
          adultos: Math.max(0, parseInt(it.adultos, 10) || 0),
          menores: Math.max(0, parseInt(it.menores, 10) || 0),
          precio_adulto: Number(it.precio_adulto) || 0,
          precio_menor: Number(it.precio_menor) || 0,
          operador_id: it.operador_id || null,
          orden: i
        }));
        const { error: eItems } = await s.from('cotizacion_items').insert(filas);
        if (eItems) { console.error('cotizacion_crear:items:', eItems.message); return res.status(500).json({ error: 'error_interno' }); }

        await auditar(null, 'cotizacion_crear', { folio: cot.folio, items: filas.length });
        return res.status(200).json({ ok: true, folio: cot.folio, id: cot.id });
      }

      // ---- Editar cliente/notas/descuento de una cotización en borrador ----
      case 'cotizacion_editar': {
        const id = String(b.id || '');
        const { data: cot } = await s.from('cotizaciones').select('*').eq('id', id).single();
        if (!cot) return res.status(404).json({ error: 'cotizacion_no_encontrada' });
        if (cot.estado !== 'borrador') return res.status(409).json({ error: 'solo_editable_en_borrador' });

        const cambios = {};
        if ('cliente_nombre' in b) {
          const v = String(b.cliente_nombre || '').trim();
          if (!v) return res.status(400).json({ error: 'cliente_requerido' });
          cambios.cliente_nombre = v;
        }
        ['cliente_tel', 'cliente_email', 'notas'].forEach(k => { if (k in b) cambios[k] = b[k] || null; });
        if ('descuento' in b) cambios.descuento = Math.max(0, Number(b.descuento) || 0);
        if (!Object.keys(cambios).length) return res.status(400).json({ error: 'sin_cambios' });

        cambios.updated_at = new Date().toISOString();
        await s.from('cotizaciones').update(cambios).eq('id', id);

        if (Array.isArray(b.items)) {
          await s.from('cotizacion_items').delete().eq('cotizacion_id', id);
          const filas = b.items.map((it, i) => ({
            cotizacion_id: id,
            servicio_id: it.servicio_id || null,
            servicio_nombre: String(it.servicio_nombre || '').trim(),
            fecha: it.fecha || null,
            zona: it.zona || null,
            nacionalidad: it.nacionalidad === 'nacional' ? 'nacional' : 'extranjero',
            adultos: Math.max(0, parseInt(it.adultos, 10) || 0),
            menores: Math.max(0, parseInt(it.menores, 10) || 0),
            precio_adulto: Number(it.precio_adulto) || 0,
            precio_menor: Number(it.precio_menor) || 0,
            operador_id: it.operador_id || null,
            orden: i
          }));
          if (filas.length) await s.from('cotizacion_items').insert(filas);
        }

        await auditar(null, 'cotizacion_editar', { id, campos: Object.keys(cambios) });
        return res.status(200).json({ ok: true });
      }

      // ---- Transición de estado de una cotización ----
      case 'cotizacion_estado': {
        const COT_TRANSICIONES = {
          borrador: ['enviada', 'cancelada'],
          enviada: ['borrador', 'aceptada', 'cancelada'],
          aceptada: [],
          cancelada: [],
          expirada: ['borrador']
        };
        const id = String(b.id || '');
        const { data: cot } = await s.from('cotizaciones').select('*').eq('id', id).single();
        if (!cot) return res.status(404).json({ error: 'cotizacion_no_encontrada' });
        const destino = String(b.estado || '');
        if (!(COT_TRANSICIONES[cot.estado] || []).includes(destino)) {
          return res.status(409).json({ error: 'transicion_invalida', desde: cot.estado, hacia: destino });
        }
        await s.from('cotizaciones')
          .update({ estado: destino, updated_at: new Date().toISOString() }).eq('id', id);
        await auditar(null, 'cotizacion_estado', { id, folio: cot.folio, desde: cot.estado, hacia: destino });
        return res.status(200).json({ ok: true, estado: destino });
      }

      // ---- Tarifario: servicio (tour/parque) ----
      case 'servicio_guardar': {
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_requerido' });
        const nombre = String(b.nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'nombre_requerido' });
        const fila = {
          id, nombre,
          categoria: b.categoria || 'tour',
          activo: b.activo !== false,
          orden: parseInt(b.orden, 10) || 0,
          updated_at: new Date().toISOString()
        };
        await s.from('catalogo_servicios').upsert(fila);
        await auditar(null, 'servicio_guardar', { id });
        return res.status(200).json({ ok: true });
      }

      // ---- Tarifario: precio de venta por zona/nacionalidad ----
      case 'tarifa_guardar': {
        const servicioId = String(b.servicio_id || '').trim();
        const zona = String(b.zona || '').trim();
        if (!servicioId || !zona) return res.status(400).json({ error: 'servicio_y_zona_requeridos' });
        const precioAdulto = Number(b.precio_adulto);
        if (!Number.isFinite(precioAdulto) || precioAdulto < 0) {
          return res.status(400).json({ error: 'precio_invalido' });
        }
        await s.from('servicio_tarifas').upsert({
          servicio_id: servicioId,
          zona,
          nacionalidad: b.nacionalidad === 'nacional' ? 'nacional' : 'extranjero',
          precio_adulto: precioAdulto,
          precio_menor: b.precio_menor === '' || b.precio_menor == null ? null : Number(b.precio_menor),
          vigente: b.vigente !== false,
          updated_at: new Date().toISOString()
        }, { onConflict: 'servicio_id,zona,nacionalidad' });
        await auditar(null, 'tarifa_guardar', { servicioId, zona });
        return res.status(200).json({ ok: true });
      }

      // ---- Operadores: directorio ----
      case 'operador_guardar': {
        const nombre = String(b.nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'nombre_requerido' });
        const fila = {
          nombre, contacto: b.contacto || null, telefono: b.telefono || null,
          notas: b.notas || null, activo: b.activo !== false,
          updated_at: new Date().toISOString()
        };
        if (b.id) {
          await s.from('operadores').update(fila).eq('id', b.id);
        } else {
          await s.from('operadores').insert(fila);
        }
        await auditar(null, 'operador_guardar', { id: b.id || 'nuevo', nombre });
        return res.status(200).json({ ok: true });
      }

      // ---- Operadores: costo neto por servicio ----
      case 'oferta_guardar': {
        const operadorId = String(b.operador_id || '').trim();
        const servicioId = String(b.servicio_id || '').trim();
        if (!operadorId || !servicioId) return res.status(400).json({ error: 'operador_y_servicio_requeridos' });
        const netoAdulto = Number(b.neto_adulto);
        if (!Number.isFinite(netoAdulto) || netoAdulto < 0) {
          return res.status(400).json({ error: 'neto_invalido' });
        }
        await s.from('operador_ofertas').upsert({
          operador_id: operadorId,
          servicio_id: servicioId,
          neto_adulto: netoAdulto,
          neto_menor: b.neto_menor === '' || b.neto_menor == null ? null : Number(b.neto_menor),
          vigente: b.vigente !== false,
          updated_at: new Date().toISOString()
        }, { onConflict: 'operador_id,servicio_id' });
        await auditar(null, 'oferta_guardar', { operadorId, servicioId });
        return res.status(200).json({ ok: true });
      }

      // ---- Reportes de bicis: agregados por rango de fechas ----
      // Vive aquí (no en tablero.js) porque tablero.js recorta a 60
      // días/200 filas para la vista operativa del día a día — un reporte
      // necesita poder mirar más atrás. Es de solo lectura pero comparte
      // este switch por el límite de functions de Vercel Hobby.
      case 'reportes_bicis': {
        const desde = String(b.desde || '');
        const hasta = String(b.hasta || '');
        if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta) || desde > hasta) {
          return res.status(400).json({ error: 'rango_invalido' });
        }
        const desdeTs = instante(desde, '00:00');
        const hastaTs = new Date(instante(hasta, '00:00').getTime() + 24 * 3600 * 1000);
        const desdeISO = desdeTs.toISOString();
        const hastaISO = hastaTs.toISOString();

        const [rentasQ, flotaQ] = await Promise.all([
          s.from('reservas_bicis').select('*')
            .lt('inicio', hastaISO).gt('fin', desdeISO)
            .not('estado', 'in', '(cancelada,no_show)'),
          s.from('bikes_flota').select('id').neq('estado', 'mantenimiento')
        ]);
        if (rentasQ.error) throw new Error(rentasQ.error.message);
        if (flotaQ.error) throw new Error(flotaQ.error.message);
        const rentas = rentasQ.data || [];
        const capacidad = (flotaQ.data || []).length || 6;

        // Ingresos de la renta (NO la garantía): solo lo que de verdad se
        // cobró dentro del rango, según pago_ts — no según cuándo se creó
        // la reserva ni cuándo empieza la renta.
        const ingresos = { efectivo: 0, stripe: 0, mercadopago: 0 };
        rentas.forEach(r => {
          if (!r.pago_ts || r.pago_ts < desdeISO || r.pago_ts >= hastaISO) return;
          const monto = Number(r.total) || 0;
          if (r.metodo_pago === 'efectivo') ingresos.efectivo += monto;
          else if (r.metodo_pago === 'stripe') ingresos.stripe += monto;
          else if (r.metodo_pago === 'mercadopago') ingresos.mercadopago += monto;
        });
        ingresos.total = ingresos.efectivo + ingresos.stripe + ingresos.mercadopago;

        // Ocupación: días-bici rentados (solo la porción de cada renta que
        // cae dentro del rango) sobre días-bici disponibles del rango.
        const msDesde = desdeTs.getTime(), msHasta = hastaTs.getTime();
        const diasRango = (msHasta - msDesde) / 86400000;
        let diasBiciRentados = 0;
        rentas.forEach(r => {
          const ini = Math.max(Date.parse(r.inicio), msDesde);
          const fin = Math.min(Date.parse(r.fin), msHasta);
          if (fin > ini) diasBiciRentados += ((fin - ini) / 86400000) * r.cantidad_bicis;
        });
        const diasBiciDisponibles = capacidad * diasRango;

        // Garantías: efectivo (mostrador) y tarjeta (hold de Stripe) NUNCA
        // se suman entre sí — son dos canales de dinero distintos (ver
        // advertencias en sql/reservas-bicis-garantia.sql).
        let efectivoRetenido = 0, efectivoSinDevolver = 0, idsSinDevolver = 0, capturadoStripe = 0;
        const holdsPorEstado = { pendiente: 0, autorizado: 0, capturado: 0, liberado: 0, expirado: 0, requiere_atencion: 0 };
        rentas.forEach(r => {
          if ((r.garantia_tipo || 'efectivo') === 'efectivo') {
            if (r.deposito_efectivo_recibido != null) {
              const recibido = Number(r.deposito_efectivo_recibido);
              efectivoRetenido += recibido;
              efectivoSinDevolver += recibido - Number(r.deposito_devuelto || 0);
            }
            if (r.garantia_id_retenido_at && !r.garantia_id_devuelto_at) idsSinDevolver++;
          } else {
            if (Object.prototype.hasOwnProperty.call(holdsPorEstado, r.deposito_estado)) {
              holdsPorEstado[r.deposito_estado]++;
            }
            if (r.deposito_estado === 'capturado' && r.deposito_capturado != null) {
              capturadoStripe += Number(r.deposito_capturado);
            }
          }
        });

        return res.status(200).json({
          ok: true,
          rango: { desde, hasta },
          ingresos,
          ocupacion: {
            diasBiciRentados: Math.round(diasBiciRentados * 10) / 10,
            diasBiciDisponibles: Math.round(diasBiciDisponibles * 10) / 10,
            porcentaje: diasBiciDisponibles > 0
              ? Math.round(Math.min(diasBiciRentados / diasBiciDisponibles, 1) * 1000) / 10
              : 0
          },
          garantias: {
            efectivoRetenido, efectivoSinDevolver, idsSinDevolver,
            capturadoStripe, holdsPorEstado
          }
        });
      }

      default:
        return res.status(400).json({ error: 'accion_invalida' });
    }
  } catch (e) {
    console.error('crm/accion:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
