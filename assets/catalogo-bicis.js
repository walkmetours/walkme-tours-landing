// Catálogo de renta de bicis WalkMe — FUENTE ÚNICA de precios y depósito.
// Lo usan: el formulario (bikes.html), el cupón (cupon.html), el CRM y el
// backend (/api vía api/_lib/catalogo-bicis.js).
// ⚠ REGLA: si cambian los precios, cambiar AQUÍ y en los chips de
//   #precios de bikes.html/bikes-en.html en el mismo commit.
// UMD mínimo: module.exports en Node, window.WM_BICIS en el navegador.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WM_BICIS = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const CATALOGO = {
    version: '2026-08',
    moneda: 'MXN',
    // Garantía en efectivo al recoger, POR BICI (decisión de María, 14-ago-26).
    DEPOSITO_UNITARIO: 3000,
    tipoBici: { id: 'ebike-u1', nombre: { es: 'E-bike WalkMe', en: 'WalkMe e-bike' } },
    duraciones: [
      { id: '2h',     precio: 200,  nombre: { es: '2 horas',        en: '2 hours' } },
      { id: 'dia',    precio: 400,  nombre: { es: 'Día (10am-7pm)', en: 'Day (10am-7pm)' } },
      { id: '24h',    precio: 500,  nombre: { es: '24 horas',       en: '24 hours' } },
      { id: 'semana', precio: 1500, nombre: { es: 'Semana',         en: 'Week' } },
      { id: 'mes',    precio: 2500, nombre: { es: 'Mes',            en: 'Month' } }
    ]
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
      depositoTotal: CATALOGO.DEPOSITO_UNITARIO * n
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

  return {
    CATALOGO: CATALOGO,
    DEPOSITO_UNITARIO: CATALOGO.DEPOSITO_UNITARIO,
    duracion: duracion,
    calcularTotal: calcularTotal,
    folioLabel: folioLabel,
    money: money
  };
});
