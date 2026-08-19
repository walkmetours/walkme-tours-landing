// Cupón de reserva WalkMe Bikes — lógica de la página.
// Lee ?t=<token>, pide GET /api/bici/<token> y pinta la tarjeta con el
// diseño entregado. Textos adaptados del renderVals() del mockup.
// REGLA DE SEGURIDAD: todo dato de la BD se pinta con textContent, nunca
// innerHTML (el nombre del cliente es entrada de usuario).
//
// La página define antes de cargar este archivo:
//   window.CUPON_LANG = 'es' | 'en'
(function () {
  const en = (window.CUPON_LANG || 'es') === 'en';
  const $ = id => document.getElementById(id);

  const T = en ? {
    voucher: 'Booking voucher',
    folio: 'FILE NO.', cliente: 'CLIENT', plan: 'PLAN', fecha: 'DATE AND TIME', bicis: 'BIKES',
    total: 'TOTAL',
    garantiaTitulo: 'CASH DEPOSIT AT PICK-UP',
    garantiaTituloTarjeta: 'CARD HOLD AT PICK-UP',
    garantiaNota: 'Returned in full at drop-off, along with your ID, if there is no damage or missing items.',
    garantiaNotaTarjeta: 'Not a charge: your bank sets the amount aside and releases it at drop-off if there is no damage or missing items.',
    requisitos: 'BRING WITH YOU', incluye: 'INCLUDES',
    reqs: dep => ['Valid government ID (we keep it during the rental)', 'Hotel, Airbnb or local address', dep + ' cash deposit'],
    reqsTarjeta: () => ['The card you will use for the hold', 'Valid government ID (we only look at it)', 'Hotel, Airbnb or local address'],
    incs: ['Helmet', 'Lock', 'Charger'],
    direccionTitulo: 'Pick up your bike here',
    direccion: 'WalkMe Tours · 5th Avenue, between 10th and 12th Streets, across from Sala de Despecho, Playa del Carmen, Quintana Roo. Find us on Google Maps as “WalkMe Tours”.',
    nota: 'Show this voucher on your phone or printed. Late returns are charged $200 MXN per hour.',
    estados: {
      pendiente_pago: 'NOT CONFIRMED · CHOOSE HOW TO PAY',
      pendiente_efectivo: 'PAY AT THE AGENCY',
      pagada: 'PAID ONLINE',
      en_curso: 'RENTAL IN PROGRESS',
      cerrada: 'RENTAL FINISHED',
      cancelada: 'CANCELLED',
      no_show: 'CANCELLED'
    },
    pagoDetalle: {
      pagada: fp => 'Paid online · ' + fp,
      pendiente: (total, fp) => 'Pending: pay ' + total + ' at the agency · ' + fp,
      sin: total => 'Pending: choose how to pay ' + total
    },
    efectivoPagado: dep => 'Bring ' + dep + ' MXN in cash for the deposit, plus your ID.',
    efectivoPend: monto => 'Bring in cash: ' + monto + ' (rental + deposit).',
    tarjetaPagado: 'Just bring the card for the hold. No cash needed.',
    tarjetaPend: monto => 'Bring in cash: ' + monto + ' (rental only). The deposit goes on your card.',
    depositoOk: 'Card hold authorized. Nothing was charged.',
    depositoCancelado: 'The card hold was not completed. We will sort it out at the counter.',
    metodo: { mercadopago: 'Mercado Pago', stripe: 'Card (Stripe)', efectivo: 'Cash at the agency' },
    payTitle: 'Choose how to pay',
    payMP: 'Pay with Mercado Pago',
    payStripe: 'Pay by card (Stripe)',
    payAgencia: 'Pay when you pick up the bike',
    payAgenciaNota: 'Your booking is held. Bring rental + deposit in cash.',
    prefierePagar: 'Prefer to pay online now?',
    abriendo: 'Opening secure checkout…',
    payErr: 'We could not open the checkout. Try again or pay at the agency.',
    payNoConfig: 'Online payment is not available yet — choose pay at pickup.',
    verificando: 'VERIFYING PAYMENT…',
    meses: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    fmtFecha: (d, m, hora) => m + ' ' + d + ' · ' + hora,
    imprimir: 'Print / save',
    whatsapp: 'WhatsApp',
    waMsg: folio => 'Hi WalkMe Bikes 🚲, I have booking ' + folio + '.',
    cargando: 'Loading your voucher…',
    errNoEncontrada: 'We could not find that booking. Check the link or message us on WhatsApp.',
    errNoConfig: 'Online booking is not active yet. Message us on WhatsApp.'
  } : {
    voucher: 'Comprobante de reserva',
    folio: 'FOLIO', cliente: 'CLIENTE', plan: 'PLAN', fecha: 'FECHA Y HORA', bicis: 'BICICLETAS',
    total: 'TOTAL',
    garantiaTitulo: 'GARANTÍA EN EFECTIVO AL RECOGER',
    garantiaTituloTarjeta: 'RETENCIÓN EN TARJETA AL RECOGER',
    garantiaNota: 'Se devuelve completa, junto con tu identificación, al entregar la bicicleta si no hay daños ni faltantes.',
    garantiaNotaTarjeta: 'No es un cobro: tu banco aparta el monto y lo libera al entregar la bicicleta si no hay daños ni faltantes.',
    requisitos: 'LLEVA CONTIGO', incluye: 'INCLUYE',
    reqs: dep => ['Identificación oficial vigente (se resguarda durante la renta)', 'Comprobante de hotel, Airbnb o domicilio', 'Garantía en efectivo de ' + dep],
    reqsTarjeta: () => ['La tarjeta con la que harás la retención', 'Identificación oficial vigente (solo la vemos)', 'Comprobante de hotel, Airbnb o domicilio'],
    incs: ['Casco', 'Candado', 'Cargador'],
    direccionTitulo: 'Recoge tu bicicleta aquí',
    direccion: 'WalkMe Tours · 5ta Avenida entre Calle 10 y Calle 12, frente a Sala de Despecho, Playa del Carmen, Quintana Roo. Búscanos en Google Maps como “WalkMe Tours”.',
    nota: 'Presenta este comprobante en tu celular o impreso. El retraso se cobra a $200 MXN por hora.',
    estados: {
      pendiente_pago: 'SIN CONFIRMAR · ELIGE CÓMO PAGAR',
      pendiente_efectivo: 'POR PAGAR EN LA AGENCIA',
      pagada: 'PAGADO EN LÍNEA',
      en_curso: 'RENTA EN CURSO',
      cerrada: 'RENTA FINALIZADA',
      cancelada: 'CANCELADA',
      no_show: 'CANCELADA'
    },
    pagoDetalle: {
      pagada: fp => 'Pagado en línea · ' + fp,
      pendiente: (total, fp) => 'Pendiente: paga ' + total + ' en la agencia · ' + fp,
      sin: total => 'Pendiente: elige cómo pagar ' + total
    },
    efectivoPagado: dep => 'Lleva ' + dep + ' en efectivo para la garantía, más tu identificación.',
    efectivoPend: monto => 'Lleva en efectivo: ' + monto + ' (renta + garantía).',
    tarjetaPagado: 'Solo lleva la tarjeta para la retención. No necesitas efectivo.',
    tarjetaPend: monto => 'Lleva en efectivo: ' + monto + ' (solo la renta). La garantía va en tu tarjeta.',
    depositoOk: 'Retención autorizada. No se te cobró nada.',
    depositoCancelado: 'La retención no se completó. Lo resolvemos en el mostrador.',
    metodo: { mercadopago: 'Mercado Pago', stripe: 'Tarjeta (Stripe)', efectivo: 'Efectivo en la agencia' },
    payTitle: 'Elige cómo pagar',
    payMP: 'Pagar con Mercado Pago',
    payStripe: 'Pagar con tarjeta (Stripe)',
    payAgencia: 'Pagar al recoger la bici',
    payAgenciaNota: 'Tu reserva queda apartada. Lleva renta + garantía en efectivo.',
    prefierePagar: '¿Prefieres pagar en línea ahora?',
    abriendo: 'Abriendo pago seguro…',
    payErr: 'No pudimos abrir el pago. Inténtalo de nuevo o paga en la agencia.',
    payNoConfig: 'El pago en línea aún no está disponible — elige pagar al recoger.',
    verificando: 'VERIFICANDO PAGO…',
    meses: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
    fmtFecha: (d, m, hora) => d + ' de ' + m + ' · ' + hora,
    imprimir: 'Imprimir / guardar',
    whatsapp: 'WhatsApp',
    waMsg: folio => 'Hola WalkMe Bikes 🚲, tengo la reserva ' + folio + '.',
    cargando: 'Cargando tu comprobante…',
    errNoEncontrada: 'No encontramos esa reserva. Revisa el link o escríbenos por WhatsApp.',
    errNoConfig: 'La reserva en línea aún no está activa. Escríbenos por WhatsApp.'
  };

  const money = n => '$' + Number(n).toLocaleString('en-US') + ' MXN';
  const token = new URLSearchParams(location.search).get('t') || '';
  const pagando = new URLSearchParams(location.search).get('pagando') === '1';
  // Vuelta del checkout de la retención: lo manda api/crm/accion.js
  // (success_url / cancel_url de 'autorizar_deposito').
  const depositoParam = new URLSearchParams(location.search).get('deposito');

  function fmtFecha(fechaISO, horaStr) {
    // fechaISO: 'YYYY-MM-DD' · horaStr: 'HH:MM[:SS]'
    const [y, m, d] = fechaISO.split('-').map(Number);
    const hora = String(horaStr || '').slice(0, 5);
    return T.fmtFecha(d, T.meses[m - 1], hora);
  }

  function mostrarError(msg) {
    $('cpCargando').style.display = 'none';
    const err = $('cpError');
    err.style.display = 'block';
    err.textContent = '';
    err.append(msg + ' ');
    const wa = document.createElement('a');
    wa.href = 'https://wa.me/525639748122';
    wa.target = '_blank'; wa.rel = 'noopener';
    wa.textContent = 'WhatsApp +52 56 3974 8122';
    err.append(wa);
  }

  function escala() {
    const el = $('cpScale');
    const outer = $('cpScaleOuter');
    if (!el || !outer) return;
    const w = document.documentElement.clientWidth;
    const s = Math.min(1, w / 1080);
    const tx = Math.max(0, (w - 1080 * s) / 2);
    // Las funciones se aplican de derecha a izquierda: primero scale
    // (desde top-left), luego translateX para centrar el resultado.
    el.style.transform = 'translateX(' + tx + 'px) scale(' + s + ')';
    outer.style.height = (el.offsetHeight * s) + 'px';
  }

  function pintarQR() {
    const cont = $('cpQr');
    cont.textContent = '';
    /* global QRCode */
    new QRCode(cont, {
      text: location.origin + location.pathname + '?t=' + encodeURIComponent(token),
      width: 200, height: 200,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  let intentosPoll = 0;

  function pintar(r) {
    $('cpCargando').style.display = 'none';
    $('cpScaleOuter').style.display = 'block';

    // Modalidad de garantía. El '|| efectivo' no es decorativo: si este
    // archivo llegara al navegador antes de la migración, el cupón se
    // comporta exactamente como antes en vez de romperse.
    const garTarjeta = (r.garantia_tipo || 'efectivo') === 'tarjeta';
    const dep = money(garTarjeta ? r.deposito_tarjeta_total : r.deposito_total);
    const total = money(r.total);
    const estado = r.estado;
    const pagado = estado === 'pagada' || estado === 'en_curso' || estado === 'cerrada';
    const fp = r.metodo_pago ? T.metodo[r.metodo_pago] || r.metodo_pago : '';

    // Badge
    const badge = $('cpBadge');
    badge.className = 'cp-badge ' + (
      pagando && estado === 'pendiente_pago' ? 'pendiente' :
      pagado ? 'pagada' :
      estado === 'pendiente_efectivo' ? 'pendiente' :
      estado === 'pendiente_pago' ? 'sin-confirmar' : 'neutra'
    );
    badge.textContent = (pagando && estado === 'pendiente_pago')
      ? T.verificando
      : (T.estados[estado] || estado.toUpperCase());

    // Folio + datos
    $('cpFolio').textContent = r.folioLabel;
    $('cpCliente').textContent = r.nombre_completo || '—';
    $('cpPlan').textContent = r.duracion_nombre;
    $('cpFecha').textContent = fmtFecha(r.fecha_reserva, r.hora_inicio);
    $('cpBicis').textContent = String(r.cantidad_bicis);

    // Dinero
    $('cpTotal').textContent = total;
    $('cpPagoDetalle').textContent = pagado
      ? T.pagoDetalle.pagada(fp)
      : estado === 'pendiente_efectivo'
        ? T.pagoDetalle.pendiente(total, fp || T.metodo.efectivo)
        : T.pagoDetalle.sin(total);
    $('cpGarLabel').textContent = garTarjeta ? T.garantiaTituloTarjeta : T.garantiaTitulo;
    $('cpGarMonto').textContent = dep;
    $('cpGarNota').textContent = garTarjeta ? T.garantiaNotaTarjeta : T.garantiaNota;
    // Con tarjeta el efectivo a llevar es SOLO la renta: sumarle la
    // garantía le diría al cliente que traiga $7,500 que nadie le va a pedir.
    $('cpEfectivo').textContent = garTarjeta
      ? (pagado ? T.tarjetaPagado : T.tarjetaPend(total))
      : (pagado ? T.efectivoPagado(dep)
                : T.efectivoPend(money(Number(r.total) + Number(r.deposito_total))));

    // Vuelta del checkout de la retención. Se confía en deposito_estado,
    // no en el parámetro de la URL: el hold lo confirma el webhook.
    const avisoDep = $('cpDepAviso');
    if (depositoParam) {
      const ok = depositoParam === '1' && r.deposito_estado === 'autorizado';
      avisoDep.textContent = ok ? T.depositoOk : T.depositoCancelado;
      avisoDep.className = 'cp-dep-aviso' + (ok ? '' : ' mal');
      avisoDep.style.display = 'block';
    }

    // Listas
    const reqs = $('cpReqs'); reqs.textContent = '';
    (garTarjeta ? T.reqsTarjeta() : T.reqs(dep)).forEach(txt => {
      const div = document.createElement('div');
      div.className = 'cp-item';
      const span = document.createElement('span');
      span.textContent = txt;
      div.append(span);
      reqs.append(div);
    });
    const incs = $('cpIncs'); incs.textContent = '';
    T.incs.forEach(txt => {
      const div = document.createElement('div');
      div.className = 'cp-item';
      const span = document.createElement('span');
      span.textContent = txt;
      div.append(span);
      incs.append(div);
    });

    // Pie
    $('cpDirTitle').textContent = T.direccionTitulo;
    $('cpDir').textContent = T.direccion;
    $('cpNota').textContent = T.nota;

    pintarQR();

    // Botones de pago
    const pay = $('cpPay');
    pay.classList.remove('visible');
    if (estado === 'pendiente_pago' && !pagando) {
      $('cpPayTitle').textContent = T.payTitle;
      $('cpBtnMP').textContent = T.payMP;
      $('cpBtnStripe').textContent = T.payStripe;
      $('cpBtnAgencia').textContent = T.payAgencia;
      $('cpBtnAgencia').style.display = '';
      $('cpPayNota').textContent = '';
      pay.classList.add('visible');
    } else if (estado === 'pendiente_efectivo') {
      $('cpPayTitle').textContent = T.prefierePagar;
      $('cpBtnMP').textContent = T.payMP;
      $('cpBtnStripe').textContent = T.payStripe;
      $('cpBtnAgencia').style.display = 'none';
      $('cpPayNota').textContent = T.payAgenciaNota;
      pay.classList.add('visible');
    }

    // Acciones
    const wa = $('cpWa');
    wa.textContent = T.whatsapp;
    wa.href = 'https://wa.me/525639748122?text=' + encodeURIComponent(T.waMsg(r.folioLabel));
    $('cpPrint').textContent = T.imprimir;

    escala();

    // Al volver de la pasarela: reintenta hasta que el webhook confirme.
    if (pagando && estado === 'pendiente_pago' && intentosPoll < 4) {
      intentosPoll++;
      setTimeout(cargar, 3000);
    }
  }

  async function cargar() {
    try {
      const r = await fetch('/api/bici/' + encodeURIComponent(token));
      if (r.status === 503) return mostrarError(T.errNoConfig);
      if (!r.ok) return mostrarError(T.errNoEncontrada);
      pintar(await r.json());
    } catch (e) {
      mostrarError(T.errNoEncontrada);
    }
  }

  async function pagar(endpoint) {
    const botones = document.querySelectorAll('.cp-pay-btn');
    botones.forEach(b => { b.disabled = true; });
    $('cpPayTitle').textContent = T.abriendo;
    $('cpPayErr').classList.remove('visible');
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await r.json();
      if (r.ok && data.url) { location.href = data.url; return; }
      if (r.ok && data.estado) { cargar(); return; } // efectivo: re-render
      const err = $('cpPayErr');
      err.textContent = (data.error === 'mp_no_configurado' || data.error === 'stripe_no_configurado')
        ? T.payNoConfig : T.payErr;
      err.classList.add('visible');
    } catch (e) {
      const err = $('cpPayErr');
      err.textContent = T.payErr;
      err.classList.add('visible');
    }
    botones.forEach(b => { b.disabled = false; });
    $('cpPayTitle').textContent = T.payTitle;
  }

  // Estáticos que no dependen de la reserva
  document.addEventListener('DOMContentLoaded', () => {
    $('cpVoucher').textContent = T.voucher;
    $('cpFolioLabel').textContent = T.folio;
    $('cpLblCliente').textContent = T.cliente;
    $('cpLblPlan').textContent = T.plan;
    $('cpLblFecha').textContent = T.fecha;
    $('cpLblBicis').textContent = T.bicis;
    $('cpLblTotal').textContent = T.total;
    $('cpGarLabel').textContent = T.garantiaTitulo;
    $('cpLblReqs').textContent = T.requisitos;
    $('cpLblIncs').textContent = T.incluye;
    $('cpCargando').textContent = T.cargando;

    $('cpBtnMP').addEventListener('click', () => pagar('/api/pago/bici-mercadopago'));
    $('cpBtnStripe').addEventListener('click', () => pagar('/api/pago/bici-stripe'));
    $('cpBtnAgencia').addEventListener('click', () => pagar('/api/pago/bici-efectivo'));
    $('cpPrint').addEventListener('click', () => window.print());

    window.addEventListener('resize', escala);

    if (!token) return mostrarError(T.errNoEncontrada);
    cargar();
  });
})();
