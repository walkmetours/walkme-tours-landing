// Autenticación del CRM.
// El navegador manda `Authorization: Bearer <access_token>` (obtenido de
// Supabase Auth vía assets/crm-auth.js). Aquí se verifica con getUser()
// (revocación inmediata, cero dependencias de JWT) y después se aplica el
// allowlist CRM_EMAILS — defensa en profundidad: aunque alguien lograra
// crear una cuenta, sin estar en la lista no lee nada.
// Los datos SIEMPRE se sirven vía service_role; la anon key solo autentica.
const { createClient } = require('@supabase/supabase-js');

let authClient = null;
function clienteAuth() {
  if (!authClient) {
    authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return authClient;
}

// Devuelve { email } si el token es válido Y el email está en CRM_EMAILS.
// Si no, responde 401/403 directamente y devuelve null.
async function verificarCRM(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.CRM_EMAILS) {
    res.status(503).json({ error: 'crm_no_configurado' });
    return null;
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'sin_sesion' });
    return null;
  }

  try {
    const { data, error } = await clienteAuth().auth.getUser(token);
    if (error || !data || !data.user || !data.user.email) {
      res.status(401).json({ error: 'sesion_invalida' });
      return null;
    }
    const email = data.user.email.toLowerCase();
    const permitidos = process.env.CRM_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!permitidos.includes(email)) {
      res.status(403).json({ error: 'no_autorizado' });
      return null;
    }
    return { email };
  } catch (e) {
    console.error('auth-crm:', e.message);
    res.status(401).json({ error: 'sesion_invalida' });
    return null;
  }
}

module.exports = { verificarCRM };
