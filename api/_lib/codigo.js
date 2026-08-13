// Código de reserva legible por teléfono: WM-YYMMDD-XXXX
// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L).
const crypto = require('crypto');
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function generarCodigo(fecha) {
  const d = fecha ? new Date(fecha + 'T12:00:00Z') : new Date();
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  let suf = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) suf += ALFABETO[bytes[i] % ALFABETO.length];
  return `WM-${yy}${mm}${dd}-${suf}`;
}

module.exports = { generarCodigo };
