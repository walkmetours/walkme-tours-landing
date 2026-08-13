/* ========================================
   WalkMe · Cupón de confirmación (gracias.html / gracias-en.html)
   - Lee ?codigo=WM-..., consulta GET /api/reserva/:codigo y pinta el cupón.
   - Si el estado aún es 'firmada' (webhook de pago en camino), reintenta
     hasta 4 veces mostrando "verificando pago…".
   - QR con assets/qrcode.min.js apuntando a la URL del propio cupón.
   ======================================== */
(function () {
  const lang = (document.documentElement.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const WA = '525639748122';

  const STR = {
    es: {
      titulo: 'Reserva confirmada',
      tituloPend: 'Reserva apartada',
      tituloVer: 'Un momento…',
      estado: { pagada: 'Pagada ✓', confirmada: 'Confirmada ✓', pendiente_efectivo: 'Pendiente de pago en efectivo', firmada: 'Verificando pago…' },
      rTour: 'Experiencia', rDate: 'Fecha', rPax: 'Personas', rZone: 'Salida', rTotal: 'Total', rPago: 'Pago',
      metodo: { mercadopago: 'Mercado Pago', stripe: 'Tarjeta (Stripe)', efectivo: 'Efectivo en persona' },
      zona: { pdc: 'Playa del Carmen', rm: 'Riviera Maya', cun: 'Cancún' },
      nota: 'Guarda una captura de esta pantalla. Muestra el código o el QR el día de tu tour. También te enviamos todo por correo.',
      notaVer: 'Si ya pagaste, tu cupón se actualizará en unos minutos. También recibirás la confirmación por correo.',
      notaPend: 'Tu lugar queda apartado. El pago se realiza en efectivo antes del tour.',
      waBtn: 'Hablar con WalkMe por WhatsApp',
      waMsg: c => `Hola WalkMe Tours, tengo la reserva ${c}.`,
      noEncontrada: 'No encontramos esa reserva. Revisa el enlace de tu correo o escríbenos por WhatsApp.',
      pax: (a, m) => `${a} ${a === 1 ? 'adulto' : 'adultos'}, ${m} ${m === 1 ? 'menor' : 'menores'}`
    },
    en: {
      titulo: 'Booking confirmed',
      tituloPend: 'Spot held',
      tituloVer: 'One moment…',
      estado: { pagada: 'Paid ✓', confirmada: 'Confirmed ✓', pendiente_efectivo: 'Cash payment pending', firmada: 'Verifying payment…' },
      rTour: 'Experience', rDate: 'Date', rPax: 'Guests', rZone: 'Departure', rTotal: 'Total', rPago: 'Payment',
      metodo: { mercadopago: 'Mercado Pago', stripe: 'Card (Stripe)', efectivo: 'Cash in person' },
      zona: { pdc: 'Playa del Carmen', rm: 'Riviera Maya', cun: 'Cancún' },
      nota: 'Save a screenshot of this screen. Show the code or QR on the day of your tour. We also emailed everything to you.',
      notaVer: 'If you already paid, your voucher will update in a few minutes. You will also get the confirmation by email.',
      notaPend: 'Your spot is held. Payment is made in cash before the tour.',
      waBtn: 'Chat with WalkMe on WhatsApp',
      waMsg: c => `Hi WalkMe Tours, I have booking ${c}.`,
      noEncontrada: "We couldn't find that booking. Check the link in your email or message us on WhatsApp.",
      pax: (a, m) => `${a} ${a === 1 ? 'adult' : 'adults'}, ${m} ${m === 1 ? 'child' : 'children'}`
    }
  };
  const t = STR[lang];
  const fmt = n => '$' + Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX');
  const cont = document.getElementById('cupon');
  if (!cont) return;

  const codigo = new URLSearchParams(location.search).get('codigo') || '';
  // La reserva ya terminó: limpiar el borrador del wizard
  try { sessionStorage.removeItem('wm-reserva'); } catch (e) {}

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    const mesesEs = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const mesesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const meses = lang === 'en' ? mesesEn : mesesEs;
    return `${parseInt(d)} ${meses[parseInt(m) - 1]} ${y}`;
  }

  function fila(l, v) {
    return `<div class="wz-res-row"><span>${l}</span><strong>${v}</strong></div>`;
  }

  function pintar(r, verificando) {
    const h1 = document.getElementById('cupon-titulo');
    let claseEstado = 'verificando';
    if (r.estado === 'pagada' || r.estado === 'confirmada') { claseEstado = 'pagada'; h1.textContent = t.titulo; }
    else if (r.estado === 'pendiente_efectivo') { claseEstado = 'pendiente'; h1.textContent = t.tituloPend; }
    else h1.textContent = t.tituloVer;

    const nota = r.estado === 'pendiente_efectivo' ? t.notaPend : (claseEstado === 'verificando' ? t.notaVer : t.nota);
    cont.innerHTML = `
      <p class="wz-cupon-codigo">${r.codigo}</p>
      <p class="wz-cupon-estado ${claseEstado}">${t.estado[r.estado] || r.estado}</p>
      <div class="wz-qr" id="qr"></div>
      <div class="wz-resumen">
        ${fila(t.rTour, r.tour_nombre)}
        ${fila(t.rDate, formatDate(r.fecha_tour))}
        ${fila(t.rPax, t.pax(r.adultos, r.menores))}
        ${fila(t.rZone, t.zona[r.zona] || r.zona)}
        ${fila(t.rTotal, fmt(r.total) + ' ' + r.moneda)}
        ${r.metodo_pago ? fila(t.rPago, t.metodo[r.metodo_pago] || r.metodo_pago) : ''}
      </div>
      <p class="wz-cupon-nota">${nota}</p>
      <a class="qm-submit wz-wa-full" style="text-decoration:none;" href="https://wa.me/${WA}?text=${encodeURIComponent(t.waMsg(r.codigo))}" target="_blank" rel="noopener">
        <svg width="18" height="18"><use href="#wa-icon"/></svg><span>${t.waBtn}</span>
      </a>
    `;
    if (window.QRCode) {
      new QRCode(document.getElementById('qr'), {
        text: location.origin + location.pathname + '?codigo=' + encodeURIComponent(r.codigo),
        width: 150, height: 150,
        colorDark: '#0d2e1a', colorLight: '#ffffff'
      });
    }
  }

  async function cargar(intento) {
    try {
      const resp = await fetch('/api/reserva/' + encodeURIComponent(codigo));
      if (!resp.ok) throw new Error('' + resp.status);
      const r = await resp.json();
      const esperandoPago = r.estado === 'firmada' && intento < 4;
      pintar(r, esperandoPago);
      if (esperandoPago) setTimeout(() => cargar(intento + 1), 3000);
    } catch (e) {
      cont.innerHTML = `<div class="wz-err">${t.noEncontrada}</div>
        <a class="qm-submit wz-wa-full" style="text-decoration:none;margin-top:14px;" href="https://wa.me/${WA}" target="_blank" rel="noopener">
          <svg width="18" height="18"><use href="#wa-icon"/></svg><span>${t.waBtn}</span>
        </a>`;
    }
  }

  if (codigo) cargar(0);
  else cont.innerHTML = `<div class="wz-err">${t.noEncontrada}</div>`;
})();
