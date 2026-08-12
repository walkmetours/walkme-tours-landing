/* ========================================
   WalkMe · Wizard de reserva en línea (mobile-first)
   - Pasos: 1 Tour y fecha · 2 Tus datos · 3 Documentos ·
            4 Contrato y firma · 5 Pago · 6 Cupón
   - Fase 1: pasos 1 y 2 activos; 3-6 se activan en fases siguientes.
   - Precios desde assets/catalogo.js (window.WM_CATALOGO), misma
     lógica de zonas que assets/cotizador.js. El total mostrado es
     informativo: el servidor lo recalcula al crear la reserva.
   - Bilingüe (document.documentElement.lang) · moneda data-currency.
   - Estado en sessionStorage (recargar no pierde lo capturado).
   ======================================== */
(function () {
  const HTML = document.documentElement;
  const lang = (HTML.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const currency = HTML.dataset.currency || 'MXN';
  const WA = '525639748122';
  const CAT = (window.WM_CATALOGO && window.WM_CATALOGO.tours) || [];
  const STORE_KEY = 'wm-reserva';

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
      resumen: 'Resumen de tu reserva',
      rTour: 'Experiencia', rDate: 'Fecha', rPax: 'Personas', rZone: 'Salida', rHotel: 'Hotel', rName: 'Nombre', rEmail: 'Correo', rPhone: 'Teléfono',
      adultsWord: n => n === 1 ? 'adulto' : 'adultos', childrenWord: n => n === 1 ? 'menor' : 'menores',
      wipTitle: 'Ya casi terminamos',
      wipBody: 'Los siguientes pasos (documentos, contrato, pago y cupón) se activan muy pronto. Mientras tanto puedes confirmar esta reserva por WhatsApp con un toque:',
      wipBtn: 'Confirmar por WhatsApp',
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
      resumen: 'Booking summary',
      rTour: 'Experience', rDate: 'Date', rPax: 'Guests', rZone: 'Departure', rHotel: 'Hotel', rName: 'Name', rEmail: 'Email', rPhone: 'Phone',
      adultsWord: n => n === 1 ? 'adult' : 'adults', childrenWord: n => n === 1 ? 'child' : 'children',
      wipTitle: 'Almost ready',
      wipBody: 'The next steps (documents, contract, payment and voucher) are coming very soon. Meanwhile you can confirm this booking on WhatsApp in one tap:',
      wipBtn: 'Confirm on WhatsApp',
      msgHeader: 'Hi WalkMe Tours, I want to book:',
      privacy: 'Your info is only used to manage your booking.'
    }
  };
  const t = STR[lang];
  const fmt = n => '$' + Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX');
  const ZONE_NAME = { pdc: t.zonePDC, rm: t.zoneRM, cun: t.zoneCUN };

  /* ---- Estado ---- */
  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save() { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  const state = Object.assign({
    step: 1, tour: '', fecha: '', adultos: 2, menores: 0, zona: 'pdc',
    hotel: '', nombre: '', email: '', telefono: ''
  }, load());
  if (state.step > 2) state.step = 2; // fase 1: solo pasos 1-2

  const $ = sel => document.querySelector(sel);
  const wrap = $('#wz');
  if (!wrap) return;

  /* ---- Progreso ---- */
  function renderProgress() {
    const bar = $('#wz-progress');
    bar.innerHTML = t.steps.map((label, i) => {
      const n = i + 1;
      const cls = n < state.step ? 'done' : (n === state.step ? 'now' : '');
      return `<div class="wz-p ${cls}"><span class="wz-p-dot">${n < state.step ? '✓' : n}</span><span class="wz-p-lbl">${label}</span></div>`;
    }).join('');
    $('#wz-stepof').textContent = t.stepOf(state.step, t.steps.length);
  }

  /* ---- Paso 1: tour y fecha ---- */
  function tourById(id) { return CAT.find(x => x.id === id) || null; }

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
      <div class="wz-err" id="wz-err1" hidden></div>
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
    const msg = `${t.msgHeader}\n\n• ${t.rTour}: ${tour ? tour.nombre[lang] : ''}\n• ${t.rDate}: ${state.fecha}\n• ${t.rPax}: ${state.adultos} ${t.adultsWord(state.adultos)}, ${state.menores} ${t.childrenWord(state.menores)}\n• ${t.rZone}: ${ZONE_NAME[state.zona]}\n• ${t.rHotel}: ${state.hotel}`;
    return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
  }

  function updateTotal() {
    const box = $('#wz-total');
    if (!box) return;
    const s = totalState();
    if (!s.tour) { box.className = 'qm-total'; box.innerHTML = ''; box.style.display = 'none'; setNextEnabled(true); return; }
    box.style.display = '';
    const nota = s.tour.nota ? `<div class="qm-total-note">${s.tour.nota[lang]}</div>` : '';
    if (!s.hasPrice) {
      box.className = 'qm-total custom';
      box.innerHTML = `<div class="qm-total-note">${t.custom}</div>
        <a class="wz-wa-mini" href="${waLink()}" target="_blank" rel="noopener"><svg width="16" height="16"><use href="#wa-icon"/></svg>${t.customBtn}</a>`;
      setNextEnabled(false);
    } else if (s.childMissing) {
      box.className = 'qm-total custom';
      box.innerHTML = `<div class="qm-total-note">${t.childPending}</div>
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

  /* ---- Paso 2: datos ---- */
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
      <div class="wz-err" id="wz-err2" hidden></div>
    `;
  }

  /* ---- Fase 1: pantalla puente tras el paso 2 ---- */
  function renderWip() {
    const s = totalState();
    const rows = [
      [t.rTour, s.tour ? s.tour.nombre[lang] : ''],
      [t.rDate, state.fecha],
      [t.rPax, `${state.adultos} ${t.adultsWord(state.adultos)}, ${state.menores} ${t.childrenWord(state.menores)}`],
      [t.rZone, ZONE_NAME[state.zona]],
      [t.rHotel, state.hotel],
      [t.rName, state.nombre],
      [t.rEmail, state.email],
      [t.rPhone, state.telefono],
      [t.totalLbl, s.total !== null ? `${fmt(s.total)} ${currency}` : '—']
    ];
    return `
      <h3 class="wz-wip-title">${t.wipTitle}</h3>
      <div class="wz-resumen">
        <p class="wz-resumen-t">${t.resumen}</p>
        ${rows.map(r => `<div class="wz-res-row"><span>${r[0]}</span><strong>${escapeHtml(String(r[1]))}</strong></div>`).join('')}
      </div>
      <p class="wz-wip-body">${t.wipBody}</p>
      <a class="qm-submit wz-wa-full" href="${waLink()}" target="_blank" rel="noopener">
        <svg width="18" height="18"><use href="#wa-icon"/></svg><span>${t.wipBtn}</span>
      </a>
    `;
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
  function showErrors(id, errs) {
    const box = $(id);
    if (!box) return;
    if (!errs.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = errs.map(e => `<div>• ${e}</div>`).join('');
  }

  /* ---- Navegación ---- */
  function setNextEnabled(on) {
    const btn = $('#wz-next');
    if (btn) btn.disabled = !on;
  }

  function render() {
    renderProgress();
    const body = $('#wz-body');
    if (state.step === 1) body.innerHTML = renderStep1();
    else if (state.step === 2) body.innerHTML = renderStep2();
    else body.innerHTML = renderWip();

    $('#wz-back').style.visibility = state.step > 1 ? 'visible' : 'hidden';
    $('#wz-next').style.display = state.step === 3 ? 'none' : '';
    bind();
    if (state.step === 1) { const sel = $('#wz-tour'); if (sel && state.tour) sel.value = state.tour; updateTotal(); }
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
    }
  }

  $('#wz-next').addEventListener('click', () => {
    if (state.step === 1) {
      const v = validateStep1();
      showErrors('#wz-err1', v.errs);
      if (v.errs.length || v.blocked) return;
      state.step = 2;
    } else if (state.step === 2) {
      const v = validateStep2();
      showErrors('#wz-err2', v.errs);
      if (v.errs.length) return;
      state.step = 3; // fase 1: pantalla puente
    }
    save(); render();
  });
  $('#wz-back').addEventListener('click', () => {
    if (state.step > 1) { state.step -= 1; save(); render(); }
  });

  /* ---- Utils ---- */
  function escapeAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  render();
})();
