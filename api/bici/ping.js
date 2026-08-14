// GET /api/bici/ping — función de humo: confirma que Vercel instala las
// deps y que las env vars están presentes (sin exponer sus valores).
module.exports = async (req, res) => {
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
};
