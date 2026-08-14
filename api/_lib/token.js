// Token opaco para la URL del cupón: 16 chars, alfabeto sin ambigüedad
// (sin 0/O, 1/I/L). ~79 bits — inadivinable. El folio (5000, 5001…) es
// enumerable y NUNCA se usa como llave de URL; para eso está este token.
const crypto = require('crypto');
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const RE_TOKEN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$/;

function generarToken() {
  let t = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) t += ALFABETO[bytes[i] % ALFABETO.length];
  return t;
}

function esTokenValido(t) {
  return typeof t === 'string' && RE_TOKEN.test(t);
}

module.exports = { generarToken, esTokenValido };
