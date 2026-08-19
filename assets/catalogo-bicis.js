// Catálogo de renta de bicis WalkMe — FUENTE ÚNICA de precios y depósito.
// Lo usan: el formulario (bikes.html), el cupón (cupon.html), el CRM y el
// backend (/api vía api/_lib/catalogo-bicis.js).
// ⚠ REGLA: si cambian los precios, cambiar AQUÍ y en los chips de
//   #precios de bikes.html/bikes-en.html en el mismo commit.
//   Los DOS montos de garantía (efectivo y tarjeta) ya salen de aquí en
//   todo el copy: no volver a teclearlos a mano en el HTML.
// UMD mínimo: module.exports en Node, window.WM_BICIS en el navegador.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WM_BICIS = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Idiomas del formulario de renta (diseño "Renta Bikes", 15-ago-26).
  // El cupón, los correos y el CRM siguen en es/en: un cliente que llena en
  // italiano ve su cupón en inglés. Decisión de María — traducir el resto
  // después, no bloquear el formulario por eso.
  const IDIOMAS = ['es', 'en', 'it', 'fr', 'pt'];
  // A qué idioma cae el cupón/correo cuando el cliente eligió uno que esos
  // todavía no hablan. Todo lo que no sea español cae a inglés.
  function idiomaCupon(lang) { return lang === 'es' ? 'es' : 'en'; }

  const CATALOGO = {
    version: '2026-08b',
    moneda: 'MXN',
    // Garantía, POR BICI. Dos modalidades y el cliente elige al reservar
    // (decisión de María, 19-ago-26):
    //   · efectivo → se cobra al recoger y se retiene una identificación
    //     oficial vigente durante la renta.
    //   · tarjeta  → retención (hold) en Stripe, no es un cobro; sube a
    //     $7,500 porque es lo que cuesta reponer una bici y no queda
    //     ningún documento en garantía.
    // Son constantes independientes a propósito: CARGOS.reposicion también
    // vale 7500 hoy, pero mover una no debe mover la otra sin querer.
    DEPOSITO_UNITARIO: 3000,
    DEPOSITO_TARJETA_UNITARIO: 7500,
    tipoBici: { id: 'ebike-u1', nombre: {
      es: 'E-bike WalkMe', en: 'WalkMe e-bike', it: 'E-bike WalkMe',
      fr: 'Vélo électrique WalkMe', pt: 'E-bike WalkMe' } },
    duraciones: [
      { id: '2h',     precio: 200,  nombre: { es: '2 horas',        en: '2 hours',
        it: '2 ore',           fr: '2 heures',           pt: '2 horas' } },
      { id: 'dia',    precio: 400,  nombre: { es: 'Día (10am-7pm)', en: 'Day (10am-7pm)',
        it: 'Giorno (10-19)',  fr: 'Journée (10h-19h)',  pt: 'Dia (10h-19h)' } },
      { id: '24h',    precio: 500,  nombre: { es: '24 horas',       en: '24 hours',
        it: '24 ore',          fr: '24 heures',          pt: '24 horas' } },
      { id: 'semana', precio: 1500, nombre: { es: 'Semana',         en: 'Week',
        it: 'Settimana',       fr: 'Semaine',            pt: 'Semana' } },
      { id: 'mes',    precio: 2500, nombre: { es: 'Mes',            en: 'Month',
        it: 'Mese',            fr: 'Mois',               pt: 'Mês' } }
    ],
    // Cargos por daño/extravío — FUENTE ÚNICA (confirmados con María, 17-ago-26).
    // Antes vivían duplicados a mano en bikes.html/bikes-en.html Y en assets/bikes.js,
    // desincronizados entre sí (bug real, corregido en este commit).
    CARGOS: {
      reposicion: 7500,
      retrasoHora: 200,
      accesorios: [
        { id: 'casco',    precio: 350,  nombre: { es: 'casco',           en: 'helmet',
          it: 'casco',            fr: 'casque',              pt: 'capacete' } },
        { id: 'candado',  precio: 400,  nombre: { es: 'candado',         en: 'lock',
          it: 'lucchetto',        fr: 'antivol',             pt: 'cadeado' } },
        { id: 'cargador', precio: 1500, nombre: { es: 'cargador',        en: 'charger',
          it: 'caricabatterie',   fr: 'chargeur',            pt: 'carregador' } },
        { id: 'canasta',  precio: 500,  nombre: { es: 'canasta',         en: 'basket',
          it: 'cestino',          fr: 'panier',              pt: 'cesta' } },
        { id: 'llanta',   precio: 300,  nombre: { es: 'llanta ponchada', en: 'flat tire',
          it: 'gomma bucata',     fr: 'pneu crevé',          pt: 'pneu furado' } },
        { id: 'llaves',   precio: 300,  nombre: { es: 'llaves perdidas', en: 'lost keys',
          it: 'chiavi perse',     fr: 'clés perdues',        pt: 'chaves perdidas' } }
      ]
    }
  };

  function duracion(id) {
    return CATALOGO.duraciones.find(function (d) { return d.id === id; }) || null;
  }

  // Total de la RENTA (sin garantía). Servidor siempre recalcula con esto;
  // el total que mande el navegador jamás se guarda.
  function calcularTotal(duracionId, cantidad) {
    const d = duracion(duracionId);
    const n = parseInt(cantidad, 10);
    if (!d || !Number.isFinite(n) || n < 1 || n > 12) return null;
    return {
      duracion: d,
      precioUnitario: d.precio,
      total: d.precio * n,
      depositoUnitario: CATALOGO.DEPOSITO_UNITARIO,
      depositoTotal: CATALOGO.DEPOSITO_UNITARIO * n,
      depositoTarjetaUnitario: CATALOGO.DEPOSITO_TARJETA_UNITARIO,
      depositoTarjetaTotal: CATALOGO.DEPOSITO_TARJETA_UNITARIO * n
    };
  }

  // Folio en pantalla: WB-5001. En la base es solo el entero (desde 5000).
  // WB- distingue bicis de tours (WM-) y se dicta fácil por teléfono.
  function folioLabel(folio) {
    return 'WB-' + folio;
  }

  function money(n) {
    return '$' + Number(n).toLocaleString('en-US') + ' MXN';
  }

  // Texto de accesorios en un idioma: "casco $350 · candado $400 · ...".
  function textoAccesorios(lang) {
    return CATALOGO.CARGOS.accesorios.map(function (a) {
      return a.nombre[lang] + ' $' + a.precio.toLocaleString('en-US');
    }).join(' · ');
  }

  return {
    CATALOGO: CATALOGO,
    DEPOSITO_UNITARIO: CATALOGO.DEPOSITO_UNITARIO,
    DEPOSITO_TARJETA_UNITARIO: CATALOGO.DEPOSITO_TARJETA_UNITARIO,
    IDIOMAS: IDIOMAS,
    idiomaCupon: idiomaCupon,
    duracion: duracion,
    calcularTotal: calcularTotal,
    folioLabel: folioLabel,
    money: money,
    textoAccesorios: textoAccesorios
  };
});
