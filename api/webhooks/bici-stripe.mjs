// POST /api/webhooks/bici-stripe
// Verifica la firma con el RAW body (constructEvent lo exige).
// ⚠ En ESM a propósito: `export const config = { api: { bodyParser: false } }`
// solo es detectado por Vercel en esta sintaxis. La versión CommonJS
// (`module.exports.config = …`) podía NO desactivar el parser → el buffer
// crudo llegaba vacío y TODAS las firmas fallaban en silencio.
// checkout.session.completed (renta) → 'pagada'. Idempotente por estado.
// checkout.session.completed (depósito, metadata.tipo=deposito_bici) +
// payment_intent.amount_capturable_updated/payment_failed/canceled →
// ciclo de vida del hold de garantía. Agregar estos 3 tipos de evento al
// endpoint en el Dashboard de Stripe (mismo endpoint, mismo secreto).
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { notificarReservaBici, notificarDepositoAtencion } = require('../_lib/notificar-bici.js');

// Hold recién autorizado vence a los ~7 días del lado de Stripe; se guarda
// con 1 día de margen para que el cron de re-autorización (api/pago/
// bici-stripe.mjs, rama GET) siempre lo alcance con tiempo de sobra.
const DEPOSITO_MARGEN_MS = 6 * 24 * 3600 * 1000;

async function auditarSistema(s, reservaId, actor, accion, detalle) {
  try { await s.from('crm_eventos').insert({ reserva_id: reservaId, actor, accion, detalle }); }
  catch (e) { console.error('auditoria webhook:', e.message); }
}

export const config = { api: { bodyParser: false } };

let _supa = null;
function supa() {
  if (!_supa) {
    _supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return _supa;
}

const RE_TOKEN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'stripe_no_configurado' });
  }

  let event;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const stripe = new Stripe(String(process.env.STRIPE_SECRET_KEY || "").trim());
    event = stripe.webhooks.constructEvent(
      raw, req.headers['stripe-signature'], String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
    );
  } catch (e) {
    console.error('firma stripe invalida:', e.message);
    return res.status(400).json({ error: 'firma_invalida' });
  }

  const s = supa();

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;

        // Depósito de garantía (autorizar_deposito en api/crm/accion.js
        // los marca con metadata.tipo — así se distinguen del cobro de
        // renta, que llega al mismo evento sin esa metadata).
        if (session.metadata && session.metadata.tipo === 'deposito_bici') {
          // OJO: session.payment_status queda 'unpaid' con capture_method
          // manual aunque el hold SÍ se haya autorizado — no sirve como
          // señal aquí. Hay que leer el PaymentIntent.
          const stripe = new Stripe(String(process.env.STRIPE_SECRET_KEY || "").trim());
          const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
          const reservaId = session.metadata.reserva_id;
          if (pi.status === 'requires_capture') {
            const { data: actualizada } = await s.from('reservas_bicis')
              .update({
                deposito_estado: 'autorizado',
                deposito_pi_id: pi.id,
                deposito_customer_id: pi.customer,
                deposito_payment_method_id: pi.payment_method,
                // Monto realmente retenido: es el tope de captura y la
                // única fuente confiable (el catálogo pudo cambiar después).
                deposito_autorizado_monto: (pi.amount || 0) / 100,
                deposito_autorizado_at: new Date().toISOString(),
                deposito_expira_at: new Date(Date.now() + DEPOSITO_MARGEN_MS).toISOString(),
                deposito_ultimo_error: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', reservaId).eq('deposito_estado', 'pendiente')
              .select('*').single();
            if (actualizada) await auditarSistema(s, reservaId, 'stripe_webhook', 'deposito_autorizado', { pi: pi.id });
          } else {
            await s.from('reservas_bicis').update({
              deposito_estado: 'requiere_atencion',
              deposito_ultimo_error: `pi_status_inesperado:${pi.status}`,
              updated_at: new Date().toISOString()
            }).eq('id', reservaId);
            const { data: r } = await s.from('reservas_bicis').select('*').eq('id', reservaId).single();
            if (r) await notificarDepositoAtencion(r, { message: `Estado inesperado tras checkout: ${pi.status}` });
          }
          return res.status(200).json({ ok: true });
        }

        // Cobro de renta (flujo existente, sin cambios).
        const token = String(session.client_reference_id || '').toUpperCase();
        if (!RE_TOKEN.test(token) || session.payment_status !== 'paid') {
          return res.status(200).json({ ok: true });
        }
        const { data: r } = await s.from('reservas_bicis')
          .select('id, estado').eq('token', token).single();
        if (!r) return res.status(200).json({ ok: true });
        if (['pagada', 'en_curso', 'cerrada'].includes(r.estado)) {
          return res.status(200).json({ ok: true, ya: true });
        }
        const { data: actualizada } = await s.from('reservas_bicis')
          .update({
            estado: 'pagada',
            metodo_pago: 'stripe',
            pago_ref: String(session.id),
            pago_ts: new Date().toISOString(),
            expira_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', r.id)
          .in('estado', ['pendiente_pago', 'pendiente_efectivo'])
          .select('*')
          .single();
        if (actualizada) await notificarReservaBici(actualizada, 'pagada');
        return res.status(200).json({ ok: true });
      }

      // Señal autoritativa de hold autorizado para los PaymentIntents que
      // el cron crea directo (off_session, sin pasar por Checkout) —
      // esos nunca disparan checkout.session.completed.
      case 'payment_intent.amount_capturable_updated': {
        const pi = event.data.object;
        if (!pi.metadata || pi.metadata.tipo !== 'deposito_bici') {
          return res.status(200).json({ ok: true, ignorado: true });
        }
        const { data: actualizada } = await s.from('reservas_bicis')
          .update({
            deposito_estado: 'autorizado',
            deposito_pi_id: pi.id,
            deposito_autorizado_monto: (pi.amount || 0) / 100,
            deposito_autorizado_at: new Date().toISOString(),
            deposito_expira_at: new Date(Date.now() + DEPOSITO_MARGEN_MS).toISOString(),
            deposito_ultimo_error: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', pi.metadata.reserva_id)
          .not('deposito_estado', 'in', '(capturado,liberado)')
          .select('*').single();
        if (actualizada) await auditarSistema(s, pi.metadata.reserva_id, 'stripe_webhook', 'deposito_autorizado', { pi: pi.id });
        return res.status(200).json({ ok: true });
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        if (!pi.metadata || pi.metadata.tipo !== 'deposito_bici') {
          return res.status(200).json({ ok: true, ignorado: true });
        }
        const { data: r } = await s.from('reservas_bicis').select('*').eq('id', pi.metadata.reserva_id).single();
        // Solo actuar si este PI sigue siendo el vigente en la fila (evita
        // reaccionar a un PI viejo que el cron ya reemplazó).
        if (r && (r.deposito_pi_id === pi.id || r.deposito_estado === 'pendiente')) {
          const mensaje = (pi.last_payment_error && pi.last_payment_error.message) || 'pago_fallido';
          await s.from('reservas_bicis').update({
            deposito_estado: 'requiere_atencion',
            deposito_ultimo_error: mensaje,
            updated_at: new Date().toISOString()
          }).eq('id', r.id);
          await auditarSistema(s, r.id, 'stripe_webhook', 'deposito_fallo', { pi: pi.id, error: mensaje });
          await notificarDepositoAtencion(r, { message: mensaje });
        }
        return res.status(200).json({ ok: true });
      }

      case 'payment_intent.canceled': {
        const pi = event.data.object;
        if (!pi.metadata || pi.metadata.tipo !== 'deposito_bici') {
          return res.status(200).json({ ok: true, ignorado: true });
        }
        const { data: r } = await s.from('reservas_bicis').select('*').eq('id', pi.metadata.reserva_id).single();
        // Nuestras propias acciones (capturar_deposito/liberar_deposito,
        // y el cron al reemplazar el PI viejo) ya mueven deposito_estado
        // FUERA de 'autorizado' antes de llamar a stripe.cancel — así que
        // si sigue en 'autorizado' aquí, es un cancel inesperado del lado
        // de Stripe (p. ej. venció solo) y sí hay que avisar.
        if (r && r.deposito_pi_id === pi.id && r.deposito_estado === 'autorizado') {
          await s.from('reservas_bicis').update({
            deposito_estado: 'expirado', updated_at: new Date().toISOString()
          }).eq('id', r.id);
          await auditarSistema(s, r.id, 'stripe_webhook', 'deposito_expirado', { pi: pi.id });
          await notificarDepositoAtencion(r, { message: 'El hold del depósito venció sin capturarse ni liberarse.' });
        }
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(200).json({ ok: true, ignorado: true });
    }
  } catch (e) {
    console.error('webhook stripe:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
}
