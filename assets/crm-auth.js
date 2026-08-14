// Auth del CRM en el navegador — SIN dependencias, sin CDN, sin llaves.
// Todo pasa por /api/crm/sesion (login/refresh) y /api/crm/* (datos, con
// Bearer). El navegador jamás conoce la URL ni la anon key de Supabase.
// Access token: en memoria. Refresh token: localStorage (phone-first,
// la sesión sobrevive a cerrar el navegador y dura semanas).
(function () {
  const LS_KEY = 'wm_crm_refresh';
  let accessToken = null;
  let expiraEn = 0; // epoch ms
  let emailSesion = null;

  async function sesion(body) {
    const r = await fetch('/api/crm/sesion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) {
      const err = new Error(data.error || 'auth_error');
      err.codigo = data.error;
      throw err;
    }
    accessToken = data.access_token;
    expiraEn = Date.now() + (data.expires_in - 60) * 1000; // renovar 1 min antes
    emailSesion = data.email;
    if (data.refresh_token) localStorage.setItem(LS_KEY, data.refresh_token);
    return data;
  }

  async function login(email, password) {
    return sesion({ accion: 'login', email, password });
  }

  async function refresh() {
    const rt = localStorage.getItem(LS_KEY);
    if (!rt) { const e = new Error('sin_sesion'); e.codigo = 'sin_sesion'; throw e; }
    try {
      return await sesion({ accion: 'refresh', refresh_token: rt });
    } catch (e) {
      localStorage.removeItem(LS_KEY); // refresh muerto: exigir login
      throw e;
    }
  }

  async function tokenVigente() {
    if (accessToken && Date.now() < expiraEn) return accessToken;
    await refresh();
    return accessToken;
  }

  function logout() {
    accessToken = null;
    expiraEn = 0;
    emailSesion = null;
    localStorage.removeItem(LS_KEY);
  }

  function haySesion() { return !!localStorage.getItem(LS_KEY); }
  function email() { return emailSesion; }

  // fetch autenticado contra /api/crm/*. Reintenta una vez si el token
  // expiró entre el chequeo y la llamada.
  async function apiFetch(ruta, opciones) {
    const t = await tokenVigente();
    const opts = Object.assign({}, opciones);
    opts.headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + t });
    let r = await fetch(ruta, opts);
    if (r.status === 401) {
      await refresh();
      opts.headers.Authorization = 'Bearer ' + accessToken;
      r = await fetch(ruta, opts);
    }
    return r;
  }

  window.CRM_AUTH = { login, logout, haySesion, email, tokenVigente, apiFetch };
})();
