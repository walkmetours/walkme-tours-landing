// POST /api/crm/sesion — login y refresh del CRM, proxied.
// El navegador NUNCA conoce la anon key ni la URL de Supabase: este
// endpoint habla con la API de auth usando las env vars. Así la
// configuración vive solo en Vercel y crm.html no se edita jamás.
//
// Body: { accion:'login', email, password }
//     | { accion:'refresh', refresh_token }
// 200 → { access_token, refresh_token, expires_in, email }
const { leerJson } = require('../_lib/supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.CRM_EMAILS) {
    return res.status(503).json({ error: 'crm_no_configurado' });
  }

  const b = leerJson(req);
  let grant, body;

  if (b.accion === 'login') {
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!email || !password) return res.status(400).json({ error: 'datos_invalidos' });
    // Allowlist ANTES de intentar el login: ni siquiera se consulta auth
    // para correos fuera de la lista.
    const permitidos = process.env.CRM_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!permitidos.includes(email)) return res.status(403).json({ error: 'no_autorizado' });
    grant = 'password';
    body = { email, password };
  } else if (b.accion === 'refresh') {
    const rt = String(b.refresh_token || '');
    if (!rt) return res.status(400).json({ error: 'datos_invalidos' });
    grant = 'refresh_token';
    body = { refresh_token: rt };
  } else {
    return res.status(400).json({ error: 'accion_invalida' });
  }

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(401).json({ error: 'credenciales_invalidas' });
    }
    // Allowlist también post-refresh (el refresh token no trae el email en el request)
    const email = (data.user && data.user.email || '').toLowerCase();
    const permitidos = process.env.CRM_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!permitidos.includes(email)) return res.status(403).json({ error: 'no_autorizado' });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      email
    });
  } catch (e) {
    console.error('crm/sesion:', e.message);
    return res.status(500).json({ error: 'error_interno' });
  }
};
