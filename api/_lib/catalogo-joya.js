// Catálogo de tarifas JOYÀ (Cirque du Soleil) + Jungala Aqua Experience.
// Tarifas públicas 2026 vigentes para funciones hasta el 24 de diciembre.
// Fuente: _ENTREGAS-walkme/Cirque Du Solei/circo-solei-la-joya-lista-de-porecios.jpg
// (verificado 1:1 contra el mockup de Claude Design).
//
// El total SIEMPRE se recalcula aquí desde este catálogo — nunca se confía
// en el precio que manda el cliente (mismo criterio que catalogo-bicis.js).

const TIERS = {
  'vip': {
    nombre: { es: 'VIP Show & Cena', en: 'VIP Show & Dinner' },
    seccion: { es: 'Sección VIP', en: 'VIP section' },
    adulto: 6900, nino: 4830
  },
  'show-cena': {
    nombre: { es: 'Show & Cena', en: 'Show & Dinner' },
    seccion: { es: 'Secciones 2 y 3', en: 'Sections 2 and 3' },
    adulto: 5140, nino: 3598
  },
  'celebration': {
    nombre: { es: 'Celebration', en: 'Celebration' },
    seccion: { es: 'Secciones 4 y 5', en: 'Sections 4 and 5' },
    adulto: 3760, nino: 2632
  },
  'elite': {
    nombre: { es: 'Elite Show', en: 'Elite Show' },
    seccion: { es: 'Secciones 6 y 7', en: 'Sections 6 and 7' },
    adulto: 2780, nino: 1946
  },
  'solo-central': {
    nombre: { es: 'Solo Show · Silla central', en: 'Show Only · Central chair' },
    seccion: { es: '8 y 9 sillas bajas · 4 a 7 altas centro', en: '8-9 low chairs · 4-7 high chairs center' },
    adulto: 2140, nino: 1070
  },
  'solo-lateral': {
    nombre: { es: 'Solo Show · Silla lateral', en: 'Show Only · Side chair' },
    seccion: { es: 'Secciones 8 y 9, filas L y M', en: 'Sections 8 and 9, rows L and M' },
    adulto: 1980, nino: 990
  },
  'jungala-daypass': {
    nombre: { es: 'Jungala · Daypass', en: 'Jungala · Daypass' },
    seccion: { es: 'Parque acuático Vidanta', en: 'Vidanta water park' },
    adulto: 1401, nino: 981
  },
  'jungala-beyond': {
    nombre: { es: 'Jungala · Beyond', en: 'Jungala · Beyond' },
    seccion: { es: 'Parque acuático Vidanta', en: 'Vidanta water park' },
    adulto: 1990, nino: 1392
  }
};

// Transporte: tarifa fija por persona (no depende del tier).
const TRANSPORTE = {
  'no': { label: { es: 'Sin transporte', en: 'No transport' }, tarifa: 0 },
  'pdc': { label: { es: 'Playa del Carmen', en: 'Playa del Carmen' }, tarifa: 500 },
  'riviera': { label: { es: 'Riviera Maya', en: 'Riviera Maya' }, tarifa: 700 },
  'cun': { label: { es: 'Cancún', en: 'Cancun' }, tarifa: 700 }
};

function calcularTotal(tierId, adultos, ninos, transporteId) {
  const tier = TIERS[tierId];
  if (!tier) return null;
  const trans = TRANSPORTE[transporteId] || TRANSPORTE.no;
  const pax = adultos + ninos;
  const subtotalBoletos = tier.adulto * adultos + tier.nino * ninos;
  const subtotalTransporte = trans.tarifa * pax;
  return {
    tier,
    transporte: trans,
    precioAdulto: tier.adulto,
    precioNino: tier.nino,
    subtotalBoletos,
    subtotalTransporte,
    total: subtotalBoletos + subtotalTransporte
  };
}

function folioLabel(folio) {
  return 'WJ-' + folio;
}

module.exports = { TIERS, TRANSPORTE, calcularTotal, folioLabel };
