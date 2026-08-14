// POST /api/webhooks/bici-stripe
// Verifica la firma con el RAW body (constructEvent lo exige).
// ⚠ En ESM a propósito: `export const config = { api: { bodyParser: false } }`
// solo es detectado por Vercel en esta sintaxis. La versión CommonJS
// (`module.exports.config = …`) podía NO desactivar el parser → el buffer
// crudo llegaba vacío y TODAS las firmas fallaban en silencio.
// checkout.session.completed → 'pagada'. Idempotente por estado.
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { notificarReservaBici } = require('../_lib/notificar-bici.js');

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
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(
      raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('firma stripe invalida:', e.message);
    return res.status(400).json({ error: 'firma_invalida' });
  }

  try {
    if (event.type !== 'checkout.session.completed') {
      return res.status(200).json({ ok: true, ignorado: true });
    }
    const session = event.data.object;
    const token = String(session.client_reference_id || '').toUpperCase();
    if (!RE_TOKEN.test(token) || session.payment_status !== 'paid') {
      return res.status(200).json({ ok: true });
    }

    const s = supa();
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
  } catch (e) {
    console.error('webhook stripe:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
}
