// Cupón de reserva JOYÀ — lee ?t=<token>, pide GET /api/joya/<token> y
// pinta el comprobante. Sin botones de pago: el equipo manda el link de
// pago después de confirmar disponibilidad (no hay pasarela integrada).
// REGLA DE SEGURIDAD: todo dato de la BD se pinta con textContent, nunca
// innerHTML.
// La página define antes de cargar este archivo: window.CUPON_LANG = 'es'|'en'
(function () {
  const en = (window.CUPON_LANG || 'es') === 'en';
  const $ = id => document.getElementById(id);

  const T = en ? {
    word: 'JOYÀ', sub: 'Cirque du Soleil · booking request',
    folio: 'FILE NO.', experiencia: 'EXPERIENCE', seccion: 'SECTION', fecha: 'DATE AND SHOW',
    personas: 'GUESTS', transporte: 'TRANSPORT', hotel: 'HOTEL / PICK-UP',
    total: 'ESTIMATED TOTAL',
    estados: { pendiente_pago: 'PENDING PAYMENT', pagada: 'PAID', cancelada: 'CANCELLED', no_show: 'CANCELLED' },
    siguePasos: "WHAT HAPPENS NEXT",
    pasos: ['We check availability for your date and experience within 24 hours.', 'We send a secure payment link. Once paid, your seats are confirmed.', 'You receive your e-tickets by email and, if you booked transport, the exact pick-up time.'],
    contactoTitle: 'CONTACT', nota: 'This voucher is not a ticket. It is the booking request with the rate quoted today.',
    imprimir: 'Print / save', whatsapp: 'WhatsApp',
    waMsg: folio => 'Hi WalkMe, I have JOYÀ booking request ' + folio + '.',
    noIncluido: 'Not included', porPersona: 'per person',
    adulto: n => n + (n === 1 ? ' adult' : ' adults'), nino: n => n + (n === 1 ? ' child' : ' children'),
    cargando: 'Loading your voucher…',
    errNoEncontrada: 'We could not find that booking. Check the link or message us on WhatsApp.',
    errNoConfig: 'Booking requests are not active yet. Message us on WhatsApp.'
  } : {
    word: 'JOYÀ', sub: 'Cirque du Soleil · solicitud de reserva',
    folio: 'FOLIO', experiencia: 'EXPERIENCIA', seccion: 'SECCIÓN', fecha: 'FECHA Y FUNCIÓN',
    personas: 'PERSONAS', transporte: 'TRANSPORTE', hotel: 'HOSPEDAJE / PICK UP',
    total: 'TOTAL ESTIMADO',
    estados: { pendiente_pago: 'PENDIENTE DE PAGO', pagada: 'PAGADA', cancelada: 'CANCELADA', no_show: 'CANCELADA' },
    siguePasos: 'QUÉ SIGUE',
    pasos: ['Revisamos disponibilidad para tu fecha y experiencia en menos de 24 horas.', 'Te mandamos el link de pago seguro. Al pagar, tu lugar queda confirmado.', 'Recibes tus boletos electrónicos por correo y, si contrataste transporte, la hora exacta de pick up.'],
    contactoTitle: 'CONTACTO', nota: 'Este cupón no es un boleto. Es la solicitud de reserva con la tarifa cotizada hoy.',
    imprimir: 'Imprimir / guardar', whatsapp: 'WhatsApp',
    waMsg: folio => 'Hola WalkMe, tengo la solicitud de reserva JOYÀ ' + folio + '.',
    noIncluido: 'No incluido', porPersona: 'por persona',
    adulto: n => n + (n === 1 ? ' adulto' : ' adultos'), nino: n => n + (n === 1 ? ' niño' : ' niños'),
    cargando: 'Cargando tu comprobante…',
    errNoEncontrada: 'No encontramos esa reserva. Revisa el link o escríbenos por WhatsApp.',
    errNoConfig: 'Las solicitudes de reserva aún no están activas. Escríbenos por WhatsApp.'
  };

  const money = n => '$' + Number(n || 0).toLocaleString('en-US') + ' MXN';
  const token = new URLSearchParams(location.search).get('t') || '';

  const MESES_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const MESES_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtFecha(fechaISO, horario) {
    const [y, m, d] = fechaISO.split('-').map(Number);
    const meses = en ? MESES_EN : MESES_ES;
    const base = en ? (meses[m - 1] + ' ' + d + ', ' + y) : (d + ' ' + meses[m - 1] + ' ' + y);
    return base + ' · ' + horario;
  }

  function mostrarError(msg) {
    $('cjCargando').style.display = 'none';
    const err = $('cjError');
    err.style.display = 'block';
    err.textContent = '';
    err.append(msg + ' ');
    const wa = document.createElement('a');
    wa.href = 'https://wa.me/525639748122';
    wa.target = '_blank'; wa.rel = 'noopener';
    wa.textContent = 'WhatsApp +52 56 3974 8122';
    err.append(wa);
  }

  function pintarQR() {
    const cont = $('cjQr');
    cont.textContent = '';
    /* global QRCode */
    new QRCode(cont, {
      text: 'https://www.walkmetours.com/' + (en ? 'cirque-du-soleil-en.html' : 'cirque-du-soleil.html'),
      width: 110, height: 110,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  function pintar(r) {
    $('cjCargando').style.display = 'none';
    $('cjOuter').style.display = 'block';

    $('cjBadge').textContent = T.estados[r.estado] || String(r.estado).toUpperCase();
    $('cjFolio').textContent = r.folioLabel;

    const paxTxt = T.adulto(r.adultos) + (r.ninos ? ' · ' + T.nino(r.ninos) : '');
    const celdas = [
      [T.experiencia, r.tier_nombre],
      [T.seccion, r.seccion],
      [T.fecha, fmtFecha(r.fecha_funcion, r.horario)],
      [T.personas, paxTxt],
      [T.transporte, r.transporte_id === 'no' ? T.noIncluido : money(r.transporte_tarifa) + ' ' + T.porPersona],
      [T.hotel, r.hotel || '—']
    ];
    const grid = $('cjGrid');
    grid.textContent = '';
    celdas.forEach(([lbl, val]) => {
      const cell = document.createElement('div');
      cell.className = 'cj-cell';
      const l = document.createElement('div'); l.className = 'cj-cell-lbl'; l.textContent = lbl;
      const v = document.createElement('div'); v.className = 'cj-cell-val'; v.textContent = val;
      cell.append(l, v);
      grid.append(cell);
    });

    $('cjTotal').textContent = money(r.total);
    $('cjDesglose').textContent =
      (en ? 'Tickets ' : 'Boletos ') + money(r.subtotal_boletos) +
      (r.subtotal_transporte ? (en ? ' + transport ' : ' + transporte ') + money(r.subtotal_transporte) : '');

    const pasos = $('cjPasos'); pasos.textContent = '';
    T.pasos.forEach(txt => {
      const div = document.createElement('div');
      div.className = 'cj-step';
      div.textContent = txt;
      pasos.append(div);
    });

    pintarQR();

    const wa = $('cjWa');
    wa.href = 'https://wa.me/525639748122?text=' + encodeURIComponent(T.waMsg(r.folioLabel));
  }

  async function cargar() {
    try {
      const r = await fetch('/api/joya/' + encodeURIComponent(token));
      if (r.status === 503) return mostrarError(T.errNoConfig);
      if (!r.ok) return mostrarError(T.errNoEncontrada);
      pintar(await r.json());
    } catch (e) {
      mostrarError(T.errNoEncontrada);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('cjSub').textContent = T.sub;
    $('cjLblFolio').textContent = T.folio;
    $('cjLblTotal').textContent = T.total;
    $('cjStepsTitle').textContent = T.siguePasos;
    $('cjContactoTitle').textContent = T.contactoTitle;
    $('cjNota').textContent = T.nota;
    $('cjCargando').textContent = T.cargando;
    $('cjPrint').textContent = T.imprimir;
    $('cjWa').textContent = T.whatsapp;

    $('cjPrint').addEventListener('click', () => window.print());

    if (!token) return mostrarError(T.errNoEncontrada);
    cargar();
  });
})();
