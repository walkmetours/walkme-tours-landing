// POST /api/pago/bici-stripe — { token }
// Crea una Checkout Session (cobro inmediato de la renta) y devuelve la URL.
// client_reference_id = token; el webhook confirma el pago.
// ESM a propósito: el webhook hermano necesita `export const config` y
// mantenemos el par Stripe completo en el mismo módulo-sistema.
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

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
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
