// POST /api/pago/bici-stripe — { token }
// Crea una Checkout Session (cobro inmediato de la renta) y devuelve la URL.
// client_reference_id = token; el webhook confirma el pago.
// ESM a propósito: el webhook hermano necesita `export const config` y
// mantenemos el par Stripe completo en el mismo módulo-sistema.
//
// GET (con Authorization: Bearer $CRON_SECRET) — cron diario de
// re-autorización de depósitos: el hold de Stripe vence solo a los ~7
// días, así que las rentas largas (semana/mes) necesitan un PaymentIntent
// nuevo antes de que expire, usando la tarjeta guardada (setup_future_usage
// del hold original). Vive aquí y no en un archivo nuevo por el límite de
// 12 funciones del plan Hobby de Vercel — ver vercel.json → crons.
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { notificarDepositoAtencion } = require('../_lib/notificar-bici.js');

const DEPOSITO_MARGEN_MS = 6 * 24 * 3600 * 1000;

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
  if (req.method === 'GET') return handleCronReauth(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'stripe_no_configurado' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const token = String(b.token || '').toUpperCase();
  if (!RE_TOKEN.test(token)) return res.status(400).json({ error: 'token_invalido' });

  const site = process.env.SITE_URL || 'https://www.walkmetours.com';
  try {
    const { data: r, error } = await supa().from('reservas_bicis')
      .select('id, token, folio, estado, idioma, total, email')
      .eq('token', token).single();
    if (error || !r) return res.status(404).json({ error: 'reserva_no_encontrada' });
    if (r.estado !== 'pendiente_pago' && r.estado !== 'pendiente_efectivo') {
      return res.status(409).json({ error: 'estado_invalido' });
    }

    const cuponBase = `${site}/${r.idioma === 'en' ? 'cupon-en.html' : 'cupon.html'}?t=${r.token}`;
    const stripe = new Stripe(String(process.env.STRIPE_SECRET_KEY || "").trim());
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: r.token,
      customer_email: r.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'mxn',
          unit_amount: Math.round(Number(r.total) * 100),
          product_data: { name: `Renta de bici WalkMe · Folio WB-${r.folio}` }
        }
      }],
      success_url: cuponBase + '&pagando=1',
      cancel_url: cuponBase
    }, { idempotencyKey: `checkout-bici-${r.token}` });

    await supa().from('reservas_bicis')
      .update({ metodo_pago: 'stripe', updated_at: new Date().toISOString() })
      .eq('id', r.id);

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('bici-stripe:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
}

async function auditarCron(s, reservaId, accion, detalle) {
  try { await s.from('crm_eventos').insert({ reserva_id: reservaId, actor: 'cron', accion, detalle }); }
  catch (e) { console.error('auditoria cron:', e.message); }
}

// GET /api/pago/bici-stripe — llamado 1x/día por Vercel Cron (vercel.json).
// Re-autoriza (silencioso, off_session con la tarjeta guardada) los holds
// de depósito que están por vencer, para rentas de más de 7 días.
async function handleCronReauth(req, res) {
  const auth = String(req.headers.authorization || '');
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'no_autorizado' });
  }
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'stripe_no_configurado' });

  const stripe = new Stripe(String(process.env.STRIPE_SECRET_KEY || "").trim());
  const s = supa();
  const limite = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  const { data: filas, error } = await s.from('reservas_bicis')
    .select('*')
    // garantia_tipo es obligatorio aquí: desde el 19-ago-26 una garantía
    // en EFECTIVO también queda en deposito_estado='autorizado' (mismo
    // chip para el mostrador). Sin este filtro el cron intentaría
    // reautorizar en Stripe una renta que nunca dio una tarjeta.
    .eq('garantia_tipo', 'tarjeta')
    .eq('deposito_estado', 'autorizado')
    .eq('estado', 'en_curso')
    .lte('deposito_expira_at', limite);
  if (error) {
    console.error('cron reauth: consulta:', error.message);
    return res.status(500).json({ error: 'error_interno' });
  }

  let reautorizadas = 0, atencion = 0;
  for (const r of (filas || [])) {
    const piAnterior = r.deposito_pi_id;
    // Se renueva por el MISMO monto que se autorizó, no por el del
    // catálogo de hoy: renovar un hold no es renegociar la garantía.
    const montoHold = r.deposito_autorizado_monto == null
      ? Number(r.deposito_total) : Number(r.deposito_autorizado_monto);
    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(montoHold * 100),
        currency: 'mxn',
        customer: r.deposito_customer_id,
        payment_method: r.deposito_payment_method_id,
        capture_method: 'manual',
        off_session: true,
        confirm: true,
        metadata: { tipo: 'deposito_bici', reserva_id: r.id, token: r.token, folio: String(r.folio), reauth: 'true' }
      }, { idempotencyKey: `deposito-reauth-${r.id}-${r.deposito_reautorizaciones + 1}` });

      await s.from('reservas_bicis').update({
        deposito_pi_id: pi.id,
        deposito_estado: 'autorizado',
        deposito_autorizado_at: new Date().toISOString(),
        deposito_expira_at: new Date(Date.now() + DEPOSITO_MARGEN_MS).toISOString(),
        deposito_reautorizaciones: r.deposito_reautorizaciones + 1,
        deposito_ultimo_error: null,
        updated_at: new Date().toISOString()
      }).eq('id', r.id);

      if (piAnterior) {
        try { await stripe.paymentIntents.cancel(piAnterior); }
        catch (e) { console.error('cron reauth: no se pudo cancelar PI anterior', piAnterior, e.message); }
      }
      await auditarCron(s, r.id, 'reautorizar_deposito', { pi_nuevo: pi.id, pi_anterior: piAnterior });
      reautorizadas++;
    } catch (e) {
      // Tarjeta declinada, requiere 3DS sin el cliente presente, etc. —
      // se detiene de reintentar solo (deposito_expira_at:null lo saca de
      // la consulta del cron) y se avisa a María.
      await s.from('reservas_bicis').update({
        deposito_estado: 'requiere_atencion',
        deposito_ultimo_error: `${e.code || 'error'}: ${e.message}`,
        deposito_expira_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', r.id);
      await auditarCron(s, r.id, 'reautorizar_deposito_fallo', { error: e.code || e.message });
      await notificarDepositoAtencion(r, e);
      atencion++;
    }
  }
  return res.status(200).json({ ok: true, procesadas: (filas || []).length, reautorizadas, atencion });
}
