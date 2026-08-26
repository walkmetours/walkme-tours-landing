/* ========================================
   JOYÀ · Cirque du Soleil — modal de reserva.
   Abre con [data-open-joya] data-tier="...", calcula el total en vivo
   (espejo de api/_lib/catalogo-joya.js — el servidor SIEMPRE recalcula,
   esto es solo para que el cliente vea el total antes de enviar) y hace
   POST /api/joya/crear → redirige a cupon-joya.html?t=<token>.
   Vanilla, sin dependencias. Textos en window.JOYA_LANG ('es' | 'en').
   ======================================== */
(function () {
  var LANG = window.JOYA_LANG === 'en' ? 'en' : 'es';

  var TIERS = {
    'vip':              { nombre: { es: 'VIP Show & Cena', en: 'VIP Show & Dinner' }, seccion: { es: 'Sección VIP', en: 'VIP section' }, adulto: 6900, nino: 4830, jungala: false },
    'show-cena':        { nombre: { es: 'Show & Cena', en: 'Show & Dinner' }, seccion: { es: 'Secciones 2 y 3', en: 'Sections 2 and 3' }, adulto: 5140, nino: 3598, jungala: false },
    'celebration':      { nombre: { es: 'Celebration', en: 'Celebration' }, seccion: { es: 'Secciones 4 y 5', en: 'Sections 4 and 5' }, adulto: 3760, nino: 2632, jungala: false },
    'elite':             { nombre: { es: 'Elite Show', en: 'Elite Show' }, seccion: { es: 'Secciones 6 y 7', en: 'Sections 6 and 7' }, adulto: 2780, nino: 1946, jungala: false },
    'solo-central':      { nombre: { es: 'Solo Show · Silla central', en: 'Show Only · Central chair' }, seccion: { es: '8 y 9 sillas bajas · 4 a 7 altas centro', en: '8-9 low chairs · 4-7 high chairs center' }, adulto: 2140, nino: 1070, jungala: false },
    'solo-lateral':      { nombre: { es: 'Solo Show · Silla lateral', en: 'Show Only · Side chair' }, seccion: { es: 'Secciones 8 y 9, filas L y M', en: 'Sections 8 and 9, rows L and M' }, adulto: 1980, nino: 990, jungala: false },
    'jungala-daypass':   { nombre: { es: 'Jungala · Daypass', en: 'Jungala · Daypass' }, seccion: { es: 'Parque acuático Vidanta', en: 'Vidanta water park' }, adulto: 1401, nino: 981, jungala: true },
    'jungala-beyond':    { nombre: { es: 'Jungala · Beyond', en: 'Jungala · Beyond' }, seccion: { es: 'Parque acuático Vidanta', en: 'Vidanta water park' }, adulto: 1990, nino: 1392, jungala: true }
  };
  var TRANSPORTE = {
    'no':      { label: { es: 'Sin transporte', en: 'No transport' }, tarifa: 0 },
    'pdc':     { label: { es: 'Playa del Carmen', en: 'Playa del Carmen' }, tarifa: 600 },
    'riviera': { label: { es: 'Riviera Maya', en: 'Riviera Maya' }, tarifa: 700 },
    'cun':     { label: { es: 'Cancún', en: 'Cancun' }, tarifa: 700 }
  };
  var HORARIOS_JOYA = ['19:00', '20:30'];
  var HORARIOS_JUNGALA = ['10:00', '12:00', '14:00'];

  var T = LANG === 'en' ? {
    reservando: 'You are booking', paso1: 'Date and guests', paso2: 'Transport and hotel', paso3: 'Your details',
    fecha: 'Date', horario: 'Show time', adultos: 'Adults', ninos: 'Children', rangoAd: '(13+)', rangoNi: '(3 to 12)',
    hotel: 'Hotel or address where you are staying', hotelPh: 'e.g. Hotel Xcaret Mexico, Playa del Carmen',
    nombre: 'Full name', nombrePh: 'Laura Mendoza', correo: 'Email', correoPh: 'laura@email.com', tel: 'WhatsApp', telPh: '+1 555 234 5678',
    notas: 'Anything we should know', notasPh: 'Birthday, wheelchair, allergies…',
    resumen: 'Your booking', experiencia: 'Experience', personas: 'Guests', boletos: 'Tickets', transporte: 'Transport', noIncluido: 'Not included',
    total: 'Estimated total', generar: 'Generate booking request', generarNota: 'This does not charge anything. We confirm availability and send the payment link.',
    enviando: 'Sending…', errorGenerico: 'Something went wrong. Please try again or write to us on WhatsApp.'
  } : {
    reservando: 'Estás reservando', paso1: 'Fecha y personas', paso2: 'Transporte y hospedaje', paso3: 'Tus datos',
    fecha: 'Fecha de la función', horario: 'Horario', adultos: 'Adultos', ninos: 'Niños', rangoAd: '(13+)', rangoNi: '(3 a 12)',
    hotel: 'Hotel o dirección donde te hospedas', hotelPh: 'Ej. Hotel Xcaret México, Playa del Carmen',
    nombre: 'Nombre completo', nombrePh: 'Laura Mendoza', correo: 'Correo', correoPh: 'laura@correo.com', tel: 'WhatsApp', telPh: '+1 555 234 5678',
    notas: 'Algo que debamos saber', notasPh: 'Cumpleaños, silla de ruedas, alergias…',
    resumen: 'Tu reserva', experiencia: 'Experiencia', personas: 'Personas', boletos: 'Boletos', transporte: 'Transporte', noIncluido: 'No incluido',
    total: 'Total estimado', generar: 'Generar solicitud de reserva', generarNota: 'Generar la solicitud no cobra nada. Confirmamos disponibilidad y te mandamos el link de pago.',
    enviando: 'Enviando…', errorGenerico: 'Algo salió mal. Intenta de nuevo o escríbenos por WhatsApp.'
  };

  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US') + ' MXN'; }

  var overlay = null, state = { tierId: null, adultos: 2, ninos: 0, transporte: 'no' };

  function horariosPara(tierId) {
    return TIERS[tierId] && TIERS[tierId].jungala ? HORARIOS_JUNGALA : HORARIOS_JOYA;
  }

  function calcular() {
    var tier = TIERS[state.tierId];
    if (!tier) return null;
    var trans = TRANSPORTE[state.transporte] || TRANSPORTE.no;
    var pax = state.adultos + state.ninos;
    var boletos = tier.adulto * state.adultos + tier.nino * state.ninos;
    var transporte = trans.tarifa * pax;
    return { tier: tier, trans: trans, boletos: boletos, transporte: transporte, total: boletos + transporte };
  }

  function render() {
    if (!overlay) return;
    var tier = TIERS[state.tierId];
    if (!tier) return;
    var calc = calcular();
    var horarios = horariosPara(state.tierId);

    overlay.querySelector('[data-jy-tier-name]').textContent = tier.nombre[LANG];

    var selHorario = overlay.querySelector('[data-jy-horario]');
    selHorario.innerHTML = horarios.map(function (h) { return '<option value="' + h + '">' + h + '</option>'; }).join('');

    overlay.querySelector('[data-jy-adultos]').textContent = state.adultos;
    overlay.querySelector('[data-jy-ninos]').textContent = state.ninos;

    overlay.querySelectorAll('[data-jy-trans]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-jy-trans') === state.transporte);
    });

    var fecha = overlay.querySelector('[data-jy-fecha]').value;
    var resumen = [
      [T.experiencia, tier.nombre[LANG]],
      [T.fecha, fecha ? (fecha + ' · ' + selHorario.value) : '—'],
      [T.personas, state.adultos + ' ' + T.adultos.toLowerCase() + (state.ninos ? ' · ' + state.ninos + ' ' + T.ninos.toLowerCase() : '')],
      [T.boletos, money(calc.boletos)],
      [T.transporte, calc.transporte ? money(calc.transporte) + ' · ' + calc.trans.label[LANG] : T.noIncluido]
    ];
    var resumenEl = overlay.querySelector('[data-jy-resumen]');
    resumenEl.innerHTML = resumen.map(function (r) {
      return '<div class="jy-resumen-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');

    overlay.querySelector('[data-jy-total]').textContent = money(calc.total);
  }

  function abrir(tierId) {
    if (!overlay || !TIERS[tierId]) return;
    state = { tierId: tierId, adultos: 2, ninos: 0, transporte: 'no' };
    overlay.querySelector('[data-jy-err]').classList.remove('show');
    var form = overlay.querySelector('form');
    if (form) form.reset();
    render();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function cerrar() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  async function enviar(ev) {
    ev.preventDefault();
    var btn = overlay.querySelector('[data-jy-generar]');
    var errBox = overlay.querySelector('[data-jy-err]');
    errBox.classList.remove('show');

    var body = {
      idioma: LANG,
      tierId: state.tierId,
      fecha: overlay.querySelector('[data-jy-fecha]').value,
      horario: overlay.querySelector('[data-jy-horario]').value,
      adultos: state.adultos,
      ninos: state.ninos,
      transporteId: state.transporte,
      hotel: overlay.querySelector('[data-jy-hotel]').value,
      nombre: overlay.querySelector('[data-jy-nombre]').value,
      email: overlay.querySelector('[data-jy-email]').value,
      hp: overlay.querySelector('[data-jy-hp]').value
    };

    btn.disabled = true;
    var textoOriginal = btn.textContent;
    btn.textContent = T.enviando;

    try {
      var resp = await fetch('/api/joya/crear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      var data = await resp.json();
      if (!resp.ok || !data.token) throw new Error(data.error || 'error');
      var destino = LANG === 'en' ? 'cupon-joya-en.html' : 'cupon-joya.html';
      location.href = destino + '?t=' + encodeURIComponent(data.token);
    } catch (e) {
      errBox.textContent = T.errorGenerico;
      errBox.classList.add('show');
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    overlay = document.getElementById('jyModal');
    if (!overlay) return;

    var today = new Date();
    var minFecha = today.toISOString().slice(0, 10);
    var fechaInput = overlay.querySelector('[data-jy-fecha]');
    if (fechaInput) { fechaInput.min = minFecha; fechaInput.max = '2026-12-24'; }

    overlay.querySelector('[data-jy-close]').addEventListener('click', cerrar);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) cerrar(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });

    overlay.querySelector('[data-jy-menos-adultos]').addEventListener('click', function () { state.adultos = Math.max(1, state.adultos - 1); render(); });
    overlay.querySelector('[data-jy-mas-adultos]').addEventListener('click', function () { state.adultos = Math.min(20, state.adultos + 1); render(); });
    overlay.querySelector('[data-jy-menos-ninos]').addEventListener('click', function () { state.ninos = Math.max(0, state.ninos - 1); render(); });
    overlay.querySelector('[data-jy-mas-ninos]').addEventListener('click', function () { state.ninos = Math.min(20, state.ninos + 1); render(); });

    overlay.querySelectorAll('[data-jy-trans]').forEach(function (btn) {
      btn.addEventListener('click', function () { state.transporte = btn.getAttribute('data-jy-trans'); render(); });
    });

    overlay.querySelector('[data-jy-fecha]').addEventListener('change', render);
    overlay.querySelector('[data-jy-horario]').addEventListener('change', render);
    overlay.querySelector('form').addEventListener('submit', enviar);

    document.querySelectorAll('[data-open-joya]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        abrir(el.getAttribute('data-tier'));
      });
    });
  });
})();
