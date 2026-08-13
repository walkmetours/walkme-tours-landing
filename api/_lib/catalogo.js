// Reexporta el catálogo compartido con el front.
// assets/catalogo.js es la ÚNICA fuente de precios del flujo de reserva.
const CATALOGO = require('../../assets/catalogo.js');

function tourPorId(id) {
  return CATALOGO.tours.find(t => t.id === id) || null;
}

// Total en servidor. Devuelve null si esa zona/combinación no es pagable en línea.
function calcularTotal(tourId, zona, adultos, menores) {
  const tour = tourPorId(tourId);
  if (!tour) return null;
  const precios = tour.precios[zona];
  if (!precios) return null;
  if (precios.menor === null && menores > 0) return null;
  return {
    tour,
    precioAdulto: precios.adulto,
    precioMenor: precios.menor,
    total: adultos * precios.adulto + menores * (precios.menor || 0)
  };
}

module.exports = { CATALOGO, tourPorId, calcularTotal };
