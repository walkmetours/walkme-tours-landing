/* ========================================
   WalkMe · Wizard de reserva en línea (mobile-first)
   Pasos: 1 Tour y fecha · 2 Tus datos · 3 Documentos ·
          4 Contrato y firma · 5 Pago · (6 Cupón = gracias.html)
   - Precios desde assets/catalogo.js; el total mostrado es informativo:
     /api/reserva/crear lo recalcula en servidor y ese es el que vale.
   - Documentos: subida directa a Storage por URL firmada (nunca pasan
     por el navegador a /api), con compresión de imagen en cliente.
   - Firma: assets/firma.js (canvas) → PNG → /api/reserva/firmar.
   - Pago: Mercado Pago / Stripe (checkout hosted) o efectivo.
   - Bilingüe (document.documentElement.lang) · estado en sessionStorage.
   ======================================== */
(function () {
  const HTML = document.documentElement;
  const lang = (HTML.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const currency = HTML.dataset.currency || 'MXN';
  const WA = '525639748122';
  const CAT = (window.WM_CATALOGO && window.WM_CATALOGO.tours) || [];
  const STORE_KEY = 'wm-reserva';
  const TOTAL_PASOS = 6;

  const STR = {
    es: {
      steps: ['Tour', 'Tus datos', 'Documentos', 'Contrato', 'Pago', 'Cupón'],
      stepOf: (n, tot) => `Paso ${n} de ${tot}`,
      gXcaret: 'Grupo Xcaret', gTours: 'Tours Riviera Maya',
      selTour: 'Elige tu experiencia',
      fTour: 'Experiencia', fDate: 'Fecha del tour', fAdults: 'Adultos', fChildren: 'Menores de 11 años',
      fZone: 'Zona de salida', fHotel: 'Hotel o punto de encuentro',
      zonePDC: 'Playa del Carmen', zoneRM: 'Riviera Maya', zoneCUN: 'Cancún',
      totalLbl: 'Total', perAdult: 'Adulto', perChild: 'Menor <11',
      incluye: z => `Incluye transporte desde ${z}.`,
      custom: 'Esta salida requiere cotización personalizada y no se puede pagar en línea. Escríbenos por WhatsApp y te confirmamos el total.',
      childPending: 'Esta experiencia no tiene precio de menor publicado. Para reservar con menores escríbenos por WhatsApp.',
      customBtn: 'Cotizar por WhatsApp',
      fName: 'Nombre completo (como en tu ID)', fEmail: 'Correo electrónico', fPhone: 'Teléfono / WhatsApp',
      phHotel: 'Ej. Hotel Xcaret, Airbnb Centro…', phName: 'Nombre y apellidos', phEmail: 'tucorreo@ejemplo.com', phPhone: '+52 999 123 4567',
      next: 'Continuar', back: 'Atrás',
      errTour: 'Elige una experiencia', errDate: 'Elige una fecha (desde mañana)', errAdults: 'Debe viajar al menos 1 adulto',
      errHotel: 'Escribe tu hotel o punto de encuentro', errName: 'Escribe tu nombre completo',
      errEmail: 'Escribe un correo válido', errPhone: 'Escribe tu teléfono',
      errRed: 'No pudimos conectar. Revisa tu internet e intenta de nuevo.',
      docsIntro: 'Para confirmar tu reserva necesitamos dos documentos. Se guardan de forma privada y se eliminan 30 días después de tu tour.',
      docId: 'Foto de tu identificación', docIdSub: 'INE, pasaporte o licencia. Que se lea claramente.',
      docHosp: 'Tu reserva de hospedaje', docHospSub: 'Captura o PDF de la confirmación de tu hotel o Airbnb.',
      docBtn: 'Subir archivo', docBtnCam: 'Tomar foto o subir',
      docListo: 'Recibido', docSubiendo: 'Subiendo…', docCambiar: 'Cambiar',
      errDocs: 'Sube los dos documentos para continuar', errDocGrande: 'El archivo pasa de 8 MB. Prueba con una foto o captura más ligera.',
      privacyDocs: 'Al subir tus documentos aceptas nuestro <a href="aviso-privacidad.html" target="_blank">Aviso de Privacidad</a>.',
      ctIntro: 'Lee y firma el contrato de servicio para continuar.',
      ctAccept: 'Leí y acepto el contrato y el <a href="aviso-privacidad.html" target="_blank">Aviso de Privacidad</a>.',
      ctFirma: 'Firma aquí con tu dedo', ctBorrar: 'Borrar firma',
      errAccept: 'Marca la casilla de aceptación', errFirma: 'Traza tu firma en el recuadro',
      firmando: 'Guardando firma…',
      payIntro: 'Elige cómo quieres pagar. El pago en línea es procesado por Mercado Pago o Stripe: nosotros nunca vemos tu tarjeta.',
      payMP: 'Mercado Pago', payMPSub: 'Tarjetas de México, OXXO y más',
      payStripe: 'Tarjeta internacional', payStripeSub: 'Visa, Mastercard, Amex (Stripe)',
      payCash: 'Efectivo en persona', payCashSub: 'Apartas tu lugar y pagas antes del tour',
      payRedir: 'Abriendo pago seguro…', payCash2: 'Confirmando…',
      resumen: 'Resumen de tu reserva',
      rTour: 'Experiencia', rDate: 'Fecha', rPax: 'Personas', rZone: 'Salida', rHotel: 'Hotel', rName: 'Nombre', rEmail: 'Correo', rPhone: 'Teléfono',
      adultsWord: n => n === 1 ? 'adulto' : 'adultos', childrenWord: n => n === 1 ? 'menor' : 'menores',
      msgHeader: 'Hola WalkMe Tours, quiero reservar:',
      privacy: 'Tus datos solo se usan para gestionar tu reserva.'
    },
    en: {
      steps: ['Tour', 'Your info', 'Documents', 'Contract', 'Payment', 'Voucher'],
      stepOf: (n, tot) => `Step ${n} of ${tot}`,
      gXcaret: 'Xcaret Group', gTours: 'Riviera Maya Tours',
      selTour: 'Choose your experience',
      fTour: 'Experience', fDate: 'Tour date', fAdults: 'Adults', fChildren: 'Children under 11',
      fZone: 'Departure zone', fHotel: 'Hotel or meeting point',
      zonePDC: 'Playa del Carmen', zoneRM: 'Riviera Maya', zoneCUN: 'Cancún',
      totalLbl: 'Total', perAdult: 'Adult', perChild: 'Child <11',
      incluye: z => `Includes transport from ${z}.`,
      custom: 'This departure needs a custom quote and cannot be paid online. Message us on WhatsApp and we confirm the total.',
      childPending: 'This experience has no published child price. To book with children, message us on WhatsApp.',
      customBtn: 'Get a quote on WhatsApp',
      fName: 'Full name (as shown on your ID)', fEmail: 'Email', fPhone: 'Phone / WhatsApp',
      phHotel: 'E.g. Hotel Xcaret, Downtown Airbnb…', phName: 'First and last name', phEmail: 'you@example.com', phPhone: '+1 555 123 4567',
      next: 'Continue', back: 'Back',
      errTour: 'Choose an experience', errDate: 'Choose a date (from tomorrow)', errAdults: 'At least 1 adult must travel',
      errHotel: 'Enter your hotel or meeting point', errName: 'Enter your full name',
      errEmail: 'Enter a valid email', errPhone: 'Enter your phone number',
      errRed: 'Connection failed. Check your internet and try again.',
      docsIntro: 'To confirm your booking we need two documents. They are stored privately and deleted 30 days after your tour.',
      docId: 'Photo of your ID', docIdSub: 'Passport, national ID or driver license. Clearly readable.',
      docHosp: 'Your lodging confirmation', docHospSub: 'Screenshot or PDF of your hotel or Airbnb confirmation.',
      docBtn: 'Upload file', docBtnCam: 'Take photo or upload',
      docListo: 'Received', docSubiendo: 'Uploading…', docCambiar: 'Change',
      errDocs: 'Upload both documents to continue', errDocGrande: 'File is over 8 MB. Try a lighter photo or screenshot.',
      privacyDocs: 'By uploading your documents you accept our <a href="privacy-notice-en.html" target="_blank">Privacy Notice</a>.',
      ctIntro: 'Read and sign the service agreement to continue.',
      ctAccept: 'I have read and accept the agreement and the <a href="privacy-notice-en.html" target="_blank">Privacy Notice</a>.',
      ctFirma: 'Sign here with your finger', ctBorrar: 'Clear signature',
      errAccept: 'Check the acceptance box', errFirma: 'Draw your signature in the box',
      firmando: 'Saving signature…',
      payIntro: 'Choose how you want to pay. Online payments are processed by Mercado Pago or Stripe: we never see your card.',
      payMP: 'Mercado Pago', payMPSub: 'Mexican cards, OXXO and more',
      payStripe: 'International card', payStripeSub: 'Visa, Mastercard, Amex (Stripe)',
      payCash: 'Cash in person', payCashSub: 'Hold your spot and pay before the tour',
      payRedir: 'Opening secure checkout…', payCash2: 'Confirming…',
      resumen: 'Booking summary',
      rTour: 'Experience', rDate: 'Date', rPax: 'Guests', rZone: 'Departure', rHotel: 'Hotel', rName: 'Name', rEmail: 'Email', rPhone: 'Phone',
      adultsWord: n => n === 1 ? 'adult' : 'adults', childrenWord: n => n === 1 ? 'child' : 'children',
      msgHeader: 'Hi WalkMe Tours, I want to book:',
      privacy: 'Your info is only used to manage your booking.'
    }
  };
  const t = STR[lang];
  const fmt = n => '$' + Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX');
  const ZONE_NAME = { pdc: t.zonePDC, rm: t.zoneRM, cun: t.zoneCUN };
  const PAG_GRACIAS = lang === 'en' ? 'gracias-en.html' : 'gracias.html';

  /* ---- Estado ---- */
  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save() { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  const state = Object.assign({
    step: 1, tour: '', fecha: '', adultos: 2, menores: 0, zona: 'pdc',
    hotel: '', nombre: '', email: '', telefono: '',
    reservaId: null, codigo: null,
    subidos: { id: false, hospedaje: false },
    firmada: false
  }, load());
  if (state.firmada && state.step < 5) state.step = 5;

  const $ = sel => document.querySelector(sel);
  const wrap = $('#wz');
  if (!wrap) return;
  let firma = null; // instancia WMFirma del paso 4

  /* ---- Progreso ---- */
  function renderProgress() {
    const bar = $('#wz-progress');
    bar.innerHTML = t.steps.map((label, i) => {
      const n = i + 1;
      const cls = n < state.step ? 'done' : (n === state.step ? 'now' : '');
      return `<div class="wz-p ${cls}"><span class="wz-p-dot">${n < state.step ? '✓' : n}</span><span class="wz-p-lbl">${label}</span></div>`;
    }).join('');
    $('#wz-stepof').textContent = t.stepOf(state.step, TOTAL_PASOS);
  }

  function tourById(id) { return CAT.find(x => x.id === id) || null; }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    const monthsEs = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const months = lang === 'en' ? monthsEn : monthsEs;
    return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
  }

  /* ---- Paso 1 ---- */
  function renderStep1() {
    const groups = [
      { key: 'xcaret', label: t.gXcaret },
      { key: 'tours', label: t.gTours }
    ];
    const options = groups.map(g =>
      `<optgroup label="${g.label}">` +
      CAT.filter(x => x.grupo === g.key)
        .map(x => `<option value="${x.id}">${x.nombre[lang]}</option>`).join('') +
      `</optgroup>`
    ).join('');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    return `
      <div class="qm-field">
        <label for="wz-tour">${t.fTour}</label>
        <select id="wz-tour" required>
          <option value="" disabled ${state.tour ? '' : 'selected'}>${t.selTour}</option>
          ${options}
        </select>
      </div>
      <div class="qm-field">
        <label for="wz-date">${t.fDate}</label>
        <input type="date" id="wz-date" min="${tomorrow}" value="${state.fecha}" required>
      </div>
      <div class="qm-row">
        <div class="qm-field">
          <label for="wz-adults">${t.fAdults}</label>
          <div class="wz-stepper">
            <button type="button" data-step="wz-adults" data-d="-1" aria-label="−">−</button>
            <input type="number" id="wz-adults" min="1" max="30" value="${state.adultos}" inputmode="numeric">
            <button type="button" data-step="wz-adults" data-d="1" aria-label="+">+</button>
          </div>
        </div>
        <div class="qm-field">
          <label for="wz-children">${t.fChildren}</label>
          <div class="wz-stepper">
            <button type="button" data-step="wz-children" data-d="-1" aria-label="−">−</button>
            <input type="number" id="wz-children" min="0" max="20" value="${state.menores}" inputmode="numeric">
            <button type="button" data-step="wz-children" data-d="1" aria-label="+">+</button>
          </div>
        </div>
      </div>
      <div class="qm-field">
        <label>${t.fZone}</label>
        <div class="wz-zones" role="radiogroup" aria-label="${t.fZone}">
          ${['pdc', 'rm', 'cun'].map(z =>
            `<button type="button" class="wz-zone ${state.zona === z ? 'on' : ''}" data-zone="${z}">${ZONE_NAME[z]}</button>`
          ).join('')}
        </div>
      </div>
      <div class="qm-field">
        <label for="wz-hotel">${t.fHotel}</label>
        <input type="text" id="wz-hotel" value="${escapeAttr(state.hotel)}" placeholder="${t.phHotel}" required>
      </div>
      <div class="qm-total" id="wz-total"></div>
      <div class="wz-err" id="wz-err" hidden></div>
    `;
  }

  function totalState() {
    const tour = tourById(state.tour);
    if (!tour) return { tour: null };
    const prices = tour.precios[state.zona] || null;
    const hasPrice = prices !== null;
    const childMissing = hasPrice && prices.menor === null && state.menores > 0;
    let total = null;
    if (hasPrice && !childMissing) {
      total = state.adultos * prices.adulto + state.menores * (prices.menor || 0);
    }
    return { tour, prices, hasPrice, childMissing, total };
  }

  function waLink() {
    const tour = tourById(state.tour);
    const msg = `${t.msgHeader}\n\n• ${t.rTour}: ${tour ? tour.nombre[lang] : ''}\n• ${t.rDate}: ${formatDate(state.fecha)}\n• ${t.rPax}: ${state.adultos} ${t.adultsWord(state.adultos)}, ${state.menores} ${t.childrenWord(state.menores)}\n• ${t.rZone}: ${ZONE_NAME[state.zona]}\n• ${t.rHotel}: ${state.hotel}`;
    return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
  }

  function updateTotal() {
    const box = $('#wz-total');
    if (!box) return;
    const s = totalState();
    if (!s.tour) { box.className = 'qm-total'; box.innerHTML = ''; box.style.display = 'none'; setNextEnabled(true); return; }
    box.style.display = '';
    const nota = s.tour.nota ? `<div class="qm-total-note">${s.tour.nota[lang]}</div>` : '';
    if (!s.hasPrice || s.childMissing) {
      box.className = 'qm-total custom';
      box.innerHTML = `<div class="qm-total-note">${!s.hasPrice ? t.custom : t.childPending}</div>
        <a class="wz-wa-mini" href="${waLink()}" target="_blank" rel="noopener"><svg width="16" height="16"><use href="#wa-icon"/></svg>${t.customBtn}</a>`;
      setNextEnabled(false);
    } else {
      box.className = 'qm-total pdc';
      const rows = [
        `<div class="qm-total-row"><span>${t.perAdult} × ${state.adultos}</span><span>${fmt(state.adultos * s.prices.adulto)} ${currency}</span></div>`
      ];
      if (state.menores > 0) rows.push(`<div class="qm-total-row"><span>${t.perChild} × ${state.menores}</span><span>${fmt(state.menores * (s.prices.menor || 0))} ${currency}</span></div>`);
      rows.push(`<div class="qm-total-row main"><span>${t.totalLbl}</span><span class="qm-total-val">${fmt(s.total)} ${currency}</span></div>`);
      box.innerHTML = rows.join('') + `<div class="qm-total-note">${t.incluye(ZONE_NAME[state.zona])}</div>` + nota;
      setNextEnabled(true);
    }
  }

  /* ---- Paso 2 ---- */
  function renderStep2() {
    return `
      <div class="qm-field">
        <label for="wz-name">${t.fName}</label>
        <input type="text" id="wz-name" value="${escapeAttr(state.nombre)}" placeholder="${t.phName}" autocomplete="name" required>
      </div>
      <div class="qm-field">
        <label for="wz-email">${t.fEmail}</label>
        <input type="email" id="wz-email" value="${escapeAttr(state.email)}" placeholder="${t.phEmail}" autocomplete="email" inputmode="email" required>
      </div>
      <div class="qm-field">
        <label for="wz-phone">${t.fPhone}</label>
        <input type="tel" id="wz-phone" value="${escapeAttr(state.telefono)}" placeholder="${t.phPhone}" autocomplete="tel" inputmode="tel" required>
      </div>
      <p class="qm-disclaimer">${t.privacy}</p>
      <div class="wz-err" id="wz-err" hidden></div>
    `;
  }

  /* ---- Paso 3: documentos ---- */
  function renderStep3() {
    return `
      <p class="wz-intro">${t.docsIntro}</p>
      ${docCard('id', t.docId, t.docIdSub, 'image/*', true)}
      ${docCard('hospedaje', t.docHosp, t.docHospSub, 'image/*,.pdf,application/pdf', false)}
      <p class="qm-disclaimer">${t.privacyDocs}</p>
      <div class="wz-err" id="wz-err" hidden></div>
    `;
  }
  function docCard(tipo, titulo, sub, accept, camara) {
    const listo = state.subidos[tipo];
    return `
      <div class="wz-doc ${listo ? 'ok' : ''}" id="doc-${tipo}">
        <div class="wz-doc-head">
          <div><strong>${titulo}</strong><span>${sub}</span></div>
          <span class="wz-doc-badge">${listo ? '✓ ' + t.docListo : ''}</span>
        </div>
        <label class="wz-doc-btn">
          <input type="file" accept="${accept}" ${camara ? 'capture="environment"' : ''} data-doc="${tipo}" hidden>
          <span>${listo ? t.docCambiar : (camara ? t.docBtnCam : t.docBtn)}</span>
        </label>
        <div class="wz-doc-status" hidden></div>
      </div>
    `;
  }

  // Comprime imágenes a máx 1600px por lado, JPEG 0.8. PDFs pasan tal cual.
  function comprimirImagen(file) {
    return new Promise((resolve) => {
      if (!/^image\//.test(file.type)) return resolve({ blob: file, ext: 'pdf' });
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1600;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(b => resolve({ blob: b || file, ext: 'jpg' }), 'image/jpeg', 0.8);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase() }); };
      img.src = url;
    });
  }

  async function subirDocumento(tipo, file) {
    const card = $('#doc-' + tipo);
    const status = card.querySelector('.wz-doc-status');
    status.hidden = false;
    status.textContent = t.docSubiendo;
    card.classList.remove('ok');
    try {
      const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const { blob, ext } = esPdf ? { blob: file, ext: 'pdf' } : await comprimirImagen(file);
      if (blob.size > 8 * 1024 * 1024) { status.textContent = t.errDocGrande; return; }

      const r1 = await api('/api/reserva/documentos', { reservaId: state.reservaId, tipo, ext });
      const r2 = await fetch(r1.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': esPdf ? 'application/pdf' : 'image/jpeg', 'x-upsert': 'true' },
        body: blob
      });
      if (!r2.ok) throw new Error('upload ' + r2.status);

      state.subidos[tipo] = true;
      save();
      status.hidden = true;
      card.classList.add('ok');
      card.querySelector('.wz-doc-badge').textContent = '✓ ' + t.docListo;
      card.querySelector('.wz-doc-btn span').textContent = t.docCambiar;
    } catch (e) {
      status.textContent = t.errRed;
    }
  }

  /* ---- Paso 4: contrato y firma ---- */
  function renderStep4() {
    return `
      <p class="wz-intro">${t.ctIntro}</p>
      <div class="wz-contrato" id="wz-contrato">…</div>
      <label class="wz-accept">
        <input type="checkbox" id="wz-accept">
        <span>${t.ctAccept}</span>
      </label>
      <div class="wz-firma-wrap">
        <p class="wz-firma-lbl">${t.ctFirma}</p>
        <canvas class="wz-firma" id="wz-firma"></canvas>
        <button type="button" class="wz-firma-clear" id="wz-firma-clear">${t.ctBorrar}</button>
      </div>
      <div class="wz-err" id="wz-err" hidden></div>
    `;
  }

  let contratoVersion = 'v1-' + lang + '-2026-08';
  async function cargarContrato() {
    const cont = $('#wz-contrato');
    try {
      const resp = await fetch(`contrato/contrato-v1-${lang}.html`);
      cont.innerHTML = await resp.text();
      const doc = cont.querySelector('.ct-doc');
      if (doc && doc.dataset.version) contratoVersion = doc.dataset.version;
      const s = totalState();
      const campos = {
        nombre: state.nombre,
        tour: s.tour ? s.tour.nombre[lang] : '',
        fecha: formatDate(state.fecha),
        pax: `${state.adultos} ${t.adultsWord(state.adultos)}, ${state.menores} ${t.childrenWord(state.menores)}`,
        zona: ZONE_NAME[state.zona],
        total: s.total !== null ? `${fmt(s.total)} ${currency}` : '—'
      };
      cont.querySelectorAll('[data-campo]').forEach(el => {
        const v = campos[el.dataset.campo];
        if (v !== undefined) el.textContent = v;
      });
    } catch (e) {
      cont.innerHTML = `<p>${t.errRed}</p>`;
    }
  }

  /* ---- Paso 5: pago ---- */
  function renderStep5() {
    const s = totalState();
    return `
      <div class="wz-resumen">
        <p class="wz-resumen-t">${t.resumen} · <strong>${state.codigo || ''}</strong></p>
        <div class="wz-res-row"><span>${t.rTour}</span><strong>${s.tour ? s.tour.nombre[lang] : ''}</strong></div>
        <div class="wz-res-row"><span>${t.rDate}</span><strong>${formatDate(state.fecha)}</strong></div>
        <div class="wz-res-row"><span>${t.rPax}</span><strong>${state.adultos} ${t.adultsWord(state.adultos)}, ${state.menores} ${t.childrenWord(state.menores)}</strong></div>
        <div class="wz-res-row"><span>${t.totalLbl}</span><strong>${s.total !== null ? fmt(s.total) + ' ' + currency : '—'}</strong></div>
      </div>
      <p class="wz-intro" style="margin-top:16px;">${t.payIntro}</p>
      <button type="button" class="wz-pay" data-pay="mercadopago">
        <span class="wz-pay-t">${t.payMP}</span><span class="wz-pay-s">${t.payMPSub}</span>
      </button>
      <button type="button" class="wz-pay" data-pay="stripe">
        <span class="wz-pay-t">${t.payStripe}</span><span class="wz-pay-s">${t.payStripeSub}</span>
      </button>
      <button type="button" class="wz-pay" data-pay="efectivo">
        <span class="wz-pay-t">${t.payCash}</span><span class="wz-pay-s">${t.payCashSub}</span>
      </button>
      <div class="wz-err" id="wz-err" hidden></div>
    `;
  }

  async function pagar(metodo, btn) {
    const todos = wrap.querySelectorAll('.wz-pay');
    todos.forEach(b => b.disabled = true);
    btn.querySelector('.wz-pay-s').textContent = metodo === 'efectivo' ? t.payCash2 : t.payRedir;
    try {
      if (metodo === 'efectivo') {
        const r = await api('/api/pago/efectivo', { reservaId: state.reservaId });
        location.href = `${PAG_GRACIAS}?codigo=${encodeURIComponent(r.codigo)}`;
      } else {
        const r = await api(`/api/pago/${metodo}`, { reservaId: state.reservaId });
        location.href = r.url;
      }
    } catch (e) {
      showError(t.errRed);
      todos.forEach(b => b.disabled = false);
      btn.querySelector('.wz-pay-s').textContent = metodo === 'mercadopago' ? t.payMPSub : (metodo === 'stripe' ? t.payStripeSub : t.payCashSub);
    }
  }

  /* ---- Llamadas al API ---- */
  async function api(ruta, body) {
    const resp = await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const e = new Error(data.error || 'error'); e.codigo = data.error; throw e; }
    return data;
  }

  async function crearReserva() {
    const r = await api('/api/reserva/crear', {
      reservaId: state.reservaId,
      idioma: lang,
      tourId: state.tour,
      fecha: state.fecha,
      adultos: state.adultos,
      menores: state.menores,
      zona: state.zona,
      hotel: state.hotel,
      nombre: state.nombre,
      email: state.email,
      telefono: state.telefono
    });
    // Si el servidor creó una reserva nueva, los documentos previos no aplican
    if (state.reservaId && state.reservaId !== r.reservaId) {
      state.subidos = { id: false, hospedaje: false };
    }
    state.reservaId = r.reservaId;
    state.codigo = r.codigo;
    save();
  }

  /* ---- Validación ---- */
  function validateStep1() {
    const errs = [];
    if (!state.tour) errs.push(t.errTour);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    if (!state.fecha || state.fecha < tomorrow) errs.push(t.errDate);
    if (!(state.adultos >= 1)) errs.push(t.errAdults);
    if (!state.hotel.trim()) errs.push(t.errHotel);
    const s = totalState();
    if (s.tour && (!s.hasPrice || s.childMissing)) return { errs, blocked: true };
    return { errs, blocked: false };
  }
  function validateStep2() {
    const errs = [];
    if (state.nombre.trim().split(/\s+/).length < 2) errs.push(t.errName);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) errs.push(t.errEmail);
    if (state.telefono.replace(/\D/g, '').length < 8) errs.push(t.errPhone);
    return { errs };
  }
  function showErrors(errs) {
    const box = $('#wz-err');
    if (!box) return;
    if (!errs.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = errs.map(e => `<div>• ${e}</div>`).join('');
  }
  function showError(msg) { showErrors([msg]); }

  /* ---- Navegación ---- */
  function setNextEnabled(on) {
    const btn = $('#wz-next');
    if (btn) btn.disabled = !on;
  }
  function setNextBusy(busy, txt) {
    const btn = $('#wz-next');
    if (!btn) return;
    btn.disabled = busy;
    btn.querySelector('span').textContent = busy ? (txt || '…') : t.next;
  }

  function render() {
    renderProgress();
    const body = $('#wz-body');
    if (state.step === 1) body.innerHTML = renderStep1();
    else if (state.step === 2) body.innerHTML = renderStep2();
    else if (state.step === 3) body.innerHTML = renderStep3();
    else if (state.step === 4) body.innerHTML = renderStep4();
    else body.innerHTML = renderStep5();

    // Tras firmar no se puede regresar (el contrato ya quedó firmado)
    $('#wz-back').style.visibility = (state.step > 1 && !(state.step === 5 && state.firmada)) ? 'visible' : 'hidden';
    $('#wz-next').style.display = state.step === 5 ? 'none' : '';
    setNextBusy(false);
    bind();
    if (state.step === 1) { const sel = $('#wz-tour'); if (sel && state.tour) sel.value = state.tour; updateTotal(); }
    if (state.step === 4) { cargarContrato(); firma = window.WMFirma.init($('#wz-firma')); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bind() {
    if (state.step === 1) {
      $('#wz-tour').addEventListener('change', e => { state.tour = e.target.value; save(); updateTotal(); });
      $('#wz-date').addEventListener('change', e => { state.fecha = e.target.value; save(); });
      $('#wz-hotel').addEventListener('input', e => { state.hotel = e.target.value; save(); });
      ['wz-adults', 'wz-children'].forEach(id => {
        $('#' + id).addEventListener('input', e => {
          const v = parseInt(e.target.value) || 0;
          if (id === 'wz-adults') state.adultos = Math.max(1, Math.min(30, v || 1));
          else state.menores = Math.max(0, Math.min(20, v));
          save(); updateTotal();
        });
      });
      wrap.querySelectorAll('[data-step]').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = $('#' + btn.dataset.step);
          const d = parseInt(btn.dataset.d);
          const min = parseInt(input.min), max = parseInt(input.max);
          const v = Math.max(min, Math.min(max, (parseInt(input.value) || 0) + d));
          input.value = v;
          input.dispatchEvent(new Event('input'));
        });
      });
      wrap.querySelectorAll('.wz-zone').forEach(btn => {
        btn.addEventListener('click', () => {
          state.zona = btn.dataset.zone;
          wrap.querySelectorAll('.wz-zone').forEach(b => b.classList.toggle('on', b === btn));
          save(); updateTotal();
        });
      });
    } else if (state.step === 2) {
      $('#wz-name').addEventListener('input', e => { state.nombre = e.target.value; save(); });
      $('#wz-email').addEventListener('input', e => { state.email = e.target.value; save(); });
      $('#wz-phone').addEventListener('input', e => { state.telefono = e.target.value; save(); });
    } else if (state.step === 3) {
      wrap.querySelectorAll('input[type=file][data-doc]').forEach(input => {
        input.addEventListener('change', () => {
          if (input.files && input.files[0]) subirDocumento(input.dataset.doc, input.files[0]);
        });
      });
    } else if (state.step === 4) {
      $('#wz-firma-clear').addEventListener('click', () => firma && firma.clear());
    } else if (state.step === 5) {
      wrap.querySelectorAll('.wz-pay').forEach(btn => {
        btn.addEventListener('click', () => pagar(btn.dataset.pay, btn));
      });
    }
  }

  $('#wz-next').addEventListener('click', async () => {
    showErrors([]);
    if (state.step === 1) {
      const v = validateStep1();
      showErrors(v.errs);
      if (v.errs.length || v.blocked) return;
      state.step = 2;
    } else if (state.step === 2) {
      const v = validateStep2();
      showErrors(v.errs);
      if (v.errs.length) return;
      setNextBusy(true);
      try { await crearReserva(); } catch (e) { setNextBusy(false); showError(t.errRed); return; }
      state.step = 3;
    } else if (state.step === 3) {
      if (!state.subidos.id || !state.subidos.hospedaje) { showError(t.errDocs); return; }
      state.step = 4;
    } else if (state.step === 4) {
      const errs = [];
      if (!$('#wz-accept').checked) errs.push(t.errAccept);
      if (!firma || firma.isEmpty()) errs.push(t.errFirma);
      if (errs.length) { showErrors(errs); return; }
      setNextBusy(true, t.firmando);
      try {
        await api('/api/reserva/firmar', {
          reservaId: state.reservaId,
          firmaPng: firma.toDataURL(),
          contratoVersion
        });
      } catch (e) {
        setNextBusy(false);
        showError(e.codigo === 'faltan_documentos' ? t.errDocs : t.errRed);
        return;
      }
      state.firmada = true;
      state.step = 5;
    }
    save(); render();
  });

  $('#wz-back').addEventListener('click', () => {
    if (state.step > 1) { state.step -= 1; save(); render(); }
  });

  /* ---- Utils ---- */
  function escapeAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  render();
})();
