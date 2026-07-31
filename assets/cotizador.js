/* ========================================
   WalkMe · Cotizador
   - Lee precios desde data-adult/data-child de cada .t-card[data-quote]
   - Precio por zona de salida (contrato Cabo Safe 2026):
       data-adult/data-child          → Playa del Carmen (base, es lo que se muestra en la ficha)
       data-adult-rm/data-child-rm    → Riviera Maya   (opcional)
       data-adult-cun/data-child-cun  → Cancún         (opcional)
     Si la zona elegida no tiene precio para ese producto → cotización personalizada
   - Abre WhatsApp con mensaje prellenado
   - Bilingüe (lee document.documentElement.lang)
   - Moneda configurable vía <html data-currency="USD|MXN">
   ======================================== */
(function() {
  const HTML = document.documentElement;
  const lang = (HTML.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const currency = HTML.dataset.currency || 'USD';
  const WA = '525639748122';

  const STR = {
    es: {
      adult: 'Adulto', child: 'Menor <11',
      childTBC: 'Precio de menor sujeto a confirmación',
      note1: 'Precio con transporte desde Playa del Carmen',
      note2: 'Desde Cancún, Tulum u otra zona: cotización personalizada',
      note2Zone: 'Desde Riviera Maya o Cancún el precio cambia: calcúlalo al cotizar',
      btn: 'Calcular y consultar por WhatsApp',
      eyebrow: 'Cotizar experiencia',
      fDate: 'Fecha deseada', fAdults: 'Adultos', fChildren: 'Menores de 11 años',
      fZone: 'Zona de salida', fHotel: 'Hotel o punto de encuentro', fName: 'Nombre',
      zonePDC: 'Playa del Carmen', zoneRM: 'Riviera Maya', zoneCUN: 'Cancún',
      totalLbl: 'Total estimado', incluye: z => `Incluye transporte desde ${z}.`,
      custom: 'Esta salida requiere cotización personalizada. Te confirmamos el total por WhatsApp.',
      childPending: 'Precio de menor sujeto a confirmación.',
      submit: 'Enviar consulta por WhatsApp',
      disclaimer: 'El precio mostrado es estimado. La reserva se confirma al validar disponibilidad y pago.',
      msgHeader: 'Hola WalkMe Tours, quiero consultar esta experiencia:',
      msgExp: 'Experiencia', msgDate: 'Fecha deseada', msgAd: 'Adultos',
      msgCh: 'Menores de 11 años', msgZ: 'Zona de salida',
      msgH: 'Hotel o punto de encuentro', msgN: 'Nombre',
      msgP: 'Precio estimado', msgQ: '¿Requiere cotización personalizada?',
      msgYes: 'Sí', msgNo: 'No',
      msgClose: '¿Me pueden confirmar disponibilidad y el total final?\n\nEntiendo que el precio mostrado es estimado y que la reserva queda confirmada únicamente después de validar disponibilidad y realizar el pago correspondiente.',
      customQuote: 'Cotización personalizada'
    },
    en: {
      adult: 'Adult', child: 'Child <11',
      childTBC: 'Child price to be confirmed',
      note1: 'Price with transport from Playa del Carmen',
      note2: 'From Cancún, Tulum or another zone: custom quote',
      note2Zone: 'From Riviera Maya or Cancún the price changes: calculate it in the quote form',
      btn: 'Calculate & ask on WhatsApp',
      eyebrow: 'Quote experience',
      fDate: 'Desired date', fAdults: 'Adults', fChildren: 'Children under 11',
      fZone: 'Departure zone', fHotel: 'Hotel or meeting point', fName: 'Name',
      zonePDC: 'Playa del Carmen', zoneRM: 'Riviera Maya', zoneCUN: 'Cancún',
      totalLbl: 'Estimated total', incluye: z => `Includes transport from ${z}.`,
      custom: 'This departure needs a custom quote. We confirm the total on WhatsApp.',
      childPending: 'Child price to be confirmed.',
      submit: 'Send inquiry on WhatsApp',
      disclaimer: 'The displayed price is an estimate. The booking is confirmed after availability and payment are validated.',
      msgHeader: 'Hi WalkMe Tours, I have a question about this experience:',
      msgExp: 'Experience', msgDate: 'Desired date', msgAd: 'Adults',
      msgCh: 'Children under 11', msgZ: 'Departure zone',
      msgH: 'Hotel or meeting point', msgN: 'Name',
      msgP: 'Estimated price', msgQ: 'Needs custom quote?',
      msgYes: 'Yes', msgNo: 'No',
      msgClose: 'Could you confirm availability and the final total?\n\nI understand the displayed price is an estimate and the booking is confirmed only after availability and payment are validated.',
      customQuote: 'Custom quote'
    }
  };
  const t = STR[lang];
  const fmt = n => '$' + Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX');

  /* Lee un par adulto/menor del dataset. Devuelve null si esa zona no tiene precio. */
  function readPrices(ds, suffix) {
    const adultRaw = ds['adult' + suffix];
    if (adultRaw === undefined || adultRaw === '') return null;
    const childRaw = ds['child' + suffix];
    return {
      adult: parseFloat(adultRaw),
      child: (childRaw === undefined || childRaw === '') ? null : parseFloat(childRaw)
    };
  }

  /* Precios por zona de una tarjeta. Playa del Carmen es la base y siempre existe. */
  function readZones(card) {
    return {
      [t.zonePDC]: readPrices(card.dataset, ''),
      [t.zoneRM]:  readPrices(card.dataset, 'Rm'),
      [t.zoneCUN]: readPrices(card.dataset, 'Cun')
    };
  }

  /* ---- Render visible price block on each [data-quote] card ---- */
  document.querySelectorAll('.t-card[data-quote]').forEach(card => {
    // La ficha muestra SIEMPRE y SOLO el precio desde Playa del Carmen.
    // Riviera Maya y Cancún viven únicamente dentro del modal del cotizador.
    const adult = parseFloat(card.dataset.adult);
    const childRaw = card.dataset.child;
    const child = (childRaw === undefined || childRaw === '') ? null : parseFloat(childRaw);
    const zones = readZones(card);
    const hasZonePricing = !!(zones[t.zoneRM] || zones[t.zoneCUN]);

    // remove any pre-existing CTA buttons
    card.querySelectorAll('.t-btn, .t-btn-quote').forEach(el => el.remove());

    const body = card.querySelector('.t-body');
    const quote = document.createElement('div');
    quote.className = 't-quote';
    quote.innerHTML = `
      <div class="t-prices-row">
        <div class="t-pr">
          <span class="t-plbl">${t.adult}</span>
          <span class="t-pval">${fmt(adult)}<span class="t-pcur">${currency}</span></span>
        </div>
        ${child !== null
          ? `<div class="t-pr">
               <span class="t-plbl">${t.child}</span>
               <span class="t-pval">${fmt(child)}<span class="t-pcur">${currency}</span></span>
             </div>`
          : `<div class="t-pr-tbc">${t.childTBC}</div>`}
      </div>
      <div class="t-notes">
        <div class="t-note-pdc">${t.note1}</div>
        <div class="t-note-other">${hasZonePricing ? t.note2Zone : t.note2}</div>
      </div>
    `;
    body.appendChild(quote);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 't-btn-quote';
    btn.innerHTML = `<svg width="14" height="14"><use href="#wa-icon"/></svg><span>${t.btn}</span>`;
    btn.addEventListener('click', () => openModal(card));
    card.appendChild(btn);
  });

  /* ---- Build modal once ---- */
  const modal = document.createElement('div');
  modal.className = 'qmodal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="qmodal-bg" data-close></div>
    <div class="qmodal-box" role="dialog" aria-modal="true">
      <button class="qmodal-close" type="button" data-close aria-label="Cerrar">×</button>
      <p class="qmodal-eyebrow">${t.eyebrow}</p>
      <h3 class="qmodal-name" id="qm-name">—</h3>
      <form class="qmodal-form" id="qm-form" novalidate>
        <div class="qm-field">
          <label for="qm-date">${t.fDate}</label>
          <input type="date" id="qm-date" required>
        </div>
        <div class="qm-row">
          <div class="qm-field">
            <label for="qm-adults">${t.fAdults}</label>
            <input type="number" id="qm-adults" min="1" max="30" value="2" required>
          </div>
          <div class="qm-field">
            <label for="qm-children">${t.fChildren}</label>
            <input type="number" id="qm-children" min="0" max="20" value="0">
          </div>
        </div>
        <div class="qm-field">
          <label for="qm-zone">${t.fZone}</label>
          <select id="qm-zone" required>
            <option value="${t.zonePDC}">${t.zonePDC}</option>
            <option value="${t.zoneRM}">${t.zoneRM}</option>
            <option value="${t.zoneCUN}">${t.zoneCUN}</option>
          </select>
        </div>
        <div class="qm-field">
          <label for="qm-hotel">${t.fHotel}</label>
          <input type="text" id="qm-hotel" required>
        </div>
        <div class="qm-field">
          <label for="qm-fullname">${t.fName}</label>
          <input type="text" id="qm-fullname" required>
        </div>
        <div class="qm-total" id="qm-total"></div>
        <button type="submit" class="qm-submit" id="qm-submit">
          <svg width="18" height="18"><use href="#wa-icon"/></svg>
          <span>${t.submit}</span>
        </button>
        <p class="qm-disclaimer">${t.disclaimer}</p>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  // Min date = today
  const dateInput = modal.querySelector('#qm-date');
  dateInput.min = new Date().toISOString().split('T')[0];

  // Close handlers
  modal.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  // Current experience state — zones: { [nombre de zona]: {adult, child} | null }
  let current = { name: '—', zones: {} };

  function openModal(card) {
    current = {
      name: card.dataset.name,
      zones: readZones(card)
    };
    // Cada tarjeta puede tener zonas distintas; siempre reabrir en Playa del Carmen.
    modal.querySelector('#qm-zone').value = t.zonePDC;
    modal.querySelector('#qm-name').textContent = current.name;
    updateTotal();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => modal.querySelector('#qm-date').focus(), 200);
  }
  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  // Live total
  ['qm-adults','qm-children','qm-zone'].forEach(id => {
    modal.querySelector('#' + id).addEventListener('input', updateTotal);
    modal.querySelector('#' + id).addEventListener('change', updateTotal);
  });

  function getTotalState() {
    const adults = parseInt(modal.querySelector('#qm-adults').value) || 0;
    const children = parseInt(modal.querySelector('#qm-children').value) || 0;
    const zone = modal.querySelector('#qm-zone').value;
    // Si el producto no tiene tarifa para esa zona → cotización personalizada
    const prices = current.zones[zone] || null;
    const hasPrice = prices !== null;
    const childMissing = hasPrice && prices.child === null && children > 0;
    let total = null;
    if (hasPrice && !childMissing) {
      total = adults * prices.adult + children * (prices.child || 0);
    }
    return { adults, children, zone, prices, hasPrice, childMissing, total };
  }

  function updateTotal() {
    const totalEl = modal.querySelector('#qm-total');
    const s = getTotalState();
    if (!s.hasPrice) {
      totalEl.className = 'qm-total custom';
      totalEl.innerHTML = `<div class="qm-total-note">${t.custom}</div>`;
    } else if (s.childMissing) {
      const adultSubtotal = s.adults * s.prices.adult;
      totalEl.className = 'qm-total';
      totalEl.innerHTML = `
        <div class="qm-total-row main"><span>${t.totalLbl} (${t.adult.toLowerCase()})</span><span class="qm-total-val">${fmt(adultSubtotal)} ${currency}</span></div>
        <div class="qm-total-note">${t.childPending} ${t.incluye(s.zone)}</div>
      `;
    } else {
      totalEl.className = 'qm-total pdc';
      totalEl.innerHTML = `
        <div class="qm-total-row main"><span>${t.totalLbl}</span><span class="qm-total-val">${fmt(s.total)} ${currency}</span></div>
        <div class="qm-total-note">${t.incluye(s.zone)}</div>
      `;
    }
  }

  /* ---- Submit → WhatsApp ---- */
  modal.querySelector('#qm-form').addEventListener('submit', e => {
    e.preventDefault();
    const date = modal.querySelector('#qm-date').value;
    const hotel = modal.querySelector('#qm-hotel').value.trim();
    const name = modal.querySelector('#qm-fullname').value.trim();
    if (!date || !hotel || !name) {
      const missing = modal.querySelector('input:invalid');
      if (missing) missing.focus();
      return;
    }
    const s = getTotalState();
    let priceLine, quoteLine;
    if (!s.hasPrice) {
      priceLine = t.customQuote;
      quoteLine = t.msgYes;
    } else if (s.childMissing) {
      priceLine = `${fmt(s.adults * s.prices.adult)} ${currency} (${t.adult.toLowerCase()}) · ${t.childPending}`;
      quoteLine = t.msgNo;
    } else {
      priceLine = `${fmt(s.total)} ${currency}`;
      quoteLine = t.msgNo;
    }

    const msg =
`${t.msgHeader}

• ${t.msgExp}: ${current.name}
• ${t.msgDate}: ${formatDate(date)}
• ${t.msgAd}: ${s.adults}
• ${t.msgCh}: ${s.children}
• ${t.msgZ}: ${s.zone}
• ${t.msgH}: ${hotel}
• ${t.msgN}: ${name}
• ${t.msgP}: ${priceLine}
• ${t.msgQ}: ${quoteLine}

${t.msgClose}`;

    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    const monthsEs = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const monthsEn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const months = lang === 'en' ? monthsEn : monthsEs;
    return `${d} ${months[parseInt(m)-1]} ${y}`;
  }
})();
