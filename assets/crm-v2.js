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
    datos: null,          // { flota, rentas, solicitudes, kpis, cotizaciones, catalogoServicios, servicioTarifas, operadores, operadorOfertas }
    vista: 'dashboard',   // 'dashboard' | 'bikes' | 'cotizaciones' | 'tarifario' | 'operadores'
    filtro: 'todas',
    busqueda: '',
    tab: 'contratos',
    tokenAbierto: null,
    editando: false,
    editandoDinero: false,
    cerrando: false,
    unidadesSel: [],
    cargando: false,
    modalAbierto: false,
    // ---- Cotizaciones (Fase 3, 17-ago-26) ----
    cotFiltroEstado: 'todas',
    cotFiltroOrigen: 'todas',
    cotAbierta: null,      // id de la cotización abierta en el drawer
    cotVista: 'lista'      // 'lista' | 'formulario' — controla #cotVistaLista/#cotVistaForm
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
    // ---- Cotizaciones ----
    borrador: 'Borrador',
    enviada: 'Enviada',
    aceptada: 'Aceptada',
    expirada: 'Expirada'
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
    accion_invalida: 'Acción no reconocida.'
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
  // 'dashboard', 'bikes', 'cotizaciones', 'tarifario' y 'operadores' tienen
  // contenedor + backend real. Los otros 5 (Reservas, Calendario, Clientes,
  // Finanzas, Reportes) siguen disabled en el HTML ("en construcción").
  var TITULOS_VISTA = {
    dashboard: 'Dashboard', bikes: 'Renta de bicis',
    cotizaciones: 'Cotizaciones', tarifario: 'Tarifario', operadores: 'Operadores'
  };

  function irAVista(vista) {
    estado.vista = vista;
    $('vistaDashboardBody').hidden = vista !== 'dashboard';
    $('vistaBikesBody').hidden = vista !== 'bikes';
    $('vistaCotizacionesBody').hidden = vista !== 'cotizaciones';
    $('vistaTarifarioBody').hidden = vista !== 'tarifario';
    $('vistaOperadoresBody').hidden = vista !== 'operadores';
    $('topTitulo').textContent = TITULOS_VISTA[vista] || vista;
    $('buscador').hidden = vista !== 'bikes';
    $('btnMostrador').hidden = vista !== 'bikes';
    $('btnNuevaCotizacion').hidden = vista !== 'cotizaciones';
    // Cambiar de sección siempre regresa Cotizaciones a la lista (cierra
    // cualquier asistente a medio llenar que hubiera quedado abierto).
    if (vista !== 'cotizaciones' && estado.cotVista === 'formulario') {
      estado.cotVista = 'lista';
      $('cotVistaLista').hidden = false;
      $('cotVistaForm').hidden = true;
      vaciar($('cotVistaForm'));
    }
    Array.prototype.forEach.call($('navPrincipal').querySelectorAll('.nav-item[data-vista]'), function (b) {
      b.classList.toggle('is-activa', b.getAttribute('data-vista') === vista);
    });
    if (estado.datos) {
      if (vista === 'dashboard') pintarDashboard();
      else if (vista === 'bikes') pintarTodo();
      else if (vista === 'cotizaciones') pintarCotizacionesVista();
      else if (vista === 'tarifario') pintarTarifarioVista();
      else if (vista === 'operadores') pintarOperadoresVista();
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
      pintarCotizacionesVista();
      pintarTarifarioVista();
      pintarOperadoresVista();
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
    estado.cotAbierta = null;
    estado.editando = false;
    estado.editandoDinero = false;
    estado.cerrando = false;
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
    estado.cotAbierta = null;
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

  // =====================================================================
  // COTIZACIONES · TARIFARIO · OPERADORES — Fase 3, 17-ago-26.
  // Traduce el look de "CRM Walkme v2.dc.html" (listas + drawer + modal,
  // mismos componentes que ya usa Bikes) sin copiar sus datos mock — ver
  // cabecera del archivo y el prompt de esta fase para las discrepancias
  // corregidas (folio real COT-<folio>, catálogo/operadores vacíos hoy).
  // =====================================================================

  // ---- helpers de formulario reutilizables (Cotizaciones/Tarifario/Operadores) ----
  function campoTexto(grid, etiqueta, tipo, valor, ancho) {
    var lab = el('label', 'campo' + (ancho ? ' ancho' : ''));
    lab.appendChild(el('span', 'campo-lab', etiqueta));
    var input = el('input', 'campo-in');
    input.type = tipo;
    input.value = (valor === null || valor === undefined) ? '' : String(valor);
    lab.appendChild(input);
    grid.appendChild(lab);
    return input;
  }
  function campoSelect(grid, etiqueta, opciones, valorDefault, ancho) {
    var lab = el('label', 'campo' + (ancho ? ' ancho' : ''));
    lab.appendChild(el('span', 'campo-lab', etiqueta));
    var sel = el('select', 'campo-in');
    opciones.forEach(function (p) {
      var o = el('option', null, p[1]);
      o.value = p[0];
      sel.appendChild(o);
    });
    sel.value = valorDefault;
    lab.appendChild(sel);
    grid.appendChild(lab);
    return sel;
  }
  function campoTextarea(grid, etiqueta, valor, ancho) {
    var lab = el('label', 'campo' + (ancho ? ' ancho' : ''));
    lab.appendChild(el('span', 'campo-lab', etiqueta));
    var ta = el('textarea', 'campo-in');
    ta.value = valor || '';
    lab.appendChild(ta);
    grid.appendChild(lab);
    return ta;
  }

  // 'YYYY-MM-DD' → "22 ago 2026" (para fechas de servicio, sin hora).
  function fechaSoloDia(iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '—';
    return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // "Xcaret Plus" → "xcaret-plus" (id del catálogo, lo genera el CRM).
  function slugify(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function iniciales(nombre) {
    var partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    return (partes[0].charAt(0) + (partes[1] ? partes[1].charAt(0) : '')).toUpperCase();
  }

  // ========================================================== Cotizaciones
  var COT_FILTROS_ESTADO = [
    { id: 'todas', lab: 'Todas' },
    { id: 'borrador', lab: 'Borrador' },
    { id: 'enviada', lab: 'Enviada' },
    { id: 'aceptada', lab: 'Aceptada' },
    { id: 'cancelada', lab: 'Cancelada' },
    { id: 'expirada', lab: 'Expirada' }
  ];
  var COT_FILTROS_ORIGEN = [
    { id: 'todas', lab: 'Todas' },
    { id: 'crm', lab: 'Creadas por mí' },
    { id: 'lead_web', lab: 'Leads de la web' }
  ];
  // A qué estados puede pasar cada estado desde el drawer — MISMA matriz
  // que valida api/crm/accion.js 'cotizacion_estado'. No se inventan botones
  // que lleven a una transición que el servidor vaya a rechazar.
  var COT_TRANSICIONES = {
    borrador: [['enviada', 'Marcar como enviada', 'btn-amarillo'], ['cancelada', 'Cancelar cotización', 'btn-peligro']],
    enviada: [['aceptada', 'Marcar como aceptada', 'btn-amarillo'], ['borrador', 'Regresar a borrador', 'btn-linea'], ['cancelada', 'Cancelar cotización', 'btn-peligro']],
    aceptada: [],
    cancelada: [],
    expirada: [['borrador', 'Reabrir como borrador', 'btn-amarillo']]
  };

  function cotizacionPorId(id) {
    var cots = (estado.datos && estado.datos.cotizaciones) || [];
    for (var i = 0; i < cots.length; i++) if (cots[i].id === id) return cots[i];
    return null;
  }

  function totalesCotizacion(c) {
    var items = c.items || [];
    var subtotal = items.reduce(function (sum, it) {
      return sum + (Number(it.adultos) || 0) * (Number(it.precio_adulto) || 0) +
        (Number(it.menores) || 0) * (Number(it.precio_menor) || 0);
    }, 0);
    var descuento = Number(c.descuento) || 0;
    return { subtotal: subtotal, descuento: descuento, total: Math.max(0, subtotal - descuento) };
  }

  function cotizacionesFiltradas() {
    var cots = (estado.datos && estado.datos.cotizaciones) || [];
    if (estado.cotFiltroEstado !== 'todas') {
      cots = cots.filter(function (c) { return c.estado === estado.cotFiltroEstado; });
    }
    if (estado.cotFiltroOrigen !== 'todas') {
      cots = cots.filter(function (c) { return c.origen === estado.cotFiltroOrigen; });
    }
    return cots;
  }

  function pintarCotizacionesVista() {
    pintarCotFiltros();
    pintarTablaCot();
    if (estado.cotAbierta && estado.cotVista !== 'formulario') pintarDrawerCotizacion();
  }

  function pintarCotFiltros() {
    var contE = $('cotFiltrosEstado');
    vaciar(contE);
    COT_FILTROS_ESTADO.forEach(function (f) {
      var b = el('button', 'chip' + (estado.cotFiltroEstado === f.id ? ' is-activo' : ''), f.lab);
      b.type = 'button';
      b.addEventListener('click', function () {
        estado.cotFiltroEstado = f.id;
        pintarCotFiltros();
        pintarTablaCot();
      });
      contE.appendChild(b);
    });
    var contO = $('cotFiltrosOrigen');
    vaciar(contO);
    COT_FILTROS_ORIGEN.forEach(function (f) {
      var b = el('button', 'chip' + (estado.cotFiltroOrigen === f.id ? ' is-activo' : ''), f.lab);
      b.type = 'button';
      b.addEventListener('click', function () {
        estado.cotFiltroOrigen = f.id;
        pintarCotFiltros();
        pintarTablaCot();
      });
      contO.appendChild(b);
    });
  }

  function pintarTablaCot() {
    var cont = $('tablaCot');
    vaciar(cont);
    var todas = (estado.datos && estado.datos.cotizaciones) || [];
    var filas = cotizacionesFiltradas();

    $('cotSub').textContent = filas.length + (filas.length === 1 ? ' cotización' : ' cotizaciones');

    var head = el('div', 'fila fila-head');
    head.appendChild(el('span', 'c-folio', 'Folio'));
    head.appendChild(el('span', 'c-cliente', 'Cliente'));
    head.appendChild(el('span', 'c-creada', 'Creada'));
    head.appendChild(el('span', 'c-total', 'Total'));
    head.appendChild(el('span', 'c-estado', 'Estado'));
    cont.appendChild(head);

    if (!filas.length) {
      cont.appendChild(el('div', 'tabla-vacia',
        todas.length ? 'No hay cotizaciones en este filtro.' : 'Todavía no hay cotizaciones.'));
      return;
    }
    filas.forEach(function (c) { cont.appendChild(filaCot(c)); });
  }

  function filaCot(c) {
    var f = el('div', 'fila');
    f.setAttribute('role', 'button');
    f.setAttribute('tabindex', '0');

    f.appendChild(el('span', 'c-folio', 'COT-' + c.folio));

    var cli = el('span', 'c-cliente');
    var filaNom = el('div', 'cot-nombre-fila');
    filaNom.appendChild(el('strong', null, c.cliente_nombre || 'Sin nombre'));
    if (c.origen === 'lead_web') filaNom.appendChild(el('span', 'badge-lead', 'Lead web'));
    cli.appendChild(filaNom);
    cli.appendChild(el('span', 'c-sub', c.cliente_tel || c.cliente_email || '—'));
    f.appendChild(cli);

    f.appendChild(el('span', 'c-creada', fechaCorta(c.created_at)));

    var tot = totalesCotizacion(c);
    f.appendChild(el('span', 'c-total', money(tot.total)));

    var est = el('span', 'c-estado');
    est.appendChild(chipEstado(c.estado));
    f.appendChild(est);

    function abrir() { abrirDrawerCotizacion(c.id); }
    f.addEventListener('click', abrir);
    f.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); }
    });
    return f;
  }

  function abrirDrawerCotizacion(id) {
    estado.cotAbierta = id;
    estado.tokenAbierto = null;
    $('scrimDrawer').hidden = false;
    $('drawer').hidden = false;
    $('drawer').scrollTop = 0;
    pintarDrawerCotizacion();
  }

  function pintarDrawerCotizacion() {
    var c = cotizacionPorId(estado.cotAbierta);
    var caja = $('drawerIn');
    vaciar(caja);

    if (!c) {
      caja.appendChild(el('p', 'dr-nota', 'Esta cotización ya no está en la lista. Actualiza la pantalla.'));
      var volver = el('button', 'btn btn-linea', 'Cerrar');
      volver.type = 'button';
      volver.addEventListener('click', cerrarDrawer);
      caja.appendChild(volver);
      return;
    }

    var top = el('div', 'dr-top');
    var izq = el('div', null);
    izq.appendChild(el('div', 'dr-kicker', c.origen === 'lead_web' ? 'Lead de la web' : 'Creada en el CRM'));
    izq.appendChild(el('h2', 'dr-folio', 'COT-' + c.folio));
    top.appendChild(izq);
    var cerrar = el('button', 'dr-cerrar');
    cerrar.type = 'button';
    cerrar.appendChild(el('span', 'cerrar-largo', '× Cerrar'));
    cerrar.appendChild(el('span', 'cerrar-corto', '← Volver'));
    cerrar.addEventListener('click', cerrarDrawer);
    top.appendChild(cerrar);
    caja.appendChild(top);

    var chips = el('div', 'dr-chips');
    chips.appendChild(chipEstado(c.estado, true));
    caja.appendChild(chips);

    var secCliente = seccion('Cliente');
    var cc = el('div', 'dr-caja');
    cc.appendChild(dato('Nombre', c.cliente_nombre, { fuerte: true }));
    cc.appendChild(dato('Teléfono', c.cliente_tel, { tel: true }));
    cc.appendChild(dato('Correo', c.cliente_email, { mail: true }));
    cc.appendChild(dato('Creada', fechaCorta(c.created_at)));
    cc.appendChild(dato('Idioma', c.idioma === 'en' ? 'Inglés' : 'Español'));
    if (c.notas) cc.appendChild(dato('Notas', c.notas));
    secCliente.appendChild(cc);
    caja.appendChild(secCliente);

    var secItems = seccion('Servicios cotizados');
    var ci = el('div', null);
    (c.items || []).forEach(function (it) {
      var card = el('div', 'cot-item-vista');
      var top1 = el('div', 'cot-item-vista-top');
      top1.appendChild(el('strong', null, it.servicio_nombre));
      var importe = (Number(it.adultos) || 0) * (Number(it.precio_adulto) || 0) +
        (Number(it.menores) || 0) * (Number(it.precio_menor) || 0);
      top1.appendChild(el('strong', null, money(importe)));
      card.appendChild(top1);
      var partes = [];
      if (it.fecha) partes.push(fechaSoloDia(it.fecha));
      if (it.zona) partes.push(it.zona);
      partes.push(it.nacionalidad === 'nacional' ? 'Nacional' : 'Extranjero');
      partes.push(it.adultos + (it.adultos === 1 ? ' adulto' : ' adultos') +
        (it.menores ? ' + ' + it.menores + (it.menores === 1 ? ' menor' : ' menores') : ''));
      partes.push(money(it.precio_adulto) + '/ad' + (it.precio_menor ? ' · ' + money(it.precio_menor) + '/mn' : ''));
      card.appendChild(el('div', 'cot-item-vista-sub', partes.join(' · ')));
      ci.appendChild(card);
    });
    secItems.appendChild(ci);
    caja.appendChild(secItems);

    var secDinero = seccion('Total');
    var tot = totalesCotizacion(c);
    var cd = el('div', 'dr-caja');
    cd.appendChild(dato('Subtotal', money(tot.subtotal)));
    if (tot.descuento) cd.appendChild(dato('Descuento', '-' + money(tot.descuento)));
    cd.appendChild(dato('Total', money(tot.total), { fuerte: true }));
    secDinero.appendChild(cd);
    caja.appendChild(secDinero);

    caja.appendChild(seccionAccionesCot(c));
  }

  function seccionAccionesCot(c) {
    var s = seccion('Acciones');
    var cont = el('div', 'dr-acc');

    if (c.estado === 'borrador') {
      var editar = el('button', 'btn btn-linea', 'Editar cotización');
      editar.type = 'button';
      editar.addEventListener('click', function () { abrirFormularioCotizacion(c); });
      cont.appendChild(editar);
    }

    (COT_TRANSICIONES[c.estado] || []).forEach(function (t) {
      var destino = t[0], etiqueta = t[1], clase = t[2];
      var b = el('button', 'btn ' + clase, etiqueta);
      b.type = 'button';
      b.addEventListener('click', async function () {
        var ok = await confirmar({
          titulo: '¿' + etiqueta + '?',
          texto: 'COT-' + c.folio + ' pasa de "' + (ETIQUETA_ESTADO[c.estado] || c.estado) +
            '" a "' + (ETIQUETA_ESTADO[destino] || destino) + '".',
          aceptar: 'Sí, continuar',
          clase: destino === 'cancelada' ? 'btn-peligro' : 'btn-amarillo'
        });
        if (ok) ejecutar({ accion: 'cotizacion_estado', id: c.id, estado: destino }, 'Cotización actualizada.');
      });
      cont.appendChild(b);
    });

    var imprimir = el('button', 'btn btn-linea', 'Ver / imprimir cotización');
    imprimir.type = 'button';
    imprimir.addEventListener('click', function () { imprimirCotizacion(c); });
    cont.appendChild(imprimir);

    s.appendChild(cont);
    return s;
  }

  // ---- formulario / asistente de nueva cotización o edición de un borrador ----
  function abrirFormularioCotizacion(cotExistente) {
    cerrarDrawer();
    estado.cotVista = 'formulario';
    $('cotVistaLista').hidden = true;
    var cont = $('cotVistaForm');
    vaciar(cont);
    cont.hidden = false;
    construirFormularioCotizacion(cont, cotExistente);
    cont.scrollIntoView({ block: 'start' });
  }

  function cerrarFormularioCotizacion() {
    estado.cotVista = 'lista';
    $('cotVistaLista').hidden = false;
    $('cotVistaForm').hidden = true;
    vaciar($('cotVistaForm'));
    pintarCotizacionesVista();
  }

  function construirFormularioCotizacion(cont, cotExistente) {
    var editando = !!cotExistente;
    var catalogo = (estado.datos && estado.datos.catalogoServicios) || [];

    var head = el('div', 'cot-form-head');
    head.appendChild(el('h2', 'cot-form-tit', editando ? 'Editar COT-' + cotExistente.folio : 'Nueva cotización'));
    var cancelarX = el('button', 'btn-sutil', '× Cancelar');
    cancelarX.type = 'button';
    cancelarX.addEventListener('click', cerrarFormularioCotizacion);
    head.appendChild(cancelarX);
    cont.appendChild(head);

    if (!catalogo.length) {
      cont.appendChild(el('div', 'cot-aviso',
        'Todavía no hay servicios en el Tarifario. Puedes cotizar escribiendo el nombre del servicio a mano, ' +
        'pero para que el precio se autocomplete primero agrega servicios en Tarifario.'));
    }

    var listaZonas = el('datalist');
    listaZonas.id = 'listaZonasCot';
    var zonasVistas = {};
    ((estado.datos && estado.datos.servicioTarifas) || []).forEach(function (t) {
      if (t.zona && !zonasVistas[t.zona]) {
        zonasVistas[t.zona] = true;
        var o = el('option'); o.value = t.zona; listaZonas.appendChild(o);
      }
    });
    cont.appendChild(listaZonas);

    cont.appendChild(el('div', 'cot-sec-tit', 'Cliente'));
    var gridCliente = el('div', 'form-grid');
    var inNombre = campoTexto(gridCliente, 'Nombre del cliente', 'text', editando ? cotExistente.cliente_nombre : '', true);
    var inTel = campoTexto(gridCliente, 'Teléfono', 'tel', editando ? (cotExistente.cliente_tel || '') : '');
    var inMail = campoTexto(gridCliente, 'Correo', 'email', editando ? (cotExistente.cliente_email || '') : '');
    var selIdioma = null;
    if (!editando) selIdioma = campoSelect(gridCliente, 'Idioma', [['es', 'Español'], ['en', 'Inglés']], 'es');
    cont.appendChild(gridCliente);

    cont.appendChild(el('div', 'cot-sec-tit', 'Servicios'));
    var contItems = el('div', null);
    cont.appendChild(contItems);

    var filas = [];

    function renumerar() {
      Array.prototype.forEach.call(contItems.children, function (card, i) {
        var numEl = card.querySelector('.cot-item-num');
        if (numEl) numEl.textContent = 'Servicio ' + (i + 1);
      });
    }

    function agregarFila(itemInicial) {
      var card = el('div', 'cot-item');
      card.appendChild(el('div', 'cot-item-num', 'Servicio ' + (filas.length + 1)));

      var quitar = el('button', 'cot-item-quitar', '×');
      quitar.type = 'button';
      quitar.title = 'Quitar este servicio';
      card.appendChild(quitar);

      var g = el('div', 'cot-item-grid');

      var labServicio = el('label', 'campo ancho');
      labServicio.appendChild(el('span', 'campo-lab', 'Servicio'));
      var selServicio = el('select', 'campo-in');
      var optOtro = el('option', null, 'Otro (escribir a mano)');
      optOtro.value = '';
      selServicio.appendChild(optOtro);
      catalogo.forEach(function (s) {
        var o = el('option', null, s.nombre + (s.activo === false ? ' (inactivo)' : ''));
        o.value = s.id;
        selServicio.appendChild(o);
      });
      labServicio.appendChild(selServicio);
      g.appendChild(labServicio);

      var labNombre = el('label', 'campo ancho');
      labNombre.appendChild(el('span', 'campo-lab', 'Nombre del servicio (aparece en la cotización)'));
      var inNombreServicio = el('input', 'campo-in');
      inNombreServicio.type = 'text';
      labNombre.appendChild(inNombreServicio);
      g.appendChild(labNombre);

      var labZona = el('label', 'campo');
      labZona.appendChild(el('span', 'campo-lab', 'Zona'));
      var inZona = el('input', 'campo-in');
      inZona.type = 'text';
      inZona.setAttribute('list', 'listaZonasCot');
      inZona.placeholder = 'Riviera Maya…';
      labZona.appendChild(inZona);
      g.appendChild(labZona);

      var labNac = el('label', 'campo');
      labNac.appendChild(el('span', 'campo-lab', 'Nacionalidad'));
      var selNac = el('select', 'campo-in');
      [['extranjero', 'Extranjero'], ['nacional', 'Nacional']].forEach(function (p) {
        var o = el('option', null, p[1]); o.value = p[0]; selNac.appendChild(o);
      });
      labNac.appendChild(selNac);
      g.appendChild(labNac);

      var labFecha = el('label', 'campo');
      labFecha.appendChild(el('span', 'campo-lab', 'Fecha (opcional)'));
      var inFecha = el('input', 'campo-in');
      inFecha.type = 'date';
      labFecha.appendChild(inFecha);
      g.appendChild(labFecha);

      var labAd = el('label', 'campo');
      labAd.appendChild(el('span', 'campo-lab', 'Adultos'));
      var inAd = el('input', 'campo-in');
      inAd.type = 'number'; inAd.min = '0'; inAd.step = '1'; inAd.value = '1';
      labAd.appendChild(inAd);
      g.appendChild(labAd);

      var labMn = el('label', 'campo');
      labMn.appendChild(el('span', 'campo-lab', 'Menores'));
      var inMn = el('input', 'campo-in');
      inMn.type = 'number'; inMn.min = '0'; inMn.step = '1'; inMn.value = '0';
      labMn.appendChild(inMn);
      g.appendChild(labMn);

      var labPa = el('label', 'campo');
      labPa.appendChild(el('span', 'campo-lab', 'Precio adulto'));
      var inPa = el('input', 'campo-in');
      inPa.type = 'number'; inPa.min = '0'; inPa.step = '1'; inPa.value = '0';
      labPa.appendChild(inPa);
      g.appendChild(labPa);

      var labPm = el('label', 'campo');
      labPm.appendChild(el('span', 'campo-lab', 'Precio menor'));
      var inPm = el('input', 'campo-in');
      inPm.type = 'number'; inPm.min = '0'; inPm.step = '1'; inPm.value = '0';
      labPm.appendChild(inPm);
      g.appendChild(labPm);

      card.appendChild(g);
      var sub = el('div', 'cot-item-sub');
      card.appendChild(sub);
      contItems.appendChild(card);

      function autocompletar() {
        var tarifas = (estado.datos && estado.datos.servicioTarifas) || [];
        var sid = selServicio.value;
        var zona = inZona.value.trim();
        var nac = selNac.value;
        if (!sid || !zona) { sub.textContent = ''; return; }
        var match = tarifas.filter(function (t) {
          return t.servicio_id === sid && t.nacionalidad === nac &&
            String(t.zona || '').trim().toLowerCase() === zona.toLowerCase();
        })[0];
        if (match) {
          inPa.value = String(match.precio_adulto);
          inPm.value = (match.precio_menor === null || match.precio_menor === undefined) ? '0' : String(match.precio_menor);
          sub.textContent = 'Precio tomado del Tarifario para esa zona/nacionalidad. Puedes cambiarlo a mano.';
          recalcularTotal();
        } else {
          sub.textContent = 'Sin tarifa guardada para esa combinación — escribe el precio a mano.';
        }
      }

      selServicio.addEventListener('change', function () {
        if (selServicio.value) {
          var s = catalogo.filter(function (x) { return x.id === selServicio.value; })[0];
          if (s) inNombreServicio.value = s.nombre;
        }
        autocompletar();
      });
      inZona.addEventListener('change', autocompletar);
      selNac.addEventListener('change', autocompletar);

      if (itemInicial) {
        if (itemInicial.servicio_id) selServicio.value = itemInicial.servicio_id;
        inNombreServicio.value = itemInicial.servicio_nombre || '';
        inZona.value = itemInicial.zona || '';
        selNac.value = itemInicial.nacionalidad === 'nacional' ? 'nacional' : 'extranjero';
        if (itemInicial.fecha) inFecha.value = String(itemInicial.fecha).slice(0, 10);
        inAd.value = String(itemInicial.adultos != null ? itemInicial.adultos : 1);
        inMn.value = String(itemInicial.menores != null ? itemInicial.menores : 0);
        inPa.value = String(itemInicial.precio_adulto != null ? itemInicial.precio_adulto : 0);
        inPm.value = String(itemInicial.precio_menor != null ? itemInicial.precio_menor : 0);
      }

      var fila = {
        obtener: function () {
          var nombre = inNombreServicio.value.trim();
          if (!nombre) return null;
          var pa = Number(inPa.value);
          if (!Number.isFinite(pa)) return null;
          return {
            servicio_id: selServicio.value || null,
            servicio_nombre: nombre,
            fecha: inFecha.value || null,
            zona: inZona.value.trim() || null,
            nacionalidad: selNac.value === 'nacional' ? 'nacional' : 'extranjero',
            adultos: Math.max(0, parseInt(inAd.value, 10) || 0),
            menores: Math.max(0, parseInt(inMn.value, 10) || 0),
            precio_adulto: pa,
            precio_menor: inPm.value === '' ? 0 : (Number(inPm.value) || 0)
          };
        },
        subtotal: function () {
          var ad = Math.max(0, parseInt(inAd.value, 10) || 0);
          var mn = Math.max(0, parseInt(inMn.value, 10) || 0);
          return ad * (Number(inPa.value) || 0) + mn * (Number(inPm.value) || 0);
        }
      };
      filas.push(fila);

      quitar.addEventListener('click', function () {
        if (filas.length <= 1) { toast('La cotización necesita al menos un servicio.'); return; }
        var i = filas.indexOf(fila);
        if (i !== -1) filas.splice(i, 1);
        card.parentNode.removeChild(card);
        renumerar();
        recalcularTotal();
      });

      [inAd, inMn, inPa, inPm].forEach(function (input) {
        input.addEventListener('input', recalcularTotal);
      });
    }

    var itemsIniciales = (editando && cotExistente.items && cotExistente.items.length)
      ? cotExistente.items : [null];
    itemsIniciales.forEach(function (it) { agregarFila(it); });

    var btnAgregarItem = el('button', 'btn-agregar-item', '+ Agregar servicio');
    btnAgregarItem.type = 'button';
    btnAgregarItem.addEventListener('click', function () { agregarFila(null); recalcularTotal(); });
    cont.appendChild(btnAgregarItem);

    cont.appendChild(el('div', 'cot-sec-tit', 'Notas y descuento'));
    var gridExtra = el('div', 'form-grid');
    var inNotas = campoTextarea(gridExtra, 'Notas (opcional)', editando ? (cotExistente.notas || '') : '', true);
    var inDescuento = campoTexto(gridExtra, 'Descuento (MXN, opcional)', 'number', editando ? String(cotExistente.descuento || 0) : '0');
    cont.appendChild(gridExtra);
    inDescuento.min = '0';

    var totalBox = el('div', 'cot-total-box');
    cont.appendChild(totalBox);

    function recalcularTotal() {
      var subtotal = filas.reduce(function (sum, f) { return sum + f.subtotal(); }, 0);
      var descuento = Math.max(0, Number(inDescuento.value) || 0);
      var total = Math.max(0, subtotal - descuento);
      vaciar(totalBox);
      var f1 = el('div', 'cot-total-fila');
      f1.appendChild(el('span', null, 'Subtotal'));
      f1.appendChild(el('span', null, money(subtotal)));
      totalBox.appendChild(f1);
      if (descuento) {
        var f2 = el('div', 'cot-total-fila');
        f2.appendChild(el('span', null, 'Descuento'));
        f2.appendChild(el('span', null, '-' + money(descuento)));
        totalBox.appendChild(f2);
      }
      var f3 = el('div', 'cot-total-fila cot-total-final');
      f3.appendChild(el('span', null, 'Total'));
      f3.appendChild(el('span', null, money(total)));
      totalBox.appendChild(f3);
    }
    inDescuento.addEventListener('input', recalcularTotal);
    recalcularTotal();

    var acc = el('div', 'form-acc');
    var btnCancelar = el('button', 'btn btn-linea', 'Cancelar');
    btnCancelar.type = 'button';
    btnCancelar.addEventListener('click', cerrarFormularioCotizacion);
    var btnGuardar = el('button', 'btn btn-amarillo', editando ? 'Guardar cambios' : 'Crear cotización');
    btnGuardar.type = 'button';
    btnGuardar.addEventListener('click', async function () {
      var nombre = inNombre.value.trim();
      if (!nombre) { toast('Escribe el nombre del cliente.', 'error'); inNombre.focus(); return; }
      var items = [];
      var huboInvalido = false;
      filas.forEach(function (f) {
        var it = f.obtener();
        if (it) items.push(it); else huboInvalido = true;
      });
      if (!items.length) {
        toast(huboInvalido ? 'Revisa los servicios: falta el nombre o el precio.' : 'Agrega al menos un servicio.', 'error');
        return;
      }
      btnGuardar.disabled = true;
      var res;
      if (editando) {
        res = await ejecutar({
          accion: 'cotizacion_editar', id: cotExistente.id,
          cliente_nombre: nombre,
          cliente_tel: inTel.value.trim() || undefined,
          cliente_email: inMail.value.trim() || undefined,
          notas: inNotas.value.trim() || undefined,
          descuento: Math.max(0, Number(inDescuento.value) || 0),
          items: items
        }, 'Cotización actualizada.');
      } else {
        res = await ejecutar({
          accion: 'cotizacion_crear',
          cliente_nombre: nombre,
          cliente_tel: inTel.value.trim() || undefined,
          cliente_email: inMail.value.trim() || undefined,
          idioma: selIdioma ? selIdioma.value : 'es',
          descuento: Math.max(0, Number(inDescuento.value) || 0),
          notas: inNotas.value.trim() || undefined,
          items: items
        }, function (r) { return 'Cotización COT-' + r.folio + ' creada.'; });
      }
      btnGuardar.disabled = false;
      if (res) {
        var idAbrir = editando ? cotExistente.id : res.id;
        cerrarFormularioCotizacion();
        if (idAbrir) abrirDrawerCotizacion(idAbrir);
      }
    });
    acc.appendChild(btnCancelar);
    acc.appendChild(btnGuardar);
    cont.appendChild(acc);
  }

  // ---- vista de impresión (hoja carta) ----
  function imprimirCotizacion(c) {
    pintarHojaCot(c);
    $('hojaCot').hidden = false;
    window.print();
  }
  window.addEventListener('afterprint', function () { $('hojaCot').hidden = true; });

  function pintarHojaCot(c) {
    var hoja = $('hojaCot');
    vaciar(hoja);
    var wrap = el('div', 'hoja-en');

    var head = el('div', 'hoja-head');
    var logo = document.createElement('img');
    logo.className = 'hoja-logo';
    logo.src = 'uploads/WALKME_LOGO_FVERDE.png';
    logo.alt = 'WalkMe Tours';
    head.appendChild(logo);
    var der = el('div', null);
    der.appendChild(el('div', 'hoja-folio-lab', 'Cotización'));
    der.appendChild(el('div', 'hoja-folio', 'COT-' + c.folio));
    der.appendChild(el('div', 'hoja-fecha', fechaCorta(c.created_at)));
    head.appendChild(der);
    wrap.appendChild(head);

    var datos = el('div', 'hoja-datos');
    [['Cliente', c.cliente_nombre || '—'],
     ['Teléfono / correo', c.cliente_tel || c.cliente_email || '—'],
     ['Estado', ETIQUETA_ESTADO[c.estado] || c.estado]].forEach(function (p) {
      var cel = el('div', 'hoja-dato-cel');
      cel.appendChild(el('div', 'hoja-dato-lab', p[0]));
      cel.appendChild(el('div', 'hoja-dato-val', p[1]));
      datos.appendChild(cel);
    });
    wrap.appendChild(datos);

    var tabla = document.createElement('table');
    tabla.className = 'hoja-tabla';
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    ['Servicio', 'Pax', 'Precio unitario', 'Importe'].forEach(function (t, i) {
      var th = document.createElement('th');
      th.textContent = t;
      if (i === 3) th.style.textAlign = 'right';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tabla.appendChild(thead);

    var tbody = document.createElement('tbody');
    (c.items || []).forEach(function (it) {
      var tr = document.createElement('tr');

      var tdServ = document.createElement('td');
      tdServ.appendChild(el('strong', null, it.servicio_nombre));
      var partes = [];
      if (it.fecha) partes.push(fechaSoloDia(it.fecha));
      if (it.zona) partes.push(it.zona);
      partes.push(it.nacionalidad === 'nacional' ? 'Nacional' : 'Extranjero');
      tdServ.appendChild(el('div', 'hoja-servicio-sub', partes.join(' · ')));
      tr.appendChild(tdServ);

      var tdPax = document.createElement('td');
      tdPax.textContent = it.adultos + ' ad' + (it.menores ? ' + ' + it.menores + ' mn' : '');
      tr.appendChild(tdPax);

      var tdPrecio = document.createElement('td');
      tdPrecio.textContent = money(it.precio_adulto) + (it.precio_menor ? ' / ' + money(it.precio_menor) : '');
      tr.appendChild(tdPrecio);

      var importe = (Number(it.adultos) || 0) * (Number(it.precio_adulto) || 0) +
        (Number(it.menores) || 0) * (Number(it.precio_menor) || 0);
      var tdImp = document.createElement('td');
      tdImp.className = 'num';
      tdImp.textContent = money(importe);
      tr.appendChild(tdImp);

      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    wrap.appendChild(tabla);

    var tot = totalesCotizacion(c);
    var totales = el('div', 'hoja-totales');
    var f1 = el('div', 'hoja-tot-fila');
    f1.appendChild(el('span', null, 'Subtotal'));
    f1.appendChild(el('strong', null, money(tot.subtotal)));
    totales.appendChild(f1);
    if (tot.descuento) {
      var f2 = el('div', 'hoja-tot-fila');
      f2.appendChild(el('span', null, 'Descuento'));
      f2.appendChild(el('strong', null, '-' + money(tot.descuento)));
      totales.appendChild(f2);
    }
    var f3 = el('div', 'hoja-tot-final');
    f3.appendChild(el('span', null, 'Total'));
    f3.appendChild(el('strong', null, money(tot.total)));
    totales.appendChild(f3);
    wrap.appendChild(totales);

    if (c.notas) {
      var notas = el('div', 'hoja-notas');
      notas.appendChild(el('strong', null, 'Notas: '));
      notas.appendChild(document.createTextNode(c.notas));
      wrap.appendChild(notas);
    }

    var pie = el('div', 'hoja-pie');
    pie.appendChild(el('span', null, 'WalkMe Tours · Playa del Carmen, Q. Roo'));
    pie.appendChild(el('span', null, 'WhatsApp +52 984 178 4102 · hola@walkmetours.com'));
    wrap.appendChild(pie);

    hoja.appendChild(wrap);
  }

  // =============================================================== Tarifario
  var CATEGORIA_LABEL = { tour: 'Tour', parque: 'Parque', bici: 'Bici' };

  function pintarTarifarioVista() {
    var servicios = (estado.datos && estado.datos.catalogoServicios) || [];
    var tarifas = (estado.datos && estado.datos.servicioTarifas) || [];
    var cont = $('tarLista');
    vaciar(cont);
    $('tarSub').textContent = servicios.length + (servicios.length === 1 ? ' servicio' : ' servicios');

    if (!servicios.length) {
      cont.appendChild(el('div', 'tabla-vacia', 'Todavía no hay servicios en el tarifario — agrega el primero.'));
      return;
    }

    var tarifasPorServicio = {};
    tarifas.forEach(function (t) {
      (tarifasPorServicio[t.servicio_id] = tarifasPorServicio[t.servicio_id] || []).push(t);
    });

    servicios.forEach(function (s) {
      cont.appendChild(filaServicioTarifario(s, tarifasPorServicio[s.id] || []));
    });
  }

  function filaServicioTarifario(s, tarifasServicio) {
    var fila = el('div', 'tar-servicio' + (s.activo === false ? ' tar-inactivo' : ''));

    var head = el('div', 'tar-servicio-head');
    var izq = el('div', null);
    var nom = el('div', 'tar-servicio-nom');
    nom.appendChild(document.createTextNode(s.nombre));
    if (s.activo === false) nom.appendChild(el('span', 'tar-tag', 'Inactivo'));
    izq.appendChild(nom);
    izq.appendChild(el('div', 'tar-servicio-meta',
      (CATEGORIA_LABEL[s.categoria] || s.categoria) + ' · ' +
      tarifasServicio.length + (tarifasServicio.length === 1 ? ' tarifa' : ' tarifas')));
    head.appendChild(izq);

    var acc = el('div', 'tar-servicio-acc');
    var editarServ = el('button', 'btn-sutil', 'Editar servicio');
    editarServ.type = 'button';
    editarServ.addEventListener('click', function () { abrirModalServicio(s); });
    acc.appendChild(editarServ);
    var agregarTar = el('button', 'btn-sutil', '+ Agregar tarifa');
    agregarTar.type = 'button';
    agregarTar.addEventListener('click', function () { abrirModalTarifa(s, null); });
    acc.appendChild(agregarTar);
    head.appendChild(acc);
    fila.appendChild(head);

    var lista = el('div', 'tar-tarifas');
    if (!tarifasServicio.length) {
      lista.appendChild(el('div', 'tar-vacio', 'Sin tarifas todavía.'));
    } else {
      tarifasServicio.forEach(function (t) {
        var row = el('div', 'tar-tarifa-row');
        row.appendChild(el('strong', null, t.zona + ' · ' + (t.nacionalidad === 'nacional' ? 'Nacional' : 'Extranjero')));
        row.appendChild(el('span', null, 'Adulto ' + money(t.precio_adulto)));
        row.appendChild(el('span', null, (t.precio_menor != null) ? 'Menor ' + money(t.precio_menor) : 'Sin tarifa de menor'));
        row.appendChild(el('span', null, t.vigente === false ? 'No vigente' : 'Vigente'));
        var edBtn = el('button', 'btn-sutil', 'Editar');
        edBtn.type = 'button';
        edBtn.addEventListener('click', function () { abrirModalTarifa(s, t); });
        row.appendChild(edBtn);
        lista.appendChild(row);
      });
    }
    fila.appendChild(lista);
    return fila;
  }

  function abrirModalServicio(servicioExistente) {
    abrirModal(function (caja) {
      var editando = !!servicioExistente;
      caja.appendChild(el('h2', 'modal-tit', editando ? 'Editar servicio' : 'Nuevo servicio'));
      caja.appendChild(el('p', 'modal-sub', editando
        ? 'ID interno: ' + servicioExistente.id
        : 'El identificador se genera solo a partir del nombre (ej. "Xcaret Plus" → xcaret-plus).'));

      var grid = el('div', 'form-grid');
      var inNombre = campoTexto(grid, 'Nombre', 'text', editando ? servicioExistente.nombre : '', true);
      var selCat = campoSelect(grid, 'Categoría', [['tour', 'Tour'], ['parque', 'Parque']], editando ? servicioExistente.categoria : 'tour');
      var selActivo = campoSelect(grid, 'Estado', [['si', 'Activo'], ['no', 'Inactivo']],
        (editando && servicioExistente.activo === false) ? 'no' : 'si', true);
      caja.appendChild(grid);

      var err = el('div', 'modal-error');
      err.hidden = true;
      caja.appendChild(err);

      var acc = el('div', 'modal-acc');
      var cancelar = el('button', 'btn btn-linea', 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', cerrarModal);
      var guardar = el('button', 'btn btn-amarillo', 'Guardar');
      guardar.type = 'button';
      guardar.addEventListener('click', async function () {
        var nombre = inNombre.value.trim();
        if (!nombre) { err.hidden = false; err.textContent = 'Escribe el nombre del servicio.'; return; }
        var id = editando ? servicioExistente.id : slugify(nombre);
        if (!id) { err.hidden = false; err.textContent = 'No se pudo generar un identificador de ese nombre.'; return; }
        guardar.disabled = true;
        var res = await ejecutar({
          accion: 'servicio_guardar', id: id, nombre: nombre,
          categoria: selCat.value, activo: selActivo.value === 'si'
        }, editando ? 'Servicio actualizado.' : 'Servicio "' + nombre + '" agregado.');
        guardar.disabled = false;
        if (res) cerrarModal();
      });
      acc.appendChild(cancelar);
      acc.appendChild(guardar);
      caja.appendChild(acc);
    });
  }

  function abrirModalTarifa(servicio, tarifaExistente) {
    abrirModal(function (caja) {
      var editando = !!tarifaExistente;
      caja.appendChild(el('h2', 'modal-tit', editando ? 'Editar tarifa' : 'Nueva tarifa'));
      caja.appendChild(el('p', 'modal-sub', servicio.nombre +
        (editando ? ' — la zona y la nacionalidad no se cambian aquí; crea una tarifa nueva si necesitas otra combinación.' : '')));

      var grid = el('div', 'form-grid');
      var inZona, selNac;
      if (editando) {
        var zonaFija = el('div', 'campo');
        zonaFija.appendChild(el('span', 'campo-lab', 'Zona'));
        zonaFija.appendChild(el('div', null, tarifaExistente.zona));
        grid.appendChild(zonaFija);
        var nacFija = el('div', 'campo');
        nacFija.appendChild(el('span', 'campo-lab', 'Nacionalidad'));
        nacFija.appendChild(el('div', null, tarifaExistente.nacionalidad === 'nacional' ? 'Nacional' : 'Extranjero'));
        grid.appendChild(nacFija);
      } else {
        inZona = campoTexto(grid, 'Zona', 'text', '', false);
        inZona.setAttribute('list', 'listaZonasTarifario');
        selNac = campoSelect(grid, 'Nacionalidad', [['extranjero', 'Extranjero'], ['nacional', 'Nacional']], 'extranjero');
      }
      var inPa = campoTexto(grid, 'Precio adulto', 'number', editando ? String(tarifaExistente.precio_adulto) : '0');
      var inPm = campoTexto(grid, 'Precio menor (opcional)', 'number',
        (editando && tarifaExistente.precio_menor != null) ? String(tarifaExistente.precio_menor) : '');
      caja.appendChild(grid);

      if (!editando) {
        var listaZ = el('datalist');
        listaZ.id = 'listaZonasTarifario';
        var vistos = {};
        ((estado.datos && estado.datos.servicioTarifas) || []).forEach(function (t) {
          if (t.zona && !vistos[t.zona]) { vistos[t.zona] = true; var o = el('option'); o.value = t.zona; listaZ.appendChild(o); }
        });
        caja.appendChild(listaZ);
      }

      var err = el('div', 'modal-error');
      err.hidden = true;
      caja.appendChild(err);

      var acc = el('div', 'modal-acc');
      var cancelar = el('button', 'btn btn-linea', 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', cerrarModal);
      var guardar = el('button', 'btn btn-amarillo', 'Guardar');
      guardar.type = 'button';
      guardar.addEventListener('click', async function () {
        var zona = editando ? tarifaExistente.zona : inZona.value.trim();
        var nac = editando ? tarifaExistente.nacionalidad : selNac.value;
        if (!zona) { err.hidden = false; err.textContent = 'Escribe la zona.'; return; }
        var pa = Number(inPa.value);
        if (!Number.isFinite(pa) || pa < 0) { err.hidden = false; err.textContent = 'El precio de adulto no es válido.'; return; }
        guardar.disabled = true;
        var res = await ejecutar({
          accion: 'tarifa_guardar', servicio_id: servicio.id, zona: zona, nacionalidad: nac,
          precio_adulto: pa, precio_menor: inPm.value.trim() === '' ? null : Number(inPm.value)
        }, 'Tarifa guardada.');
        guardar.disabled = false;
        if (res) cerrarModal();
      });
      acc.appendChild(cancelar);
      acc.appendChild(guardar);
      caja.appendChild(acc);
    });
  }

  // =============================================================== Operadores
  function pintarOperadoresVista() {
    var operadores = (estado.datos && estado.datos.operadores) || [];
    var ofertas = (estado.datos && estado.datos.operadorOfertas) || [];
    var cont = $('opLista');
    vaciar(cont);
    $('opSub').textContent = operadores.length + (operadores.length === 1 ? ' operador' : ' operadores');

    if (!operadores.length) {
      cont.appendChild(el('div', 'tabla-vacia', 'Todavía no hay operadores — agrega el primero.'));
      return;
    }

    var ofertasPorOperador = {};
    ofertas.forEach(function (o) {
      (ofertasPorOperador[o.operador_id] = ofertasPorOperador[o.operador_id] || []).push(o);
    });

    operadores.forEach(function (op) {
      cont.appendChild(tarjetaOperador(op, ofertasPorOperador[op.id] || []));
    });
  }

  function tarjetaOperador(op, ofertasOp) {
    var servicios = (estado.datos && estado.datos.catalogoServicios) || [];
    var tarifas = (estado.datos && estado.datos.servicioTarifas) || [];
    var serviciosPorId = {};
    servicios.forEach(function (s) { serviciosPorId[s.id] = s; });

    var card = el('div', 'op-card' + (op.activo === false ? ' tar-inactivo' : ''));
    var head = el('div', 'op-card-head');
    head.appendChild(el('div', 'op-avatar', iniciales(op.nombre)));
    var izq = el('div', null);
    var nom = el('div', 'op-nombre');
    nom.appendChild(document.createTextNode(op.nombre));
    if (op.activo === false) nom.appendChild(el('span', 'tar-tag', 'Inactivo'));
    izq.appendChild(nom);
    var metaPartes = [];
    if (op.contacto) metaPartes.push(op.contacto);
    if (op.telefono) metaPartes.push(op.telefono);
    izq.appendChild(el('div', 'op-meta', metaPartes.length ? metaPartes.join(' · ') : 'Sin contacto guardado'));
    if (op.notas) izq.appendChild(el('div', 'op-meta', op.notas));
    head.appendChild(izq);

    var acc = el('div', 'op-acc');
    var editarOp = el('button', 'btn-sutil', 'Editar');
    editarOp.type = 'button';
    editarOp.addEventListener('click', function () { abrirModalOperador(op); });
    acc.appendChild(editarOp);
    var agregarOf = el('button', 'btn-sutil', '+ Agregar oferta');
    agregarOf.type = 'button';
    if (!servicios.length) {
      agregarOf.disabled = true;
      agregarOf.title = 'Agrega primero un servicio en Tarifario.';
    } else {
      agregarOf.addEventListener('click', function () { abrirModalOferta(op, null); });
    }
    acc.appendChild(agregarOf);
    head.appendChild(acc);
    card.appendChild(head);

    var lista = el('div', 'op-ofertas');
    if (!ofertasOp.length) {
      lista.appendChild(el('div', 'tar-vacio', 'Sin ofertas de este operador todavía.'));
    } else {
      ofertasOp.forEach(function (of) {
        var s = serviciosPorId[of.servicio_id];
        var row = el('div', 'op-oferta-row');
        row.appendChild(el('strong', null, s ? s.nombre : of.servicio_id));
        row.appendChild(el('span', null, 'Neto ad ' + money(of.neto_adulto)));
        row.appendChild(el('span', null, (of.neto_menor != null) ? 'Neto mn ' + money(of.neto_menor) : 'Sin neto de menor'));

        var ventas = tarifas.filter(function (t) { return t.servicio_id === of.servicio_id; });
        var margenTxt = ventas.map(function (v) {
          return money(Number(v.precio_adulto) - Number(of.neto_adulto)) + ' (' + v.zona + ')';
        }).join(' · ');
        row.appendChild(el('span', margenTxt ? 'op-margen' : null, margenTxt || '—'));

        var edBtn = el('button', 'btn-sutil', 'Editar');
        edBtn.type = 'button';
        edBtn.addEventListener('click', function () { abrirModalOferta(op, of); });
        row.appendChild(edBtn);

        lista.appendChild(row);
      });
    }
    card.appendChild(lista);
    return card;
  }

  function abrirModalOperador(operadorExistente) {
    abrirModal(function (caja) {
      var editando = !!operadorExistente;
      caja.appendChild(el('h2', 'modal-tit', editando ? 'Editar operador' : 'Nuevo operador'));
      var grid = el('div', 'form-grid');
      var inNombre = campoTexto(grid, 'Nombre', 'text', editando ? operadorExistente.nombre : '', true);
      var inContacto = campoTexto(grid, 'Contacto (persona)', 'text', editando ? (operadorExistente.contacto || '') : '');
      var inTel = campoTexto(grid, 'Teléfono', 'tel', editando ? (operadorExistente.telefono || '') : '');
      var selActivo = campoSelect(grid, 'Estado', [['si', 'Activo'], ['no', 'Inactivo']],
        (editando && operadorExistente.activo === false) ? 'no' : 'si');
      var inNotas = campoTextarea(grid, 'Notas (opcional)', editando ? (operadorExistente.notas || '') : '', true);
      caja.appendChild(grid);

      var err = el('div', 'modal-error');
      err.hidden = true;
      caja.appendChild(err);

      var acc = el('div', 'modal-acc');
      var cancelar = el('button', 'btn btn-linea', 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', cerrarModal);
      var guardar = el('button', 'btn btn-amarillo', 'Guardar');
      guardar.type = 'button';
      guardar.addEventListener('click', async function () {
        var nombre = inNombre.value.trim();
        if (!nombre) { err.hidden = false; err.textContent = 'Escribe el nombre del operador.'; return; }
        guardar.disabled = true;
        var cuerpo = {
          accion: 'operador_guardar', nombre: nombre,
          contacto: inContacto.value.trim() || undefined,
          telefono: inTel.value.trim() || undefined,
          notas: inNotas.value.trim() || undefined,
          activo: selActivo.value === 'si'
        };
        if (editando) cuerpo.id = operadorExistente.id;
        var res = await ejecutar(cuerpo, editando ? 'Operador actualizado.' : 'Operador "' + nombre + '" agregado.');
        guardar.disabled = false;
        if (res) cerrarModal();
      });
      acc.appendChild(cancelar);
      acc.appendChild(guardar);
      caja.appendChild(acc);
    });
  }

  function abrirModalOferta(operador, ofertaExistente) {
    abrirModal(function (caja) {
      var editando = !!ofertaExistente;
      var servicios = (estado.datos && estado.datos.catalogoServicios) || [];
      caja.appendChild(el('h2', 'modal-tit', editando ? 'Editar oferta' : 'Nueva oferta'));
      caja.appendChild(el('p', 'modal-sub', operador.nombre));

      var grid = el('div', 'form-grid');
      var selServicio = null;
      if (editando) {
        var s = servicios.filter(function (x) { return x.id === ofertaExistente.servicio_id; })[0];
        var servFijo = el('div', 'campo ancho');
        servFijo.appendChild(el('span', 'campo-lab', 'Servicio'));
        servFijo.appendChild(el('div', null, s ? s.nombre : ofertaExistente.servicio_id));
        grid.appendChild(servFijo);
      } else {
        var labServ = el('label', 'campo ancho');
        labServ.appendChild(el('span', 'campo-lab', 'Servicio'));
        selServicio = el('select', 'campo-in');
        servicios.forEach(function (s2) {
          var o = el('option', null, s2.nombre); o.value = s2.id; selServicio.appendChild(o);
        });
        labServ.appendChild(selServicio);
        grid.appendChild(labServ);
      }
      var inNa = campoTexto(grid, 'Neto adulto', 'number', editando ? String(ofertaExistente.neto_adulto) : '0');
      var inNm = campoTexto(grid, 'Neto menor (opcional)', 'number',
        (editando && ofertaExistente.neto_menor != null) ? String(ofertaExistente.neto_menor) : '');
      caja.appendChild(grid);

      var err = el('div', 'modal-error');
      err.hidden = true;
      caja.appendChild(err);

      var acc = el('div', 'modal-acc');
      var cancelar = el('button', 'btn btn-linea', 'Cancelar');
      cancelar.type = 'button';
      cancelar.addEventListener('click', cerrarModal);
      var guardar = el('button', 'btn btn-amarillo', 'Guardar');
      guardar.type = 'button';
      guardar.addEventListener('click', async function () {
        var servicioId = editando ? ofertaExistente.servicio_id : selServicio.value;
        if (!servicioId) { err.hidden = false; err.textContent = 'Elige un servicio.'; return; }
        var na = Number(inNa.value);
        if (!Number.isFinite(na) || na < 0) { err.hidden = false; err.textContent = 'El neto de adulto no es válido.'; return; }
        guardar.disabled = true;
        var res = await ejecutar({
          accion: 'oferta_guardar', operador_id: operador.id, servicio_id: servicioId,
          neto_adulto: na, neto_menor: inNm.value.trim() === '' ? null : Number(inNm.value)
        }, 'Oferta guardada.');
        guardar.disabled = false;
        if (res) cerrarModal();
      });
      acc.appendChild(cancelar);
      acc.appendChild(guardar);
      caja.appendChild(acc);
    });
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
    $('btnNuevaCotizacion').addEventListener('click', function () { abrirFormularioCotizacion(null); });
    $('btnNuevoServicio').addEventListener('click', function () { abrirModalServicio(null); });
    $('btnNuevoOperador').addEventListener('click', function () { abrirModalOperador(null); });
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
      if (estado.tokenAbierto || estado.cotAbierta) cerrarDrawer();
    });

    // Auto-refresco cada 60 s, sólo si la pestaña está visible y no hay
    // nada a medio escribir (editar / cerrar renta / formulario abierto).
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if ($('vistaApp').hidden) return;
      if (estado.editando || estado.cerrando || estado.modalAbierto) return;
      if (estado.cotVista === 'formulario') return;
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
