/* CRM WalkMe v2 — reemplazo de assets/crm.js, mismo stack vanilla del sitio.
   Traducción de "CRM Walkme v2.dc.html" (Claude Design, formato propietario
   <x-dc>/<sc-for>/<sc-if>, bindings {{ }}, class Component extends DCLogic)
   al HTML/CSS/JS plano de este proyecto — mismo proceso que se siguió con
   assets/bikes.js para "Renta Bikes Escritorio.dc.html" (lee el comentario
   de cabecera de ese archivo si quieres el precedente completo).

   TODA la lógica real de rentas (estados, estadoVista(), filtros, mostrador,
   cierre, asignación de unidades, foto de ID, cupón, WhatsApp) es la MISMA
   de assets/crm.js — sólo cambia el look (shell de 10 items de nav en vez de
   2, Dashboard nuevo) y se agregan un buscador y "dueño de la unidad" que sí
   tienen soporte real en el backend (api/crm/accion.js).

   El diseño v2 trae 10 secciones con datos 100% mock (BK-214, B-01..B-10,
   plan "Hora" $300, semana $1700, dashboard de tours con ingresos). Ese mock
   NO se copia — pintar mock en una pantalla de producción es el bug que se
   está arreglando ("el CRM cotiza mal"). Lo que SÍ se conserva del diseño es
   el look: sidebar verde #0d2e1a, chips ámbar/rosa, tarjetas KPI oscuras.

   Discrepancias diseño → realidad, corregidas aquí (no se copian del mock):
     · Folios reales WB-5xxx (B.folioLabel), no BK-xxx del mock.
     · Precios y "semana" $1,500 vienen SOLO de window.WM_BICIS (catálogo real).
       El plan "Hora" $300 del mock no existe y se descarta.
     · Flota real son 6 bicis B-01..B-06 (las trae la API, no están hardcodeadas
       aquí); el mock traía B-01..B-10.
     · Los chips de estado (Vence hoy / Retrasada / …) son VALORES DERIVADOS
       por estadoVista() en el navegador — igual que en crm.js — nunca un
       <select> editable como insinúa el diseño.
     · Sólo Dashboard y Bikes tienen backend. Los otros 8 items de nav están
       deshabilitados con etiqueta "en construcción": nada de datos de ejemplo
       en una pantalla real.

   REGLA DURA (idéntica a crm.js): todo dato que venga de la API se pinta con
   textContent / createElement. Jamás innerHTML con datos del servidor (los
   nombres de clientes son texto de usuario: eso sería XSS).

   Depende de (cargados antes en crm-v2.html):
     window.WM_BICIS  → catálogo, precios, folioLabel, money
     window.CRM_AUTH  → login / apiFetch / logout
*/
(function () {
  'use strict';

  var B = window.WM_BICIS;
  var AUTH = window.CRM_AUTH;

  // ---------------------------------------------------------------- estado
  var estado = {
    datos: null,          // { flota, rentas, solicitudes, kpis }
    vista: 'dashboard',   // 'dashboard' | 'bikes' — únicas dos con backend
    filtro: 'todas',
    busqueda: '',
    tab: 'contratos',
    tokenAbierto: null,
    editando: false,
    editandoDinero: false,
    cerrando: false,
    capturandoDeposito: false,
    unidadesSel: [],
    cargando: false,
    modalAbierto: false
  };

  // ------------------------------------------------------------- utilidades
  function $(id) { return document.getElementById(id); }

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = String(texto);
    return n;
  }

  function vaciar(nodo) { while (nodo.firstChild) nodo.removeChild(nodo.firstChild); }

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MS_CANCUN = 5 * 3600 * 1000; // America/Cancun = UTC-5 fijo, sin horario de verano

  // 'YYYY-MM-DD' en hora de Cancún (mismo cálculo que el backend).
  function diaCancun(d) {
    return new Date(d.getTime() - MS_CANCUN).toISOString().slice(0, 10);
  }
  function hoyCancun() { return diaCancun(new Date()); }

  // "22 ago · 10:00"
  function fechaCorta(iso) {
    if (!iso) return '—';
    var d = new Date(new Date(iso).getTime() - MS_CANCUN);
    if (isNaN(d.getTime())) return '—';
    return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + ' · ' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fechaLarga(d) {
    var c = new Date(d.getTime() - MS_CANCUN);
    return DIAS[c.getUTCDay()] + ' ' + c.getUTCDate() + ' de ' +
      MESES_LARGO[c.getUTCMonth()] + ', ' + c.getUTCFullYear();
  }

  function money(n) {
    if (n === null || n === undefined || n === '') return '—';
    return B.money(n);
  }

  function capitaliza(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // ------------------------------------------------------- estados y chips
  var ETIQUETA_ESTADO = {
    pendiente_pago: 'Sin pagar',
    pendiente_efectivo: 'Por cobrar',
    pagada: 'Pagada',
    en_curso: 'En curso',
    cerrada: 'Cerrada',
    cancelada: 'Cancelada',
    no_show: 'No llegó',
    vence_hoy: 'Vence hoy',
    retrasada: 'Retrasada',
    disponible: 'Disponible',
    rentada: 'Rentada',
    cargando: 'Cargando',
    mantenimiento: 'Mantenimiento',
    // ---- Depósito de garantía (hold de Stripe) ----
    deposito_pendiente: 'Depósito: esperando al cliente',
    deposito_autorizado: 'Depósito autorizado',
    deposito_capturado: 'Depósito cobrado',
    deposito_liberado: 'Depósito liberado',
    deposito_expirado: 'Depósito expirado',
    deposito_requiere_atencion: 'Depósito: requiere atención'
  };

  // Estado "de pantalla": en_curso puede verse como Retrasada o Vence hoy.
  // Valor DERIVADO, nunca editable directamente (el diseño lo insinúa como
  // un select; la realidad de negocio no lo permite — ver cabecera).
  function estadoVista(r) {
    if (r.estado !== 'en_curso') return r.estado;
    var ahora = new Date();
    if (r.fin && new Date(r.fin) < ahora) return 'retrasada';
    if (r.fin && diaCancun(new Date(r.fin)) === hoyCancun()) return 'vence_hoy';
    return 'en_curso';
  }

  function chipEstado(clave, grande) {
    var s = el('span', 'estado e-' + clave, ETIQUETA_ESTADO[clave] || clave);
    if (grande) s.classList.add('estado-grande');
    return s;
  }

  // -------------------------------------------------------------- mensajes
  function toast(msg, tipo) {
    var cont = $('toasts');
    while (cont.children.length >= 3) cont.removeChild(cont.firstChild);
    var t = el('div', 'toast' + (tipo ? ' t-' + tipo : ''), msg);
    cont.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5200);
  }

  var ERRORES = {
    transicion_invalida: 'Ese cambio de estado no se puede hacer desde aquí.',
    sin_unidades_asignadas: 'Primero asigna las bicis a esta renta.',
    demasiadas_unidades: 'Seleccionaste más bicis de las que pidió el cliente.',
    unidad_inexistente: 'Esa unidad no existe en la flota.',
    unidad_ocupada: 'Esa bici ya está en otra renta.',
    estado_invalido: 'La renta ya no está en un estado que permita esto.',
    reserva_no_encontrada: 'No encontramos esa renta. Actualiza la pantalla.',
    sin_cambios: 'No cambiaste ningún dato.',
    nombre_requerido: 'El nombre del cliente no puede quedar vacío.',
    ventana_invalida: 'Esa fecha y hora no son válidas para el plan.',
    duracion_invalida: 'Elige un plan de renta válido.',
    id_requerido: 'Escribe el número de la unidad (ej. B-07).',
    sin_disponibilidad: 'No hay bicis suficientes en ese horario.',
    error_interno: 'Falló el servidor. Intenta otra vez en un momento.',
    method_not_allowed: 'Petición inválida.',
    accion_invalida: 'Acción no reconocida.',
    stripe_no_configurado: 'Stripe no está configurado en el servidor.',
    deposito_ya_activo: 'Ya hay un depósito en proceso o autorizado para esta renta.',
    deposito_estado_invalido: 'El depósito no está en un estado que permita esto.',
    stripe_captura_fallo: 'Stripe no pudo procesar el cobro del depósito. Intenta de nuevo.',
    stripe_error: 'No se pudo conectar con Stripe. Intenta de nuevo en un momento.'
  };

  function textoError(e) {
    if (!e) return 'Algo salió mal.';
    if (e.codigo === 'unidad_ocupada' && e.data && e.data.folios && e.data.folios.length) {
      return 'Esa bici ya está en la renta ' +
        e.data.folios.map(function (f) { return B.folioLabel(f); }).join(', ') + '.';
    }
    return ERRORES[e.codigo] || ERRORES[e.message] || 'Algo salió mal. Intenta otra vez.';
  }

  function banner(msg) {
    var b = $('bannerAviso');
    if (!msg) { b.hidden = true; b.textContent = ''; return; }
    b.textContent = msg;
    b.hidden = false;
  }

  // ----------------------------------------------------------------- modal
  function abrirModal(construir) {
    var caja = $('modalIn');
    vaciar(caja);
    construir(caja);
    $('scrimModal').hidden = false;
    $('modal').hidden = false;
    estado.modalAbierto = true;
  }

  function cerrarModal() {
    $('scrimModal').hidden = true;
    $('modal').hidden = true;
    vaciar($('modalIn'));
    estado.modalAbierto = false;
  }

  // Confirmación propia (nada de window.confirm: se ve feo y en iOS bloquea).
  function confirmar(opciones) {
    return new Promise(function (resolver) {
      abrirModal(function (caja) {
        caja.appendChild(el('h2', 'modal-tit', opciones.titulo));
        if (opciones.texto) caja.appendChild(el('p', 'modal-sub', opciones.texto));
        var acc = el('div', 'modal-acc');
        var no = el('button', 'btn btn-linea', opciones.cancelar || 'No, volver');
        no.type = 'button';
        no.addEventListener('click', function () { cerrarModal(); resolver(false); });
        var si = el('button', 'btn ' + (opciones.clase || 'btn-peligro'), opciones.aceptar || 'Sí, continuar');
        si.type = 'button';
        si.addEventListener('click', function () { cerrarModal(); resolver(true); });
        acc.appendChild(no);
        acc.appendChild(si);
        caja.appendChild(acc);
      });
    });
  }

  function pedirTexto(opciones) {
    return new Promise(function (resolver) {
      abrirModal(function (caja) {
        caja.appendChild(el('h2', 'modal-tit', opciones.titulo));
        if (opciones.texto) caja.appendChild(el('p', 'modal-sub', opciones.texto));
        var campo = el('label', 'campo');
        campo.appendChild(el('span', 'campo-lab', opciones.etiqueta || 'Valor'));
        var input = el('input', 'campo-in');
        input.type = 'text';
        input.value = opciones.valor || '';
        if (opciones.placeholder) input.placeholder = opciones.placeholder;
        campo.appendChild(input);
        caja.appendChild(campo);

        var acc = el('div', 'modal-acc');
        var no = el('button', 'btn btn-linea', 'Cancelar');
        no.type = 'button';
        no.addEventListener('click', function () { cerrarModal(); resolver(null); });
        var si = el('button', 'btn btn-amarillo', opciones.aceptar || 'Guardar');
        si.type = 'button';
        si.addEventListener('click', function () {
          var v = input.value.trim();
          cerrarModal();
          resolver(v || null);
        });
        acc.appendChild(no);
        acc.appendChild(si);
        caja.appendChild(acc);
        setTimeout(function () { input.focus(); }, 40);
      });
    });
  }

  // ------------------------------------------------------------------- API
  async function accion(cuerpo) {
    var r = await AUTH.apiFetch('/api/crm/accion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });
    var data = {};
    try { data = await r.json(); } catch (e) { /* respuesta sin json */ }
    if (!r.ok) {
      var err = new Error(data.error || 'error_interno');
      err.codigo = data.error || 'error_interno';
      err.http = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Ejecuta una acción, muestra toast de éxito/error y recarga el tablero.
  async function ejecutar(cuerpo, mensajeOk) {
    try {
      var res = await accion(cuerpo);
      if (mensajeOk) toast(typeof mensajeOk === 'function' ? mensajeOk(res) : mensajeOk, 'ok');
      await cargarTablero(true);
      return res;
    } catch (e) {
      if (e.codigo === 'sin_sesion') { mostrarLogin(); return null; }
      toast(textoError(e), 'error');
      return null;
    }
  }

  // ---------------------------------------------------------------- vistas
  function mostrarLogin(mensaje) {
    $('vistaApp').hidden = true;
    $('vistaFatal').hidden = true;
    $('vistaLogin').hidden = false;
    cerrarDrawer();
    cerrarModal();
    var err = $('loginError');
    if (mensaje) { err.textContent = mensaje; err.hidden = false; } else { err.hidden = true; }
  }

  function mostrarFatal(titulo, texto) {
    $('vistaApp').hidden = true;
    $('vistaLogin').hidden = true;
    $('fatalTitulo').textContent = titulo;
    $('fatalTexto').textContent = texto;
    $('vistaFatal').hidden = false;
  }

  function mostrarApp() {
    $('vistaLogin').hidden = true;
    $('vistaFatal').hidden = true;
    $('vistaApp').hidden = false;
    $('sesionEmail').textContent = AUTH.email() || '';
    $('topFecha').textContent = capitaliza(fechaLarga(new Date())) + ' · Playa del Carmen';
  }

  // ------------------------------------------------------- nav de 10 items
  // Sólo 'dashboard' y 'bikes' tienen contenedor + backend; los otros 8
  // botones ya nacen disabled en el HTML ("en construcción"), así que no
  // hace falta manejarlos aquí — ni pintarles datos de ejemplo.
  var TITULOS_VISTA = { dashboard: 'Dashboard', bikes: 'Renta de bicis' };

  function irAVista(vista) {
    estado.vista = vista;
    $('vistaDashboardBody').hidden = vista !== 'dashboard';
    $('vistaBikesBody').hidden = vista !== 'bikes';
    $('topTitulo').textContent = TITULOS_VISTA[vista] || vista;
    $('buscador').hidden = vista !== 'bikes';
    $('btnMostrador').hidden = vista !== 'bikes';
    Array.prototype.forEach.call($('navPrincipal').querySelectorAll('.nav-item[data-vista]'), function (b) {
      b.classList.toggle('is-activa', b.getAttribute('data-vista') === vista);
    });
    if (estado.datos) {
      if (vista === 'dashboard') pintarDashboard();
      else pintarTodo();
    }
  }

  // ------------------------------------------------------- carga del tablero
  async function cargarTablero(silencioso) {
    if (estado.cargando) return;
    estado.cargando = true;
    if (!silencioso) pintarEsqueleto();
    try {
      var r = await AUTH.apiFetch('/api/crm/tablero');
      if (r.status === 401 || r.status === 403) {
        estado.cargando = false;
        mostrarLogin('Tu sesión terminó. Entra otra vez.');
        return;
      }
      if (r.status === 503) {
        estado.cargando = false;
        mostrarFatal('El CRM aún no está configurado',
          'Falta terminar la configuración en el servidor. Avísale al equipo técnico.');
        return;
      }
      if (!r.ok) throw new Error('http_' + r.status);
      var datos = await r.json();
      estado.datos = datos;
      estado.cargando = false;
      banner('');
      mostrarApp();
      pintarDashboard();
      pintarTodo();
    } catch (e) {
      estado.cargando = false;
      if (e && (e.codigo === 'sin_sesion' || e.message === 'sin_sesion')) { mostrarLogin(); return; }
      if (estado.datos) {
        banner('No pudimos actualizar los datos. Se muestra la última información cargada.');
      } else {
        mostrarApp();
        banner('No pudimos cargar el tablero. Toca "Actualizar" para intentar de nuevo.');
        pintarVacioTotal();
      }
    }
  }

  function pintarEsqueleto() {
    mostrarApp();
    var contenedores = [$('kpisDash'), $('kpis')];
    contenedores.forEach(function (k) {
      vaciar(k);
      for (var i = 0; i < 4; i++) k.appendChild(el('div', 'esqueleto esq-kpi'));
    });
    var t = $('tabla');
    vaciar(t);
    for (var j = 0; j < 5; j++) t.appendChild(el('div', 'esqueleto esq-fila'));
    $('hoyResumen').textContent = 'Cargando…';
  }

  function pintarVacioTotal() {
    vaciar($('kpisDash'));
    vaciar($('kpis'));
    vaciar($('tabla'));
    vaciar($('flota'));
  }

  // ------------------------------------------------------------- pintar todo
  function pintarTodo() {
    pintarKpis();
    pintarFiltros();
    pintarTabla();
    pintarSolicitudes();
    pintarFlota();
    pintarFlotaDuenos();
    pintarResumenHoy();
    pintarBadges();
    if (estado.tokenAbierto) pintarDrawer();
  }

  function pintarResumenHoy() {
    var k = (estado.datos && estado.datos.kpis) || {};
    var partes = [
      (k.bicisFuera || 0) + ' bicis en la calle',
      (k.devolucionesHoy || 0) + ' devoluciones hoy',
      (k.solicitudes || 0) + ' solicitudes por asignar'
    ];
    $('hoyResumen').textContent = partes.join(' · ');
  }

  // --------------------------------------------------------------- Dashboard
  // Únicos datos reales disponibles hoy: los conteos de api/crm/tablero.js
  // (bicisFuera, devolucionesHoy, retrasadas, porCobrar, solicitudes). No hay
  // ingresos todavía — no se inventan.
  function pintarDashboard() {
    var k = (estado.datos && estado.datos.kpis) || {};
    var tarjetas = [
      { lab: 'Bicis en la calle', val: k.bicisFuera || 0,
        sub: 'Salidas activas ahora mismo', clase: 'kpi-oscuro' },
      { lab: 'Solicitudes por asignar', val: k.solicitudes || 0,
        sub: 'Del link móvil, esperando bici', clase: 'kpi-amarillo' },
      { lab: 'Retrasadas', val: k.retrasadas || 0,
        sub: (k.retrasadas ? 'Cóbrales el retraso' : 'Todo al día'),
        clase: (k.retrasadas ? 'kpi-rosa' : '') },
      { lab: 'Por cobrar', val: k.porCobrar || 0,
        sub: 'Efectivo en mostrador', clase: '' }
    ];
    var cont = $('kpisDash');
    vaciar(cont);
    tarjetas.forEach(function (t) {
      var c = el('div', 'kpi ' + t.clase);
      c.appendChild(el('div', 'kpi-lab', t.lab));
      c.appendChild(el('div', 'kpi-val', t.val));
      c.appendChild(el('div', 'kpi-sub', t.sub));
      cont.appendChild(c);
    });
  }

  function pintarKpis() {
    var k = (estado.datos && estado.datos.kpis) || {};
    var flota = (estado.datos && estado.datos.flota) || [];
    var disponibles = flota.filter(function (u) { return u.estado === 'disponible'; }).length;

    var tarjetas = [
      { lab: 'Bicis en la calle', val: k.bicisFuera || 0,
        sub: disponibles + (disponibles === 1 ? ' disponible de ' : ' disponibles de ') + flota.length,
        clase: 'kpi-oscuro' },
      { lab: 'Devoluciones hoy', val: k.devolucionesHoy || 0,
        sub: 'Avísales por WhatsApp', clase: '' },
      { lab: 'Retrasadas', val: k.retrasadas || 0,
        sub: (k.retrasadas ? 'Cóbrales el retraso' : 'Todo al día'),
        clase: (k.retrasadas ? 'kpi-rosa' : '') },
      { lab: 'Por cobrar', val: k.porCobrar || 0,
        sub: 'Efectivo en mostrador', clase: 'kpi-amarillo' }
    ];

    var cont = $('kpis');
    vaciar(cont);
    tarjetas.forEach(function (t) {
      var c = el('div', 'kpi ' + t.clase);
      c.appendChild(el('div', 'kpi-lab', t.lab));
      c.appendChild(el('div', 'kpi-val', t.val));
      c.appendChild(el('div', 'kpi-sub', t.sub));
      cont.appendChild(c);
    });
  }

  // --------------------------------------------------------------- filtros
  var FILTROS = [
    { id: 'todas', lab: 'Todas' },
    { id: 'en_curso', lab: 'En curso' },
    { id: 'vence_hoy', lab: 'Vence hoy' },
    { id: 'retrasada', lab: 'Retrasada' },
    { id: 'por_cobrar', lab: 'Por cobrar' },
    { id: 'cerradas', lab: 'Cerradas' }
  ];

  function pintarFiltros() {
    var cont = $('filtros');
    vaciar(cont);
    FILTROS.forEach(function (f) {
      var b = el('button', 'chip' + (estado.filtro === f.id ? ' is-activo' : ''), f.lab);
      b.type = 'button';
      b.addEventListener('click', function () {
        estado.filtro = f.id;
        pintarFiltros();
        pintarTabla();
        pintarBadges();
      });
      cont.appendChild(b);
    });
  }

  function rentasFiltradas() {
    var rentas = (estado.datos && estado.datos.rentas) || [];
    var q = estado.busqueda.trim().toLowerCase();
    if (q) {
      rentas = rentas.filter(function (r) {
        var pack = [
          r.nombre_completo || '', r.hotel || '', r.telefono || '',
          String(B.folioLabel(r.folio) || ''), (r.unidades || []).join(' ')
        ].join(' ').toLowerCase();
        return pack.indexOf(q) !== -1;
      });
    }
    if (estado.filtro === 'todas') return rentas;
    return rentas.filter(function (r) {
      var v = estadoVista(r);
      if (estado.filtro === 'en_curso') return r.estado === 'en_curso';
      if (estado.filtro === 'vence_hoy') return v === 'vence_hoy';
      if (estado.filtro === 'retrasada') return v === 'retrasada';
      if (estado.filtro === 'por_cobrar') return r.estado === 'pendiente_efectivo';
      if (estado.filtro === 'cerradas') return r.estado === 'cerrada';
      return true;
    });
  }

  // ----------------------------------------------------------------- tabla
  // En la tabla el plan va corto ("Día"); el nombre completo vive en el detalle.
  var PLAN_CORTO = { '2h': '2 horas', dia: 'Día', '24h': '24 horas', semana: 'Semana', mes: 'Mes' };
  function planCorto(r) {
    return PLAN_CORTO[r.duracion_id] || r.duracion_nombre || r.duracion_id || '—';
  }

  function pintarTabla() {
    var cont = $('tabla');
    vaciar(cont);
    var filas = rentasFiltradas();

    $('contratosSub').textContent = filas.length + (filas.length === 1 ? ' renta' : ' rentas');

    var head = el('div', 'fila fila-head');
    head.appendChild(el('span', 'c-folio', 'Folio'));
    head.appendChild(el('span', 'c-cliente', 'Cliente'));
    head.appendChild(el('span', 'c-plan', 'Plan'));
    head.appendChild(el('span', 'c-inicio', 'Inicio'));
    head.appendChild(el('span', 'c-unidades', 'Unidades'));
    head.appendChild(el('span', 'c-total', 'Total'));
    head.appendChild(el('span', 'c-estado', 'Estado'));
    head.appendChild(el('span', 'c-canal', ''));
    cont.appendChild(head);

    if (!filas.length) {
      cont.appendChild(el('div', 'tabla-vacia', 'No hay rentas en este filtro.'));
      return;
    }

    filas.forEach(function (r) {
      cont.appendChild(filaRenta(r));
    });
  }

  function filaRenta(r) {
    var f = el('div', 'fila');
    f.setAttribute('role', 'button');
    f.setAttribute('tabindex', '0');

    f.appendChild(el('span', 'c-folio', B.folioLabel(r.folio)));

    var cli = el('span', 'c-cliente');
    cli.appendChild(el('strong', null, r.nombre_completo || 'Sin nombre'));
    cli.appendChild(el('span', 'c-sub', r.hotel || r.telefono || '—'));
    f.appendChild(cli);

    var plan = el('span', 'c-plan');
    plan.appendChild(document.createTextNode(planCorto(r)));
    plan.appendChild(el('span', 'c-sub', r.cantidad_bicis + (r.cantidad_bicis === 1 ? ' bici' : ' bicis')));
    f.appendChild(plan);

    var ini = el('span', 'c-inicio');
    ini.appendChild(document.createTextNode(fechaCorta(r.inicio)));
    ini.appendChild(el('span', 'c-sub', '→ ' + fechaCorta(r.fin)));
    f.appendChild(ini);

    var uni = el('span', 'c-unidades');
    if (r.unidades && r.unidades.length) {
      r.unidades.forEach(function (u) { uni.appendChild(el('span', 'uchip', u)); });
    } else {
      uni.appendChild(el('span', 'c-sub', '—'));
    }
    f.appendChild(uni);

    f.appendChild(el('span', 'c-total', money(r.total)));

    var est = el('span', 'c-estado');
    est.appendChild(chipEstado(estadoVista(r)));
    f.appendChild(est);

    var canal = el('span', 'c-canal', r.canal === 'mostrador' ? '🏪' : '🌐');
    canal.title = r.canal === 'mostrador' ? 'Renta de mostrador' : 'Reserva de la web';
    f.appendChild(canal);

    function abrir() { abrirDrawer(r.token); }
    f.addEventListener('click', abrir);
    f.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); }
    });
    return f;
  }

  // ----------------------------------------------------------- solicitudes
  function pintarSolicitudes() {
    var sols = (estado.datos && estado.datos.solicitudes) || [];
    var panel = $('panelSolicitudes');
    var tab = $('tabSolicitudes');
    panel.hidden = sols.length === 0;
    tab.hidden = sols.length === 0;
    if (!sols.length) {
      if (estado.tab === 'solicitudes') irATab('contratos');
      return;
    }

    $('solCount').textContent = sols.length;
    var cont = $('solicitudes');
    vaciar(cont);

    sols.forEach(function (s) {
      var c = el('div', 'sol');

      var f1 = el('div', 'sol-fila1');
      f1.appendChild(el('strong', 'sol-nombre', s.nombre_completo || 'Sin nombre'));
      f1.appendChild(el('span', 'sol-folio', B.folioLabel(s.folio)));
      c.appendChild(f1);

      var det = el('div', 'sol-det');
      det.appendChild(document.createTextNode(
        (s.duracion_nombre || s.duracion_id || '—') + ' · ' +
        s.cantidad_bicis + (s.cantidad_bicis === 1 ? ' bici' : ' bicis')));
      var l2 = el('span', 'c-sub', fechaCorta(s.inicio) + (s.hotel ? ' · ' + s.hotel : ''));
      l2.style.opacity = '0.75';
      det.appendChild(l2);
      c.appendChild(det);

      var chips = el('div', null);
      chips.appendChild(chipEstado(estadoVista(s)));
      c.appendChild(chips);

      var acc = el('div', 'sol-acc');
      var bt = el('button', 'btn btn-amarillo', 'Asignar bicis →');
      bt.type = 'button';
      bt.addEventListener('click', function () { abrirDrawer(s.token); });
      acc.appendChild(bt);
      c.appendChild(acc);

      cont.appendChild(c);
    });
  }

  // ----------------------------------------------------------------- flota
  var CICLO = { disponible: 'cargando', cargando: 'mantenimiento', mantenimiento: 'disponible' };

  function pintarFlota() {
    var flota = (estado.datos && estado.datos.flota) || [];
    var cont = $('flota');
    vaciar(cont);

    if (!flota.length) {
      cont.appendChild(el('div', 'tabla-vacia', 'Todavía no hay unidades en la flota.'));
      return;
    }

    flota.forEach(function (u) {
      var fila = el('div', 'unidad');
      fila.appendChild(el('strong', 'u-id', u.id));

      var med = el('span', 'u-med');
      // Modelo editable: accion.js 'flota' ya acepta { id, modelo }. Se
      // guarda al salir del campo (blur) o con Enter, no en cada tecla.
      var modeloIn = el('input', 'u-modelo-in');
      modeloIn.type = 'text';
      modeloIn.value = u.modelo || 'E-bike WalkMe';
      modeloIn.setAttribute('aria-label', 'Modelo de ' + u.id);
      modeloIn.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') modeloIn.blur();
      });
      modeloIn.addEventListener('blur', function () {
        var v = modeloIn.value.trim() || 'E-bike WalkMe';
        if (v === (u.modelo || 'E-bike WalkMe')) return;
        ejecutar({ accion: 'flota', id: u.id, modelo: v });
      });
      med.appendChild(modeloIn);

      // Columna 'dueno' en bikes_flota: se está agregando en paralelo. Si
      // todavía no existe en la fila que devuelve Supabase, u.dueno es
      // undefined y simplemente no se pinta nada — no debe tronar.
      if (u.dueno) med.appendChild(el('span', 'u-dueno', 'Dueño: ' + u.dueno));

      var bat = el('span', 'u-bat');
      var pct = Math.max(0, Math.min(100, parseInt(u.bateria, 10) || 0));
      var barra = el('span', 'u-barra' + (pct < 25 ? ' baja' : pct < 60 ? ' media' : ''));
      var relleno = el('span');
      relleno.style.width = pct + '%';
      barra.appendChild(relleno);
      bat.appendChild(barra);
      bat.appendChild(el('span', 'u-pct', pct + '%'));
      med.appendChild(bat);
      fila.appendChild(med);

      var bloqueada = u.estado === 'rentada';
      var bt = el('button', 'estado e-' + u.estado + ' u-estado' + (bloqueada ? ' bloqueada' : ''),
        ETIQUETA_ESTADO[u.estado] || u.estado);
      bt.type = 'button';
      if (bloqueada) {
        bt.title = 'Esta bici está en una renta: se libera al cerrarla.';
        bt.disabled = true;
      } else {
        bt.title = 'Tocar para cambiar a ' + (ETIQUETA_ESTADO[CICLO[u.estado]] || '').toLowerCase();
        bt.addEventListener('click', function () {
          var destino = CICLO[u.estado] || 'disponible';
          ejecutar({ accion: 'flota', id: u.id, estado: destino },
            u.id + ' ahora está en "' + (ETIQUETA_ESTADO[destino] || destino).toLowerCase() + '".');
        });
      }
      fila.appendChild(bt);

      var borrar = el('button', 'u-borrar', '×');
      borrar.type = 'button';
      borrar.title = 'Borrar unidad';
      borrar.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        var ok = await confirmar({
          titulo: 'Borrar la unidad ' + u.id + '',
          texto: 'Se quita de la flota. Las rentas viejas que la mencionan no cambian.',
          aceptar: 'Sí, borrarla'
        });
        if (ok) ejecutar({ accion: 'flota', id: u.id, borrar: true }, 'Unidad ' + u.id + ' borrada.');
      });
      fila.appendChild(borrar);

      cont.appendChild(fila);
    });
  }

  // Resumen por dueño (María/Andreina/consignación futura) con botón para
  // avisarles por correo el estado de SUS bicis (api/crm/accion 'avisar_dueno',
  // usa Resend). Solo se pinta si al menos una unidad ya trae 'dueno' —
  // columna que se agrega en paralelo, puede no existir todavía.
  function pintarFlotaDuenos() {
    var cont = $('flotaDuenos');
    if (!cont) return;
    vaciar(cont);
    var flota = (estado.datos && estado.datos.flota) || [];
    var porDueno = {};
    var orden = [];
    flota.forEach(function (u) {
      if (!u.dueno) return;
      if (!porDueno[u.dueno]) { porDueno[u.dueno] = { bicis: [], email: u.dueno_email || '' }; orden.push(u.dueno); }
      porDueno[u.dueno].bicis.push(u.id);
    });
    if (!orden.length) return;

    orden.forEach(function (nombre) {
      var d = porDueno[nombre];
      var fila = el('div', 'dueno-resumen');
      fila.appendChild(el('strong', 'dueno-resumen-nombre', nombre));
      fila.appendChild(el('span', 'dueno-resumen-bicis', d.bicis.join(', ')));
      var btn = el('button', 'btn-sutil', 'Avisar por correo');
      btn.type = 'button';
      if (!d.email) {
        btn.disabled = true;
        btn.title = 'Todavía no hay correo guardado para ' + nombre + '.';
      } else {
        btn.addEventListener('click', async function () {
          btn.disabled = true;
          await ejecutar({ accion: 'avisar_dueno', dueno: nombre },
            'Correo enviado a ' + nombre + '.');
          btn.disabled = false;
        });
      }
      fila.appendChild(btn);
      cont.appendChild(fila);
    });
  }

  // ------------------------------------------------------------ tabs móvil
  function irATab(id) {
    estado.tab = id;
    $('cols').setAttribute('data-tab', id);
    Array.prototype.forEach.call($('tabs').querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-activa', b.getAttribute('data-ir') === id);
    });
  }

  function pintarBadges() {
    var d = estado.datos || {};
    $('badgeContratos').textContent = rentasFiltradas().length;
    $('badgeSolicitudes').textContent = (d.solicitudes || []).length;
    $('badgeFlota').textContent = (d.flota || []).length;
  }

  // ---------------------------------------------------------------- drawer
  function rentaPorToken(token) {
    var rentas = (estado.datos && estado.datos.rentas) || [];
    for (var i = 0; i < rentas.length; i++) if (rentas[i].token === token) return rentas[i];
    return null;
  }

  // Dueños de las unidades asignadas a una renta — sólo si bikes_flota trae
  // la columna 'dueno'/'dueno_email' (se está agregando en paralelo). Si
  // ninguna unidad la trae, regresa lista vacía y la caja no se pinta.
  function duenosDeUnidades(unidades) {
    var flota = (estado.datos && estado.datos.flota) || [];
    var ids = unidades || [];
    var vistos = {};
    var out = [];
    flota.forEach(function (u) {
      if (ids.indexOf(u.id) === -1 || !u.dueno) return;
      var clave = u.dueno + '|' + (u.dueno_email || '');
      if (vistos[clave]) return;
      vistos[clave] = true;
      out.push({ nombre: u.dueno, email: u.dueno_email || '' });
    });
    return out;
  }

  function abrirDrawer(token) {
    estado.tokenAbierto = token;
    estado.editando = false;
    estado.editandoDinero = false;
    estado.cerrando = false;
    estado.capturandoDeposito = false;
    var r = rentaPorToken(token);
    estado.unidadesSel = (r && r.unidades) ? r.unidades.slice() : [];
    $('scrimDrawer').hidden = false;
    $('drawer').hidden = false;
    $('drawer').scrollTop = 0;
    pintarDrawer();
  }

  function cerrarDrawer() {
    estado.tokenAbierto = null;
    estado.editando = false;
    estado.cerrando = false;
    estado.capturandoDeposito = false;
    $('scrimDrawer').hidden = true;
    $('drawer').hidden = true;
    vaciar($('drawerIn'));
  }

  function seccion(titulo, botonExtra) {
    var s = el('section', 'dr-sec');
    var h = el('div', 'dr-sec-head');
    h.appendChild(el('h3', 'dr-sec-tit', titulo));
    if (botonExtra) h.appendChild(botonExtra);
    s.appendChild(h);
    return s;
  }

  function dato(lab, val, opciones) {
    var d = el('div', 'dato');
    d.appendChild(el('span', 'dato-lab', lab));
    var v = el('span', 'dato-val');
    if (opciones && opciones.tel && val) {
      var a = el('a', null, val);
      a.href = 'tel:' + String(val).replace(/[^\d+]/g, '');
      v.appendChild(a);
    } else if (opciones && opciones.mail && val) {
      var m = el('a', null, val);
      m.href = 'mailto:' + val;
      v.appendChild(m);
    } else if (opciones && opciones.fuerte) {
      v.appendChild(el('strong', null, val || '—'));
    } else {
      v.textContent = (val === null || val === undefined || val === '') ? '—' : String(val);
    }
    d.appendChild(v);
    return d;
  }

  function pintarDrawer() {
    var r = rentaPorToken(estado.tokenAbierto);
    var caja = $('drawerIn');
    vaciar(caja);

    if (!r) {
      caja.appendChild(el('p', 'dr-nota', 'Esta renta ya no está en la lista. Actualiza la pantalla.'));
      var volver = el('button', 'btn btn-linea', 'Cerrar');
      volver.type = 'button';
      volver.addEventListener('click', cerrarDrawer);
      caja.appendChild(volver);
      return;
    }

    var vista = estadoVista(r);

    // ---- encabezado
    var top = el('div', 'dr-top');
    var izq = el('div', null);
    izq.appendChild(el('div', 'dr-kicker', r.canal === 'mostrador' ? 'Renta de mostrador' : 'Reserva de la web'));
    izq.appendChild(el('h2', 'dr-folio', B.folioLabel(r.folio)));
    top.appendChild(izq);

    var cerrar = el('button', 'dr-cerrar');
    cerrar.type = 'button';
    cerrar.appendChild(el('span', 'cerrar-largo', '× Cerrar'));
    cerrar.appendChild(el('span', 'cerrar-corto', '← Volver'));
    cerrar.addEventListener('click', cerrarDrawer);
    top.appendChild(cerrar);
    caja.appendChild(top);

    // Chip de estado: SÓLO lectura — es un valor derivado por estadoVista(),
    // no un control. Ver nota de cabecera sobre el diseño.
    var chips = el('div', 'dr-chips');
    chips.appendChild(chipEstado(vista, true));
    if (vista !== r.estado) chips.appendChild(chipEstado(r.estado, true));
    caja.appendChild(chips);

    // ---- cliente
    caja.appendChild(estado.editando ? seccionEdicion(r) : seccionCliente(r));

    // ---- renta
    caja.appendChild(seccionRenta(r));

    // ---- unidades
    caja.appendChild(seccionUnidades(r));

    // ---- dueño(s) de las unidades, si la columna ya existe en Supabase
    var duenos = duenosDeUnidades(r.unidades);
    if (duenos.length) caja.appendChild(seccionDuenos(duenos));

    // ---- dinero
    caja.appendChild(seccionDinero(r));

    // ---- acciones
    caja.appendChild(seccionAcciones(r, duenos));
  }

  function seccionCliente(r) {
    var editar = el('button', 'btn-sutil', 'Editar');
    editar.type = 'button';
    editar.addEventListener('click', function () { estado.editando = true; pintarDrawer(); });

    var s = seccion('Cliente', editar);
    var c = el('div', 'dr-caja');
    c.appendChild(dato('Nombre', r.nombre_completo, { fuerte: true }));
    c.appendChild(dato('Teléfono', r.telefono, { tel: true }));
    c.appendChild(dato('Correo', r.email, { mail: true }));
    c.appendChild(dato('Nacionalidad', r.nacionalidad));
    c.appendChild(dato('Documento', r.documento));
    c.appendChild(dato('Hotel', r.hotel));
    if (r.foto_id_path) {
      var docRow = el('div', 'dato');
      docRow.appendChild(el('span', 'dato-lab', 'Identificación'));
      var docVal = el('span', 'dato-val');
      var verBtn = el('button', 'btn-sutil', 'Ver documento →');
      verBtn.type = 'button';
      verBtn.addEventListener('click', function () { verDocumento(r); });
      docVal.appendChild(verBtn);
      docRow.appendChild(docVal);
      c.appendChild(docRow);
    }
    if (r.notas_internas) c.appendChild(dato('Notas', r.notas_internas));
    s.appendChild(c);
    return s;
  }

  // Signed URL temporal (el bucket es privado): se pide fresco cada vez,
  // nunca se guarda una URL fija.
  async function verDocumento(r) {
    try {
      var resp = await AUTH.apiFetch('/api/crm/foto?token=' + encodeURIComponent(r.token));
      var data = await resp.json();
      if (!resp.ok || !data.url) throw new Error(data.error || 'error');
      window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      toast('No se pudo abrir el documento.', 'error');
    }
  }

  var CAMPOS_EDIT = [
    { k: 'nombre_completo', lab: 'Nombre', tipo: 'text', ancho: true },
    { k: 'telefono', lab: 'Teléfono', tipo: 'tel' },
    { k: 'email', lab: 'Correo', tipo: 'email' },
    { k: 'nacionalidad', lab: 'Nacionalidad', tipo: 'text' },
    { k: 'documento', lab: 'Documento', tipo: 'text' },
    { k: 'hotel', lab: 'Hotel', tipo: 'text', ancho: true },
    { k: 'fecha_reserva', lab: 'Fecha', tipo: 'date' },
    { k: 'hora_inicio', lab: 'Hora', tipo: 'time' },
    { k: 'notas_internas', lab: 'Notas internas', tipo: 'textarea', ancho: true }
  ];

  function seccionEdicion(r) {
    var s = seccion('Editando los datos');
    var caja = el('div', 'dr-caja');
    var grid = el('div', 'form-grid');
    var inputs = {};

    CAMPOS_EDIT.forEach(function (c) {
      var lab = el('label', 'campo' + (c.ancho ? ' ancho' : ''));
      lab.appendChild(el('span', 'campo-lab', c.lab));
      var input;
      if (c.tipo === 'textarea') {
        input = el('textarea', 'campo-in');
      } else {
        input = el('input', 'campo-in');
        input.type = c.tipo;
      }
      var v = r[c.k];
      if (c.k === 'hora_inicio' && v) v = String(v).slice(0, 5);
      input.value = (v === null || v === undefined) ? '' : String(v);
      inputs[c.k] = input;
      lab.appendChild(input);
      grid.appendChild(lab);
    });

    caja.appendChild(grid);

    var acc = el('div', 'form-acc');
    var cancelar = el('button', 'btn btn-linea', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', function () { estado.editando = false; pintarDrawer(); });
    var guardar = el('button', 'btn btn-amarillo', 'Guardar cambios');
    guardar.type = 'button';
    guardar.addEventListener('click', async function () {
      var campos = {};
      var hubo = false;
      CAMPOS_EDIT.forEach(function (c) {
        var orig = r[c.k];
        if (c.k === 'hora_inicio' && orig) orig = String(orig).slice(0, 5);
        orig = (orig === null || orig === undefined) ? '' : String(orig);
        var nuevo = inputs[c.k].value.trim();
        if (nuevo !== orig) { campos[c.k] = nuevo; hubo = true; }
      });
      if (!hubo) { toast('No cambiaste ningún dato.'); return; }
      if ('nombre_completo' in campos && !campos.nombre_completo) {
        toast('El nombre del cliente no puede quedar vacío.', 'error');
        return;
      }
      guardar.disabled = true;
      var ok = await ejecutar({ accion: 'editar', token: r.token, campos: campos }, 'Datos guardados.');
      guardar.disabled = false;
      if (ok) { estado.editando = false; pintarDrawer(); }
    });
    acc.appendChild(cancelar);
    acc.appendChild(guardar);
    caja.appendChild(acc);

    s.appendChild(caja);
    return s;
  }

  function seccionRenta(r) {
    var s = seccion('Renta');
    var c = el('div', 'dr-caja dr-caja-verde');
    c.appendChild(dato('Plan', r.duracion_nombre || r.duracion_id, { fuerte: true }));
    c.appendChild(dato('Bicis', r.cantidad_bicis));
    c.appendChild(dato('Entrega', fechaCorta(r.inicio)));
    c.appendChild(dato('Devolución', fechaCorta(r.fin)));
    c.appendChild(dato('Idioma', r.idioma === 'en' ? 'Inglés' : 'Español'));
    s.appendChild(c);
    return s;
  }

  function seccionUnidades(r) {
    var s = seccion('Unidades asignadas');
    var caja = el('div', 'dr-caja');

    var flota = (estado.datos && estado.datos.flota) || [];
    var propias = r.unidades || [];
    var cerrada = ['cerrada', 'cancelada', 'no_show'].indexOf(r.estado) !== -1;

    if (cerrada) {
      caja.appendChild(el('div', 'dr-nota',
        propias.length ? 'Se usaron: ' + propias.join(', ') : 'No se asignaron unidades.'));
      s.appendChild(caja);
      return s;
    }

    var grid = el('div', 'uni-grid');
    flota.forEach(function (u) {
      var sel = estado.unidadesSel.indexOf(u.id) !== -1;
      var ocupadaPorOtra = u.estado === 'rentada' && propias.indexOf(u.id) === -1;
      var b = el('button', 'uni' + (sel ? ' is-sel' : '') + (ocupadaPorOtra ? ' is-ocupada' : ''));
      b.type = 'button';
      b.appendChild(document.createTextNode(u.id));
      b.appendChild(el('small', null, ocupadaPorOtra ? 'en renta' : (u.bateria || 0) + '%'));
      b.addEventListener('click', function () {
        var i = estado.unidadesSel.indexOf(u.id);
        if (i !== -1) {
          estado.unidadesSel.splice(i, 1);
        } else {
          if (estado.unidadesSel.length >= r.cantidad_bicis) {
            toast('Esta renta es de ' + r.cantidad_bicis + (r.cantidad_bicis === 1 ? ' bici.' : ' bicis.'));
            return;
          }
          estado.unidadesSel.push(u.id);
        }
        pintarDrawer();
      });
      grid.appendChild(b);
    });
    caja.appendChild(grid);

    caja.appendChild(el('div', 'dr-nota',
      'Seleccionadas ' + estado.unidadesSel.length + ' de ' + r.cantidad_bicis + '.'));

    var guardar = el('button', 'btn btn-verde btn-bloque', 'Guardar unidades');
    guardar.type = 'button';
    guardar.style.marginTop = '10px';
    var iguales = estado.unidadesSel.slice().sort().join(',') === propias.slice().sort().join(',');
    guardar.disabled = iguales;
    guardar.addEventListener('click', async function () {
      guardar.disabled = true;
      await ejecutar({ accion: 'unidades', token: r.token, unidades: estado.unidadesSel.slice() },
        'Bicis asignadas.');
      guardar.disabled = false;
    });
    caja.appendChild(guardar);

    s.appendChild(caja);
    return s;
  }

  function seccionDuenos(duenos) {
    var s = seccion('Dueño de las unidades');
    var caja = el('div', 'dr-dueno');
    caja.appendChild(el('span', 'dr-dueno-lab', duenos.length > 1 ? 'Dueños' : 'Dueño'));
    caja.appendChild(el('strong', null, duenos.map(function (d) { return d.nombre; }).join(' · ')));
    s.appendChild(caja);
    return s;
  }

  var METODOS = { stripe: 'Tarjeta (Stripe)', mercadopago: 'MercadoPago', efectivo: 'Efectivo', mostrador: 'Mostrador' };

  // Montos editables a mano (decisión de María, 17-ago-26 — antes el CRM lo
  // prohibía a propósito). api/crm/accion.js audita antes→después en
  // crm_eventos para cada uno; deposito_total NO se edita aquí porque es
  // columna generada en Postgres (deposito_unitario × cantidad_bicis).
  var CAMPOS_DINERO = [
    { k: 'total', lab: 'Total de la renta' },
    { k: 'deposito_unitario', lab: 'Depósito por bici' },
    { k: 'cargo_retraso', lab: 'Cargo por retraso' },
    { k: 'cargo_danos', lab: 'Cargo por daños' }
  ];

  function seccionDinero(r) {
    var editar = el('button', 'btn-sutil', 'Editar montos');
    editar.type = 'button';
    editar.addEventListener('click', function () { estado.editandoDinero = true; pintarDrawer(); });

    var s = seccion('Dinero', estado.editandoDinero ? null : editar);

    if (estado.editandoDinero) {
      s.appendChild(seccionEdicionDinero(r));
      return s;
    }

    var c = el('div', 'dr-caja');
    c.appendChild(dato('Total de la renta', money(r.total), { fuerte: true }));
    c.appendChild(dato('Garantía (depósito)', money(r.deposito_total)));
    if (r.deposito_estado && r.deposito_estado !== 'none') {
      var filaDep = el('div', 'dato');
      filaDep.appendChild(el('span', 'dato-lab', 'Estado del depósito'));
      var valDep = el('span', 'dato-val');
      valDep.appendChild(chipEstado('deposito_' + r.deposito_estado));
      filaDep.appendChild(valDep);
      c.appendChild(filaDep);
      if (r.deposito_estado === 'autorizado' && r.deposito_expira_at) {
        var dias = Math.ceil((new Date(r.deposito_expira_at) - new Date()) / 86400000);
        c.appendChild(dato('Vence en', dias <= 0 ? 'hoy' : (dias + ' día' + (dias === 1 ? '' : 's'))));
      }
      if (r.deposito_estado === 'capturado') {
        c.appendChild(dato('Depósito cobrado', money(r.deposito_capturado)));
      }
      if (r.deposito_estado === 'requiere_atencion' && r.deposito_ultimo_error) {
        c.appendChild(el('div', 'dr-hint', 'Motivo: ' + r.deposito_ultimo_error));
      }
    }
    c.appendChild(dato('Método de pago', r.metodo_pago ? (METODOS[r.metodo_pago] || r.metodo_pago) : '—'));
    if (r.pago_ts) c.appendChild(dato('Pagado el', fechaCorta(r.pago_ts)));
    if (r.estado === 'cerrada' || Number(r.cargo_retraso) || Number(r.cargo_danos)) {
      c.appendChild(dato('Cargo por retraso', money(r.cargo_retraso || 0)));
      c.appendChild(dato('Cargo por daños', money(r.cargo_danos || 0)));
      if (r.cargo_nota) c.appendChild(dato('Nota del cierre', r.cargo_nota));
    }
    if (r.estado === 'cerrada') {
      c.appendChild(dato('Depósito devuelto', money(r.deposito_devuelto || 0), { fuerte: true }));
      if (r.cerrada_at) c.appendChild(dato('Cerrada el', fechaCorta(r.cerrada_at)));
    }
    s.appendChild(c);
    return s;
  }

  function seccionEdicionDinero(r) {
    var caja = el('div', 'dr-caja');
    var aviso = el('p', 'dr-nota');
    aviso.textContent = 'Corrección manual: queda registrada con el valor anterior y el nuevo.';
    caja.appendChild(aviso);

    var grid = el('div', 'form-grid');
    var inputs = {};
    CAMPOS_DINERO.forEach(function (c) {
      var lab = el('label', 'campo');
      lab.appendChild(el('span', 'campo-lab', c.lab));
      var input = el('input', 'campo-in');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      var v = r[c.k];
      input.value = (v === null || v === undefined) ? '0' : String(v);
      inputs[c.k] = input;
      lab.appendChild(input);
      grid.appendChild(lab);
    });
    caja.appendChild(grid);

    var acc = el('div', 'form-acc');
    var cancelar = el('button', 'btn btn-linea', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', function () { estado.editandoDinero = false; pintarDrawer(); });
    var guardar = el('button', 'btn btn-amarillo', 'Guardar montos');
    guardar.type = 'button';
    guardar.addEventListener('click', async function () {
      var campos = {};
      var hubo = false;
      var invalido = false;
      CAMPOS_DINERO.forEach(function (c) {
        var orig = Number(r[c.k]) || 0;
        var nuevo = Number(inputs[c.k].value);
        if (!Number.isFinite(nuevo) || nuevo < 0) { invalido = true; return; }
        if (nuevo !== orig) { campos[c.k] = nuevo; hubo = true; }
      });
      if (invalido) { toast('Revisa los montos: no pueden quedar vacíos ni negativos.', 'error'); return; }
      if (!hubo) { toast('No cambiaste ningún monto.'); return; }
      guardar.disabled = true;
      var ok = await ejecutar({ accion: 'editar', token: r.token, campos: campos }, 'Montos actualizados.');
      guardar.disabled = false;
      if (ok) { estado.editandoDinero = false; pintarDrawer(); }
    });
    acc.appendChild(cancelar);
    acc.appendChild(guardar);
    caja.appendChild(acc);
    return caja;
  }

  // ------------------------------------------------------- acciones drawer
  function urlCupon(r) {
    var pagina = r.idioma === 'en' ? 'cupon-en.html' : 'cupon.html';
    return 'https://www.walkmetours.com/' + pagina + '?t=' + r.token;
  }

  function abrirWhatsApp(r) {
    var texto = 'Hola ' + (r.nombre_completo || '') + ', aquí está tu cupón de reserva WalkMe Bikes (' +
      B.folioLabel(r.folio) + '): ' + urlCupon(r);
    var digitos = String(r.telefono || '').replace(/\D/g, '');
    var url = 'https://wa.me/' + digitos + '?text=' + encodeURIComponent(texto);
    window.open(url, '_blank', 'noopener');
  }

  async function copiarCupon(r) {
    var url = urlCupon(r);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link del cupón copiado.', 'ok');
    } catch (e) {
      await pedirTexto({
        titulo: 'Copia el link a mano',
        texto: 'Tu navegador no dejó copiar solo. Selecciona el texto y cópialo.',
        etiqueta: 'Link del cupón',
        valor: url,
        aceptar: 'Listo'
      });
    }
  }

  // Mail de confirmación al cliente (y, si hay dueño con correo cargado en
  // bikes_flota, con copia). Sólo abre el cliente de correo local — no hay
  // endpoint de envío nuevo, es el mismo patrón que ya usa el diseño v2.
  function mailConfirmacion(r, duenos) {
    if (!r.email && !duenos.length) {
      toast('Esta renta no tiene correo de cliente ni dueño con correo guardado.');
      return;
    }
    var cc = duenos.map(function (d) { return d.email; }).filter(Boolean).join(',');
    var asunto = 'Renta confirmada ' + B.folioLabel(r.folio) + ' · WalkMe Bikes';
    var cuerpo = 'Hola,%0A%0AConfirmamos la renta ' + B.folioLabel(r.folio) + ':%0A' +
      '· Cliente: ' + (r.nombre_completo || '') + ' (' + (r.telefono || '') + ')%0A' +
      '· Plan: ' + (r.duracion_nombre || r.duracion_id || '') + ' · Unidades: ' + (r.unidades || []).join(', ') + '%0A' +
      '· Entrega: ' + fechaCorta(r.inicio) + ' · Devolución: ' + fechaCorta(r.fin) + '%0A' +
      '· Hotel/punto: ' + (r.hotel || '') + '%0A%0AWalkMe Tours coordina la entrega.%0A%0A— WalkMe Tours';
    var mailto = 'mailto:' + encodeURIComponent(r.email || '') +
      (cc ? '?cc=' + encodeURIComponent(cc) + '&' : '?') +
      'subject=' + encodeURIComponent(asunto) + '&body=' + cuerpo;
    window.open(mailto, '_blank');
  }

  function seccionAcciones(r, duenos) {
    var s = seccion('Acciones');
    var cont = el('div', 'dr-acc');

    if (estado.cerrando && r.estado === 'en_curso') {
      cont.appendChild(formularioCierre(r));
      s.appendChild(cont);
      return s;
    }

    if (r.estado === 'pendiente_pago' || r.estado === 'pendiente_efectivo') {
      var cobrar = el('button', 'btn btn-amarillo', 'Cobrar en efectivo (marcar pagada)');
      cobrar.type = 'button';
      cobrar.addEventListener('click', async function () {
        var ok = await confirmar({
          titulo: '¿Ya recibiste el dinero?',
          texto: 'Vas a marcar ' + B.folioLabel(r.folio) + ' como pagada por ' + money(r.total) + '.',
          aceptar: 'Sí, cobrado',
          clase: 'btn-amarillo'
        });
        if (ok) ejecutar({ accion: 'estado', token: r.token, estado: 'pagada' }, 'Renta marcada como pagada.');
      });
      cont.appendChild(cobrar);

      if (r.estado === 'pendiente_pago') {
        var efect = el('button', 'btn btn-linea', 'Pasar a "pagará en efectivo"');
        efect.type = 'button';
        efect.addEventListener('click', function () {
          ejecutar({ accion: 'estado', token: r.token, estado: 'pendiente_efectivo' },
            'Ahora aparece en "por cobrar".');
        });
        cont.appendChild(efect);
      }

      if (r.estado === 'pendiente_efectivo') {
        var noshow = el('button', 'btn btn-linea', 'No llegó (no-show)');
        noshow.type = 'button';
        noshow.addEventListener('click', async function () {
          var ok = await confirmar({
            titulo: '¿Marcar como no-show?',
            texto: 'El cliente no se presentó. La renta queda cerrada sin cobro.',
            aceptar: 'Sí, no llegó'
          });
          if (ok) ejecutar({ accion: 'estado', token: r.token, estado: 'no_show' }, 'Marcada como no-show.');
        });
        cont.appendChild(noshow);
      }
    }

    if (r.estado === 'pagada') {
      var sinUnidades = !r.unidades || !r.unidades.length;
      var entregar = el('button', 'btn btn-amarillo', 'Entregar bici (iniciar renta)');
      entregar.type = 'button';
      entregar.disabled = sinUnidades;
      entregar.addEventListener('click', async function () {
        var ok = await confirmar({
          titulo: '¿Entregar las bicis?',
          texto: 'La renta ' + B.folioLabel(r.folio) + ' pasa a "en curso" con ' +
            (r.unidades || []).join(', ') + '.',
          aceptar: 'Sí, entregadas',
          clase: 'btn-amarillo'
        });
        if (ok) ejecutar({ accion: 'estado', token: r.token, estado: 'en_curso' }, 'Renta en curso. ¡Buen viaje!');
      });
      cont.appendChild(entregar);
      if (sinUnidades) {
        cont.appendChild(el('div', 'dr-hint', 'Primero asigna las bicis arriba para poder entregarlas.'));
      }
    }

    if (r.estado === 'en_curso') {
      var cerrarR = el('button', 'btn btn-amarillo', 'Cerrar renta (devolución)');
      cerrarR.type = 'button';
      cerrarR.addEventListener('click', function () { estado.cerrando = true; pintarDrawer(); });
      cont.appendChild(cerrarR);
    }

    // Depósito de garantía (hold de Stripe) — solo aplica a rentas ya
    // pagadas/entregadas. Los 3 botones son aditivos, no tocan nada de
    // arriba (misma reserva puede tener acciones de renta Y de depósito
    // visibles a la vez, ej. "Entregar bici" + "Autorizar depósito").
    if (['pagada', 'en_curso'].indexOf(r.estado) !== -1) {
      var depEstado = r.deposito_estado || 'none';
      if (['none', 'liberado', 'expirado', 'requiere_atencion'].indexOf(depEstado) !== -1) {
        var autorizar = el('button', 'btn btn-linea',
          'Autorizar depósito (' + money(r.deposito_total) + ')');
        autorizar.type = 'button';
        autorizar.addEventListener('click', async function () {
          autorizar.disabled = true;
          var res = await ejecutar({ accion: 'autorizar_deposito', token: r.token },
            'Depósito iniciado: comparte el link con el cliente para que meta su tarjeta.');
          autorizar.disabled = false;
          if (res && res.url) window.open(res.url, '_blank', 'noopener');
        });
        cont.appendChild(autorizar);
      }

      if (depEstado === 'pendiente') {
        cont.appendChild(el('div', 'dr-hint', 'Esperando a que el cliente termine de meter su tarjeta.'));
        var reintentar = el('button', 'btn btn-linea', 'Actualizar');
        reintentar.type = 'button';
        reintentar.addEventListener('click', function () { cargarTablero(true); });
        cont.appendChild(reintentar);
      }

      if (depEstado === 'autorizado' || depEstado === 'requiere_atencion') {
        if (estado.capturandoDeposito) {
          cont.appendChild(formularioCapturaDeposito(r));
        } else {
          var filaDep = el('div', 'dr-acc-fila');
          var capturarBt = el('button', 'btn btn-amarillo', 'Capturar depósito…');
          capturarBt.type = 'button';
          capturarBt.addEventListener('click', function () { estado.capturandoDeposito = true; pintarDrawer(); });
          filaDep.appendChild(capturarBt);

          var liberarBt = el('button', 'btn btn-linea', 'Liberar depósito');
          liberarBt.type = 'button';
          liberarBt.addEventListener('click', async function () {
            var ok = await confirmar({
              titulo: '¿Liberar el depósito?',
              texto: 'No se le cobra nada al cliente. El hold en su tarjeta se cancela.',
              aceptar: 'Sí, liberar',
              clase: 'btn-amarillo'
            });
            if (ok) ejecutar({ accion: 'liberar_deposito', token: r.token }, 'Depósito liberado.');
          });
          filaDep.appendChild(liberarBt);
          cont.appendChild(filaDep);
        }
      }
    }

    // Cancelar: sólo donde el backend lo permite.
    if (['pendiente_pago', 'pendiente_efectivo', 'pagada'].indexOf(r.estado) !== -1) {
      var cancelar = el('button', 'btn btn-peligro', 'Cancelar esta renta');
      cancelar.type = 'button';
      cancelar.addEventListener('click', async function () {
        var ok = await confirmar({
          titulo: '¿Cancelar ' + B.folioLabel(r.folio) + '?',
          texto: 'Esto no se puede deshacer desde el CRM.',
          aceptar: 'Sí, cancelar'
        });
        if (ok) ejecutar({ accion: 'estado', token: r.token, estado: 'cancelada' }, 'Renta cancelada.');
      });
      cont.appendChild(cancelar);
    }

    // Correo de confirmación (con copia al dueño, si hay uno cargado).
    if (r.email || duenos.length) {
      var mail = el('button', 'btn btn-mail', '✉ Mail a cliente' + (duenos.length ? ' + dueño' : ''));
      mail.type = 'button';
      mail.addEventListener('click', function () { mailConfirmacion(r, duenos); });
      cont.appendChild(mail);
    }

    // Siempre disponibles
    var fila = el('div', 'dr-acc-fila');
    var wa = el('button', 'btn btn-wa', 'Cupón por WhatsApp');
    wa.type = 'button';
    wa.addEventListener('click', function () { abrirWhatsApp(r); });
    fila.appendChild(wa);

    var copiar = el('button', 'btn btn-linea', 'Copiar link');
    copiar.type = 'button';
    copiar.addEventListener('click', function () { copiarCupon(r); });
    fila.appendChild(copiar);
    cont.appendChild(fila);

    if (!r.telefono) {
      cont.appendChild(el('div', 'dr-hint', 'Sin teléfono guardado: WhatsApp se abre para que elijas el chat.'));
    }

    s.appendChild(cont);
    return s;
  }

  // Monto por cobrar del hold, pre-llenado con los cargos de retraso/daños
  // si la renta ya se cerró (lo normal: primero se cierra la renta con sus
  // cargos, luego se resuelve el depósito con ese mismo número).
  function formularioCapturaDeposito(r) {
    var caja = el('div', 'dr-caja');
    caja.appendChild(el('div', 'dr-nota', 'Cobra del depósito solo lo que corresponda a daños o atraso. El resto se libera.'));

    var sugerido = r.cerrada_at
      ? Math.max(0, Number(r.cargo_retraso || 0) + Number(r.cargo_danos || 0))
      : Number(r.deposito_total || 0);

    var grid = el('div', 'form-grid');
    grid.style.marginTop = '10px';
    var lab = el('label', 'campo ancho');
    lab.appendChild(el('span', 'campo-lab', 'Monto a cobrar del depósito (MXN, máx. ' + money(r.deposito_total) + ')'));
    var input = el('input', 'campo-in');
    input.type = 'number'; input.min = '0'; input.step = '50'; input.value = String(sugerido);
    input.inputMode = 'numeric';
    lab.appendChild(input);
    grid.appendChild(lab);
    caja.appendChild(grid);

    var acc = el('div', 'form-acc');
    var volver = el('button', 'btn btn-linea', 'Cancelar');
    volver.type = 'button';
    volver.addEventListener('click', function () { estado.capturandoDeposito = false; pintarDrawer(); });
    var confirmarBt = el('button', 'btn btn-amarillo', 'Cobrar del depósito');
    confirmarBt.type = 'button';
    confirmarBt.addEventListener('click', async function () {
      var monto = Number(input.value);
      if (!Number.isFinite(monto) || monto < 0) { toast('El monto no puede quedar vacío ni negativo.', 'error'); return; }
      confirmarBt.disabled = true;
      var res = await ejecutar({ accion: 'capturar_deposito', token: r.token, monto: monto },
        function (d) { return 'Se cobraron ' + money(d.capturado) + ' del depósito.'; });
      confirmarBt.disabled = false;
      if (res) { estado.capturandoDeposito = false; pintarDrawer(); }
    });
    acc.appendChild(volver);
    acc.appendChild(confirmarBt);
    caja.appendChild(acc);
    return caja;
  }

  function formularioCierre(r) {
    var caja = el('div', 'dr-caja');
    caja.appendChild(el('div', 'dr-nota', 'Anota los cargos, si los hay. El resto del depósito se le devuelve.'));

    var grid = el('div', 'form-grid');
    grid.style.marginTop = '10px';

    var labRetraso = el('label', 'campo');
    labRetraso.appendChild(el('span', 'campo-lab', 'Cargo retraso (MXN)'));
    var inRetraso = el('input', 'campo-in');
    inRetraso.type = 'number'; inRetraso.min = '0'; inRetraso.step = '50'; inRetraso.value = '0';
    inRetraso.inputMode = 'numeric';
    labRetraso.appendChild(inRetraso);
    grid.appendChild(labRetraso);

    var labDanos = el('label', 'campo');
    labDanos.appendChild(el('span', 'campo-lab', 'Cargo daños (MXN)'));
    var inDanos = el('input', 'campo-in');
    inDanos.type = 'number'; inDanos.min = '0'; inDanos.step = '50'; inDanos.value = '0';
    inDanos.inputMode = 'numeric';
    labDanos.appendChild(inDanos);
    grid.appendChild(labDanos);

    var labNota = el('label', 'campo ancho');
    labNota.appendChild(el('span', 'campo-lab', 'Nota (opcional)'));
    var inNota = el('textarea', 'campo-in');
    inNota.placeholder = 'Ej. llegó 2 horas tarde, rayón en el guardabarros…';
    labNota.appendChild(inNota);
    grid.appendChild(labNota);

    caja.appendChild(grid);

    var resumen = el('div', 'cierre-total');
    var etiqueta = el('span', null, 'Se le devuelve');
    var valor = el('span', null, money(r.deposito_total));
    resumen.appendChild(etiqueta);
    resumen.appendChild(valor);
    caja.appendChild(resumen);

    function recalcular() {
      var a = Math.max(0, Number(inRetraso.value) || 0);
      var b = Math.max(0, Number(inDanos.value) || 0);
      valor.textContent = money(Math.max(0, Number(r.deposito_total) - a - b));
    }
    inRetraso.addEventListener('input', recalcular);
    inDanos.addEventListener('input', recalcular);

    var acc = el('div', 'form-acc');
    var volver = el('button', 'btn btn-linea', 'Cancelar');
    volver.type = 'button';
    volver.addEventListener('click', function () { estado.cerrando = false; pintarDrawer(); });
    var confirmarBt = el('button', 'btn btn-amarillo', 'Cerrar y devolver');
    confirmarBt.type = 'button';
    confirmarBt.addEventListener('click', async function () {
      confirmarBt.disabled = true;
      var res = await ejecutar({
        accion: 'cerrar',
        token: r.token,
        cargo_retraso: Math.max(0, Number(inRetraso.value) || 0),
        cargo_danos: Math.max(0, Number(inDanos.value) || 0),
        nota: inNota.value.trim() || null
      }, function (d) { return 'Renta cerrada. Devuelve ' + money(d.deposito_devuelto) + '.'; });
      confirmarBt.disabled = false;
      if (res) { estado.cerrando = false; pintarDrawer(); }
    });
    acc.appendChild(volver);
    acc.appendChild(confirmarBt);
    caja.appendChild(acc);

    return caja;
  }

  // ------------------------------------------------- renta en mostrador
  function horaRedondeada() {
    var d = new Date(Date.now() - MS_CANCUN);
    var m = d.getUTCMinutes();
    d.setUTCMinutes(m <= 30 ? 30 : 60, 0, 0);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  function abrirMostrador() {
    abrirModal(function (caja) {
      caja.appendChild(el('h2', 'modal-tit', 'Renta en mostrador'));
      caja.appendChild(el('p', 'modal-sub', 'Para cuando el cliente ya está aquí. Se cobra en efectivo.'));

      var grid = el('div', 'form-grid');

      var labDur = el('label', 'campo ancho');
      labDur.appendChild(el('span', 'campo-lab', 'Plan de renta'));
      var selDur = el('select', 'campo-in');
      B.CATALOGO.duraciones.forEach(function (d) {
        var o = el('option', null, d.nombre.es + ' · ' + B.money(d.precio));
        o.value = d.id;
        selDur.appendChild(o);
      });
      selDur.value = 'dia';
      labDur.appendChild(selDur);
      grid.appendChild(labDur);

      var labFecha = el('label', 'campo');
      labFecha.appendChild(el('span', 'campo-lab', 'Fecha'));
      var inFecha = el('input', 'campo-in');
      inFecha.type = 'date';
      inFecha.value = hoyCancun();
      labFecha.appendChild(inFecha);
      grid.appendChild(labFecha);

      var labHora = el('label', 'campo');
      labHora.appendChild(el('span', 'campo-lab', 'Hora'));
      var inHora = el('input', 'campo-in');
      inHora.type = 'time';
      inHora.value = horaRedondeada();
      labHora.appendChild(inHora);
      grid.appendChild(labHora);

      var labCant = el('label', 'campo');
      labCant.appendChild(el('span', 'campo-lab', 'Cuántas bicis'));
      var selCant = el('select', 'campo-in');
      for (var i = 1; i <= 6; i++) {
        var oc = el('option', null, String(i));
        oc.value = String(i);
        selCant.appendChild(oc);
      }
      labCant.appendChild(selCant);
      grid.appendChild(labCant);

      var labNom = el('label', 'campo');
      labNom.appendChild(el('span', 'campo-lab', 'Nombre del cliente'));
      var inNom = el('input', 'campo-in');
      inNom.type = 'text';
      inNom.autocomplete = 'off';
      labNom.appendChild(inNom);
      grid.appendChild(labNom);

      var labTel = el('label', 'campo');
      labTel.appendChild(el('span', 'campo-lab', 'Teléfono (opcional)'));
      var inTel = el('input', 'campo-in');
      inTel.type = 'tel';
      labTel.appendChild(inTel);
      grid.appendChild(labTel);

      var labMail = el('label', 'campo');
      labMail.appendChild(el('span', 'campo-lab', 'Correo (opcional)'));
      var inMail = el('input', 'campo-in');
      inMail.type = 'email';
      labMail.appendChild(inMail);
      grid.appendChild(labMail);

      caja.appendChild(grid);

      var total = el('div', 'modal-total');
      caja.appendChild(total);

      function recalcular() {
        vaciar(total);
        var p = B.calcularTotal(selDur.value, parseInt(selCant.value, 10));
        if (!p) { total.textContent = 'Elige un plan válido.'; return; }
        var l1 = el('div', null);
        l1.appendChild(document.createTextNode('Total a cobrar: '));
        l1.appendChild(el('strong', null, B.money(p.total)));
        total.appendChild(l1);
        total.appendChild(el('div', null,
          'Garantía en efectivo: ' + B.money(p.depositoTotal) +
          ' (' + B.money(p.depositoUnitario) + ' por bici, se devuelve)'));
      }
      selDur.addEventListener('change', recalcular);
      selCant.addEventListener('change', recalcular);
      recalcular();

      var err = el('div', 'modal-error');
      err.hidden = true;
      caja.appendChild(err);

      var acc = el('div', 'modal-acc');
      var cancelar = el('button', 'btn btn-linea', 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', cerrarModal);
      var crear = el('button', 'btn btn-amarillo', 'Crear renta');
      crear.type = 'button';
      acc.appendChild(cancelar);
      acc.appendChild(crear);
      caja.appendChild(acc);

      async function enviar(forzar) {
        var nombre = inNom.value.trim();
        if (!nombre) {
          err.hidden = false;
          vaciar(err);
          err.appendChild(document.createTextNode('Escribe el nombre del cliente.'));
          inNom.focus();
          return;
        }
        crear.disabled = true;
        try {
          var res = await accion({
            accion: 'renta_mostrador',
            duracionId: selDur.value,
            fecha: inFecha.value,
            hora: inHora.value,
            cantidad: parseInt(selCant.value, 10),
            nombre: nombre,
            telefono: inTel.value.trim() || undefined,
            email: inMail.value.trim() || undefined,
            forzar: forzar === true ? true : undefined
          });
          cerrarModal();
          toast('Renta ' + B.folioLabel(res.folio) + ' creada.', 'ok');
          await cargarTablero(true);
          abrirDrawer(res.token);
        } catch (e) {
          crear.disabled = false;
          if (e.codigo === 'sin_sesion') { mostrarLogin(); return; }
          vaciar(err);
          err.hidden = false;
          if (e.codigo === 'sin_disponibilidad') {
            var n = (e.data && typeof e.data.disponibles === 'number') ? e.data.disponibles : 0;
            err.appendChild(document.createTextNode(
              n === 1 ? 'Solo queda 1 bici libre en ese horario.'
                : n > 1 ? 'Solo quedan ' + n + ' bicis libres en ese horario.'
                  : 'No queda ninguna bici libre en ese horario.'));
            var forzarBt = el('button', 'btn btn-linea btn-bloque', 'Forzar (sé que hay bici)');
            forzarBt.type = 'button';
            forzarBt.style.marginTop = '10px';
            forzarBt.addEventListener('click', function () { enviar(true); });
            err.appendChild(forzarBt);
          } else {
            err.appendChild(document.createTextNode(textoError(e)));
          }
        }
      }

      crear.addEventListener('click', function () { enviar(false); });
      setTimeout(function () { inNom.focus(); }, 60);
    });
  }

  // ------------------------------------------------------------------ login
  async function entrar(ev) {
    ev.preventDefault();
    var bt = $('loginBtn');
    var err = $('loginError');
    err.hidden = true;
    bt.disabled = true;
    bt.textContent = 'Entrando…';
    try {
      await AUTH.login($('loginEmail').value.trim(), $('loginPass').value);
      $('loginPass').value = '';
      await cargarTablero(false);
    } catch (e) {
      var msg = 'No pudimos entrar. Intenta otra vez.';
      if (e.codigo === 'credenciales_invalidas') msg = 'Correo o contraseña incorrectos';
      else if (e.codigo === 'no_autorizado') msg = 'No tienes acceso al CRM';
      else if (e.codigo === 'crm_no_configurado') {
        mostrarFatal('El CRM aún no está configurado',
          'Falta terminar la configuración en el servidor. Avísale al equipo técnico.');
        return;
      }
      err.textContent = msg;
      err.hidden = false;
    } finally {
      bt.disabled = false;
      bt.textContent = 'Entrar';
    }
  }

  function salir() {
    AUTH.logout();
    estado.datos = null;
    mostrarLogin();
  }

  // --------------------------------------------------------------- arranque
  function conectarEventos() {
    $('formLogin').addEventListener('submit', entrar);
    $('btnSalir').addEventListener('click', salir);
    $('btnSalirMovil').addEventListener('click', salir);
    $('btnRefrescar').addEventListener('click', function () { cargarTablero(false); });
    $('btnMostrador').addEventListener('click', abrirMostrador);
    $('fatalReintentar').addEventListener('click', function () { location.reload(); });
    $('scrimDrawer').addEventListener('click', cerrarDrawer);
    $('scrimModal').addEventListener('click', cerrarModal);

    Array.prototype.forEach.call($('navPrincipal').querySelectorAll('.nav-item[data-vista]'), function (b) {
      b.addEventListener('click', function () { irAVista(b.getAttribute('data-vista')); });
    });

    var buscador = $('buscador');
    var buscarTimer = null;
    buscador.addEventListener('input', function () {
      clearTimeout(buscarTimer);
      buscarTimer = setTimeout(function () {
        estado.busqueda = buscador.value;
        pintarTabla();
        pintarBadges();
      }, 150);
    });

    Array.prototype.forEach.call($('tabs').querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { irATab(b.getAttribute('data-ir')); });
    });

    $('btnAgregarUnidad').addEventListener('click', async function () {
      var id = await pedirTexto({
        titulo: 'Agregar unidad a la flota',
        texto: 'Usa el mismo formato que las demás: B-07.',
        etiqueta: 'Número de la unidad',
        placeholder: 'B-07',
        aceptar: 'Agregar'
      });
      if (!id) return;
      ejecutar({ accion: 'flota', id: id.toUpperCase(), estado: 'disponible', bateria: 100,
        modelo: 'E-bike WalkMe' }, 'Unidad ' + id.toUpperCase() + ' agregada.');
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (estado.modalAbierto) { cerrarModal(); return; }
      if (estado.tokenAbierto) cerrarDrawer();
    });

    // Auto-refresco cada 60 s, sólo si la pestaña está visible y no hay
    // nada a medio escribir (editar / cerrar renta / formulario abierto).
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if ($('vistaApp').hidden) return;
      if (estado.editando || estado.cerrando || estado.modalAbierto) return;
      cargarTablero(true);
    }, 60000);
  }

  function iniciar() {
    conectarEventos();
    irAVista('dashboard');
    if (AUTH.haySesion()) {
      cargarTablero(false);
    } else {
      mostrarLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
