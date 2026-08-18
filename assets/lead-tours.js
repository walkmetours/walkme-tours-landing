/* ========================================
   WalkMe · Pedir cotización (lead)
   - ADICIONAL al cotizador de WhatsApp (assets/cotizador.js) — no lo toca ni
     lo reemplaza. Este formulario NO calcula precio, NO reserva, NO cobra:
     solo manda la intención del cliente a POST /api/tour/accion
     {accion:'lead_crear'}, que crea una cotización en 'borrador' en el CRM.
   - Dos formas de abrir el modal:
       1) Botón dentro de cada .t-card[data-name] → precarga esa tarjeta.
       2) Botón con [data-open-lead] en cualquier parte de la página →
          el campo de tour queda vacío y el cliente escribe cuál le interesa.
   - Bilingüe (lee document.documentElement.lang), mismo patrón que cotizador.js.
   - Reusa clases ya existentes (.qmodal, .qm-field, .qm-row, .qm-submit,
     .qm-disclaimer) para no duplicar estilos.
   ======================================== */
(function() {
  const HTML = document.documentElement;
  const lang = (HTML.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const WA = '525639748122';

  const STR = {
    es: {
      eyebrow: 'Cotización sin compromiso',
      titleGeneric: '¿Qué tour te interesa?',
      cardBtn: 'Pedir cotización por formulario',
      fServicio: 'Tour de interés',
      fServicioPh: 'Escribe el tour que te interesa',
      fFecha: 'Fecha deseada (opcional)',
      fAdultos: 'Adultos', fMenores: 'Menores de 11',
      fNombre: 'Nombre completo',
      fEmail: 'Correo electrónico', fTelefono: 'WhatsApp o teléfono',
      contactHint: 'Déjanos al menos uno: correo o teléfono.',
      fNotas: 'Notas (opcional)', fNotasPh: 'Fechas flexibles, hotel, alguna duda…',
      submit: 'Enviar solicitud', sending: 'Enviando…',
      disclaimer: 'Esto no es una reserva. Recibimos tu solicitud y te contactamos para cotizarte y confirmar disponibilidad.',
      okTitle: '¡Listo!',
      okMsg: 'Recibimos tu solicitud, te contactamos pronto.',
      okFolio: folio => `Referencia: ${folio}`,
      okClose: 'Cerrar',
      errors: {
        nombre_requerido: 'Escribe tu nombre.',
        servicio_requerido: 'Dinos qué tour te interesa.',
        contacto_requerido: 'Déjanos tu correo o tu teléfono.',
        email_invalido: 'Revisa tu correo electrónico.',
        demasiadas_solicitudes: 'Demasiadas solicitudes seguidas. Espera un momento o escríbenos por WhatsApp.',
        no_configurado: 'La cotización en línea aún no está activa. Escríbenos por WhatsApp y te ayudamos directo.',
        red: 'No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.'
      },
      waFallback: 'Abrir WhatsApp',
      waMsg: name => `Hola WalkMe Tours, quiero que me coticen: ${name || 'un tour'}`
    },
    en: {
      eyebrow: 'No-commitment quote',
      titleGeneric: 'Which tour interests you?',
      cardBtn: 'Request a quote by form',
      fServicio: 'Tour of interest',
      fServicioPh: "Type the tour you're interested in",
      fFecha: 'Desired date (optional)',
      fAdultos: 'Adults', fMenores: 'Children under 11',
      fNombre: 'Full name',
      fEmail: 'Email', fTelefono: 'WhatsApp or phone',
      contactHint: 'Leave us at least one: email or phone.',
      fNotas: 'Notes (optional)', fNotasPh: 'Flexible dates, hotel, any question…',
      submit: 'Send request', sending: 'Sending…',
      disclaimer: "This is not a booking. We receive your request and contact you to quote and confirm availability.",
      okTitle: 'All set!',
      okMsg: "We received your request, we'll be in touch soon.",
      okFolio: folio => `Reference: ${folio}`,
      okClose: 'Close',
      errors: {
        nombre_requerido: 'Please enter your name.',
        servicio_requerido: 'Tell us which tour you want.',
        contacto_requerido: 'Leave us your email or phone.',
        email_invalido: 'Check your email address.',
        demasiadas_solicitudes: 'Too many requests in a row. Wait a moment or message us on WhatsApp.',
        no_configurado: "Online quotes aren't active yet. Message us on WhatsApp and we'll help directly.",
        red: "We couldn't send your request. Try again or message us on WhatsApp."
      },
      waFallback: 'Open WhatsApp',
      waMsg: name => `Hi WalkMe Tours, I'd like a quote for: ${name || 'a tour'}`
    }
  };
  const t = STR[lang];

  /* ---- Build modal once ---- */
  const modal = document.createElement('div');
  modal.className = 'qmodal';
  modal.id = 'leadModal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="qmodal-bg" data-close></div>
    <div class="qmodal-box" role="dialog" aria-modal="true">
      <button class="qmodal-close" type="button" data-close aria-label="Close">×</button>
      <p class="qmodal-eyebrow">${t.eyebrow}</p>
      <h3 class="qmodal-name" id="lq-title">${t.titleGeneric}</h3>
      <form class="qmodal-form" id="lq-form" novalidate>
        <div id="lq-fields">
          <div class="qm-field">
            <label for="lq-servicio">${t.fServicio}</label>
            <input type="text" id="lq-servicio" placeholder="${t.fServicioPh}" required>
          </div>
          <div class="qm-row">
            <div class="qm-field">
              <label for="lq-adultos">${t.fAdultos}</label>
              <input type="number" id="lq-adultos" min="1" max="20" value="2" required>
            </div>
            <div class="qm-field">
              <label for="lq-menores">${t.fMenores}</label>
              <input type="number" id="lq-menores" min="0" max="20" value="0">
            </div>
          </div>
          <div class="qm-field">
            <label for="lq-fecha">${t.fFecha}</label>
            <input type="date" id="lq-fecha">
          </div>
          <div class="qm-field">
            <label for="lq-nombre">${t.fNombre}</label>
            <input type="text" id="lq-nombre" required>
          </div>
          <div class="qm-row">
            <div class="qm-field">
              <label for="lq-email">${t.fEmail}</label>
              <input type="email" id="lq-email">
            </div>
            <div class="qm-field">
              <label for="lq-telefono">${t.fTelefono}</label>
              <input type="tel" id="lq-telefono">
            </div>
          </div>
          <p class="qm-disclaimer" style="text-align:left;margin:-6px 0 4px;">${t.contactHint}</p>
          <div class="qm-field">
            <label for="lq-notas">${t.fNotas}</label>
            <input type="text" id="lq-notas" placeholder="${t.fNotasPh}">
          </div>
          <!-- Honeypot: invisible para humanos, los bots lo llenan -->
          <input type="text" id="lq-hp" name="lq-hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;height:0;width:0;opacity:0;">
          <div id="lq-error" style="display:none;background:#fdecec;border:2px solid #E8397D;border-radius:12px;padding:12px 16px;font-size:13px;color:#7a1230;line-height:1.5;margin-bottom:14px;"></div>
          <button type="submit" class="qm-submit" id="lq-submit"><span>${t.submit}</span></button>
          <p class="qm-disclaimer">${t.disclaimer}</p>
        </div>
        <div id="lq-success" style="display:none;">
          <div style="background:var(--yellow);border-radius:14px;padding:22px 18px;text-align:center;margin-bottom:16px;">
            <div style="font-family:'GTEesti', sans-serif;font-size:24px;color:var(--green);margin-bottom:6px;">${t.okTitle}</div>
            <div id="lq-success-msg" style="font-size:14px;color:var(--green);line-height:1.5;"></div>
          </div>
          <button type="button" class="qm-submit" id="lq-success-close">${t.okClose}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const form = modal.querySelector('#lq-form');
  const fieldsWrap = modal.querySelector('#lq-fields');
  const submitBtn = modal.querySelector('#lq-submit');
  const submitLabel = submitBtn.querySelector('span');
  const errorBox = modal.querySelector('#lq-error');
  const successBox = modal.querySelector('#lq-success');
  const successMsg = modal.querySelector('#lq-success-msg');
  const titleEl = modal.querySelector('#lq-title');
  const servicioInput = modal.querySelector('#lq-servicio');
  let enviando = false;

  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
  modal.querySelector('#lq-success-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  function resetForm() {
    form.reset();
    modal.querySelector('#lq-adultos').value = 2;
    modal.querySelector('#lq-menores').value = 0;
    errorBox.style.display = 'none';
    fieldsWrap.style.display = '';
    successBox.style.display = 'none';
    enviando = false;
    submitBtn.disabled = false;
    submitLabel.textContent = t.submit;
  }

  function openModal(serviceName) {
    resetForm();
    if (serviceName) {
      servicioInput.value = serviceName;
      titleEl.textContent = serviceName;
    } else {
      servicioInput.value = '';
      titleEl.textContent = t.titleGeneric;
    }
    const dateInput = modal.querySelector('#lq-fecha');
    dateInput.min = new Date().toISOString().split('T')[0];
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => (serviceName ? modal.querySelector('#lq-nombre') : servicioInput).focus(), 200);
  }
  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function mostrarError(codigo) {
    const msgTexto = t.errors[codigo] || t.errors.red;
    errorBox.textContent = '';
    errorBox.append(msgTexto + ' ');
    const wa = document.createElement('a');
    wa.href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(t.waMsg(servicioInput.value.trim()));
    wa.target = '_blank'; wa.rel = 'noopener';
    wa.style.cssText = 'color:#7a1230;font-weight:bold;text-decoration:underline;';
    wa.textContent = t.waFallback;
    errorBox.append(wa);
    errorBox.style.display = 'block';
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (enviando) return; // doble submit = doble cotización

    const nombre = modal.querySelector('#lq-nombre').value.trim();
    const servicio = servicioInput.value.trim();
    const email = modal.querySelector('#lq-email').value.trim();
    const telefono = modal.querySelector('#lq-telefono').value.trim();

    errorBox.style.display = 'none';
    if (!nombre) return mostrarError('nombre_requerido');
    if (!servicio) return mostrarError('servicio_requerido');
    if (!email && !telefono) return mostrarError('contacto_requerido');

    enviando = true;
    submitBtn.disabled = true;
    submitLabel.textContent = t.sending;

    try {
      const r = await fetch('/api/tour/accion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'lead_crear',
          idioma: lang,
          nombre,
          email,
          telefono,
          servicio_nombre: servicio,
          fecha: modal.querySelector('#lq-fecha').value || undefined,
          adultos: modal.querySelector('#lq-adultos').value,
          menores: modal.querySelector('#lq-menores').value,
          notas: modal.querySelector('#lq-notas').value.trim() || undefined,
          hp: modal.querySelector('#lq-hp').value
        })
      });
      const data = await r.json();
      if (!r.ok) {
        mostrarError(data.error);
        enviando = false;
        submitBtn.disabled = false;
        submitLabel.textContent = t.submit;
        return;
      }
      successMsg.textContent = t.okMsg + (data.folio ? ' ' + t.okFolio(data.folio) : '');
      fieldsWrap.style.display = 'none';
      successBox.style.display = 'block';
    } catch (err) {
      mostrarError('red');
      enviando = false;
      submitBtn.disabled = false;
      submitLabel.textContent = t.submit;
    }
  });

  /* ---- Triggers ---- */
  // Un botón por tarjeta de tour: precarga el nombre de esa tarjeta.
  document.querySelectorAll('.t-card[data-name]').forEach(card => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 't-btn-lead';
    btn.textContent = t.cardBtn;
    btn.addEventListener('click', () => openModal(card.dataset.name));
    card.appendChild(btn);
  });
  // Botón genérico en cualquier parte de la página: el cliente escribe el tour.
  document.querySelectorAll('[data-open-lead]').forEach(btn => {
    btn.addEventListener('click', () => openModal());
  });
})();
