// Re-export del catálogo compartido para /api.
// La fuente única vive en assets/catalogo-bicis.js (UMD); este archivo
// existe solo para que los requires del backend sean rutas cortas.
module.exports = require('../../assets/catalogo-bicis.js');
