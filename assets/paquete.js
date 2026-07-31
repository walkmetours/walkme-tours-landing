/* ========================================
   WalkMe · Arma tu paquete (20% al llevar 2 o más)
   - NO tiene precios propios: lee los .t-card[data-quote] de la página,
     igual que assets/cotizador.js. Así nunca se desincroniza de las fichas.
   - Fury Cozumel queda fuera solo porque su tarjeta no lleva data-quote.
   - Precio por zona con los mismos atributos del cotizador:
       data-adult (Playa) · data-adult-rm (Riviera) · data-adult-cun (Cancún)
   - Si algún elegido no tiene tarifa para la zona, NO inventa total:
     manda a confirmar por WhatsApp, igual que hace el cotizador.
   - Bilingüe (lee document.documentElement.lang)
   ======================================== */
(function() {
  const root = document.getElementById('paquete');
  if (!root) return;

  const HTML = document.documentElement;
  const lang = (HTML.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const currency = HTML.dataset.currency || 'MXN';
  const WA = '525639748122';
  const MIN = 2, MAX = 4, OFF = 0.20;

  const STR = {
    es: {
      zoneLbl: 'Zona de salida',
      zonePDC: 'Playa del Carmen', zoneRM: 'Riviera Maya', zoneCUN: 'Cancún',
      tbc: 'Cotizar',
      sumLbl: 'Tu paquete',
      empty: 'Elige al menos 2 experiencias y aquí te aparece tu total con el 20% ya aplicado.',
      one: 'Te falta 1 experiencia para activar el 20% de descuento.',
      subtotal: 'Subtotal', discount: 'Descuento 20%', total: 'Total por adulto',
      cta: 'Reservar por WhatsApp', ctaOff: 'Elige al menos 2',
      max: 'Máximo 4 experiencias por paquete.',
      tbcNote: n => `${n === 1 ? 'Una de las experiencias elegidas no tiene' : 'Algunas experiencias elegidas no tienen'} tarifa publicada para esta zona. Te confirmamos el total exacto por WhatsApp.`,
      tbcTotal: 'Te confirmamos el total por WhatsApp',
      note: 'Precio por adulto con transporte incluido. El precio de menores y la disponibilidad se confirman por WhatsApp.',
      msgHead: 'Hola WalkMe Tours, quiero armar este paquete:',
      msgZone: 'Zona de salida', msgExp: 'Experiencias',
      msgSub: 'Subtotal', msgOff: 'Descuento 20%', msgTot: 'Total por adulto',
      msgTbc: 'Por confirmar',
      msgClose: '¿Me confirman disponibilidad y el total final?\n\nEntiendo que el precio mostrado es estimado y que la reserva queda confirmada únicamente después de validar disponibilidad y realizar el pago correspondiente.'
    },
    en: {
      zoneLbl: 'Departure zone',
      zonePDC: 'Playa del Carmen', zoneRM: 'Riviera Maya', zoneCUN: 'Cancún',
      tbc: 'Get quote',
      sumLbl: 'Your package',
      empty: 'Pick at least 2 experiences and your total with 20% off shows up here.',
      one: 'Add 1 more experience to unlock the 20% discount.',
      subtotal: 'Subtotal', discount: '20% discount', total: 'Total per adult',
      cta: 'Book on WhatsApp', ctaOff: 'Pick at least 2',
      max: 'Maximum 4 experiences per package.',
      tbcNote: n => `${n === 1 ? 'One of the experiences you picked has no' : 'Some experiences you picked have no'} published rate for this zone. We confirm the exact total on WhatsApp.`,
      tbcTotal: "We'll confirm the total on WhatsApp",
      note: 'Price per adult with transport included. Child pricing and availability are confirmed on WhatsApp.',
      msgHead: 'Hi WalkMe Tours, I want to build this package:',
      msgZone: 'Departure zone', msgExp: 'Experiences',
      msgSub: 'Subtotal', msgOff: '20% discount', msgTot: 'Total per adult',
      msgTbc: 'To be confirmed',
      msgClose: 'Could you confirm availability and the final total?\n\nI understand the displayed price is an estimate and the booking is confirmed only after availability and payment are validated.'
    }
  };
  const t = STR[lang];
  const fmt = n => '$' + Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX');

  /* ---- Experiencias elegibles: las tarjetas cotizables de la página ---- */
  const ZONES = [
    { key: '',    name: t.zonePDC },
    { key: 'Rm',  name: t.zoneRM  },
    { key: 'Cun', name: t.zoneCUN }
  ];
  const items = Array.from(document.querySelectorAll('.t-card[data-quote]')).map((card, i) => {
    const prices = {};
    ZONES.forEach(z => {
      const raw = card.dataset['adult' + z.key];
      prices[z.name] = (raw === undefined || raw === '') ? null : parseFloat(raw);
    });
    return { id: 'pkg-i' + i, name: card.dataset.name, prices };
  });
  if (!items.length) return;

  /* ---- Markup ---- */
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  const panel = document.createElement('div');
  panel.className = 'pkg';
  panel.innerHTML = `
    <div class="pkg-pick">
      <div class="pkg-head">
        <span class="pkg-badge">20% OFF</span>
        <span class="pkg-zone">
          <label for="pkg-zone">${t.zoneLbl}</label>
          <select id="pkg-zone">${ZONES.map(z => `<option value="${z.name}">${z.name}</option>`).join('')}</select>
        </span>
      </div>
      <ul class="pkg-list">
        ${items.map(it => `
          <li>
            <label class="pkg-item" for="${it.id}">
              <input type="checkbox" id="${it.id}" value="${it.name.replace(/"/g, '&quot;')}">
              <span class="pkg-box">${CHECK}</span>
              <span class="pkg-item-name">${it.name}</span>
              <span class="pkg-item-price" data-price-for="${it.id}"></span>
            </label>
          </li>`).join('')}
      </ul>
    </div>
    <aside class="pkg-sum">
      <div class="pkg-sum-in">
        <p class="pkg-sum-lbl">${t.sumLbl}</p>
        <div id="pkg-out" aria-live="polite"></div>
        <button type="button" class="pkg-cta" id="pkg-cta">
          <svg><use href="#wa-icon"/></svg><span id="pkg-cta-txt">${t.ctaOff}</span>
        </button>
        <p class="pkg-note">${t.note}</p>
      </div>
    </aside>
  `;
  root.appendChild(panel);

  const zoneSel = panel.querySelector('#pkg-zone');
  const out     = panel.querySelector('#pkg-out');
  const cta     = panel.querySelector('#pkg-cta');
  const ctaTxt  = panel.querySelector('#pkg-cta-txt');
  const boxes   = Array.from(panel.querySelectorAll('.pkg-list input'));

  const zone     = () => zoneSel.value;
  const priceOf  = it => it.prices[zone()];
  const selected = () => items.filter((it, i) => boxes[i].checked);

  function render() {
    const z = zone();

    // Precio de cada fila según la zona
    items.forEach(it => {
      const el = panel.querySelector(`[data-price-for="${it.id}"]`);
      const p = it.prices[z];
      if (p === null) { el.textContent = t.tbc; el.className = 'pkg-item-tbc'; }
      else { el.textContent = fmt(p); el.className = 'pkg-item-price'; }
    });

    const sel = selected();
    // Tope de 4: bloquear las que faltan
    boxes.forEach((b, i) => {
      const off = !b.checked && sel.length >= MAX;
      b.disabled = off;
      b.closest('.pkg-item').classList.toggle('is-off', off);
    });

    if (sel.length < MIN) {
      out.innerHTML = `<p class="pkg-empty">${sel.length === 1 ? t.one : t.empty}</p>`;
      cta.setAttribute('aria-disabled', 'true');
      ctaTxt.textContent = t.ctaOff;
      return;
    }

    const chips = `<div class="pkg-chips">${sel.map(it =>
      `<span class="pkg-chip">${it.name}</span>`).join('')}</div>`;
    const sinPrecio = sel.filter(it => priceOf(it) === null);

    if (sinPrecio.length) {
      // No inventamos un total: se confirma por WhatsApp
      out.innerHTML = chips +
        `<div class="pkg-row pkg-row--total"><span>${t.total}</span></div>` +
        `<p class="pkg-note" style="margin-top:2px;opacity:.85;">${t.tbcTotal}. ${t.tbcNote(sinPrecio.length)}</p>`;
    } else {
      const sub = sel.reduce((a, it) => a + priceOf(it), 0);
      const desc = Math.round(sub * OFF);
      out.innerHTML = chips + `
        <div class="pkg-row"><span>${t.subtotal}</span><span>${fmt(sub)}</span></div>
        <div class="pkg-row pkg-row--off"><span>${t.discount}</span><span>−${fmt(desc)}</span></div>
        <div class="pkg-row pkg-row--total">
          <span>${t.total}</span>
          <span class="pkg-val">${fmt(sub - desc)}<span class="pkg-cur">${currency}</span></span>
        </div>`;
      if (sel.length >= MAX) out.innerHTML += `<p class="pkg-note" style="margin-top:8px;">${t.max}</p>`;
    }
    cta.setAttribute('aria-disabled', 'false');
    ctaTxt.textContent = t.cta;
  }

  function waMessage() {
    const sel = selected(), z = zone();
    const sinPrecio = sel.filter(it => priceOf(it) === null);
    const lineas = sel.map(it => {
      const p = priceOf(it);
      return `  · ${it.name}: ${p === null ? t.msgTbc : fmt(p) + ' ' + currency}`;
    }).join('\n');

    let totales;
    if (sinPrecio.length) {
      totales = `• ${t.msgTot}: ${t.msgTbc}`;
    } else {
      const sub = sel.reduce((a, it) => a + priceOf(it), 0);
      const desc = Math.round(sub * OFF);
      totales = `• ${t.msgSub}: ${fmt(sub)} ${currency}\n`
              + `• ${t.msgOff}: −${fmt(desc)} ${currency}\n`
              + `• ${t.msgTot}: ${fmt(sub - desc)} ${currency}`;
    }
    return `${t.msgHead}\n\n• ${t.msgZone}: ${z}\n• ${t.msgExp}:\n${lineas}\n${totales}\n\n${t.msgClose}`;
  }

  cta.addEventListener('click', () => {
    if (cta.getAttribute('aria-disabled') === 'true') return;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(waMessage())}`, '_blank', 'noopener');
  });
  boxes.forEach(b => b.addEventListener('change', render));
  zoneSel.addEventListener('change', render);
  render();
})();
