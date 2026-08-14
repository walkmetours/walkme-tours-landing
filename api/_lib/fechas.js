// Fechas de renta en zona America/Cancun (UTC-5 FIJO desde 2015, sin
// horario de verano — por eso podemos usar el offset constante).
// inicio/fin se calculan SIEMPRE en el servidor; el navegador solo manda
// fecha (YYYY-MM-DD) y hora (HH:MM).
//
// Regla de solape: intervalos semiabiertos [inicio, fin) — una renta de
// 10:00-12:00 y otra de 12:00-14:00 NO chocan (la bici se devuelve y se
// vuelve a entregar).

const OFFSET = '-05:00';
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^\d{2}:\d{2}$/;

// Instante UTC de una hora de pared en Cancún.
function instante(fecha, hora) {
  return new Date(fecha + 'T' + hora + ':00' + OFFSET);
}

// Suma un mes calendario a una fecha local, con clamp al último día del
// mes destino (31-ene → 28/29-feb; JS solo haría roll a marzo).
function masUnMes(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const y2 = m === 12 ? y + 1 : y;
  const m2 = m === 12 ? 1 : m + 1;
  const ultimoDia = new Date(Date.UTC(y2, m2, 0)).getUTCDate(); // día 0 del mes siguiente
  const d2 = Math.min(d, ultimoDia);
  return `${y2}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;
}

// Devuelve { inicio, fin } (objetos Date en UTC) o null si inválido.
function ventana(duracionId, fecha, hora) {
  if (!RE_FECHA.test(fecha || '') || !RE_HORA.test(hora || '')) return null;
  const HORA_MS = 3600 * 1000;

  switch (duracionId) {
    case '2h': {
      const inicio = instante(fecha, hora);
      return { inicio, fin: new Date(inicio.getTime() + 2 * HORA_MS) };
    }
    case 'dia':
      // El plan "Día" es SIEMPRE 10:00-19:00, sin importar la hora elegida
      // (coincide con el cupón: "Día · 10:00 a 19:00").
      return { inicio: instante(fecha, '10:00'), fin: instante(fecha, '19:00') };
    case '24h': {
      const inicio = instante(fecha, hora);
      return { inicio, fin: new Date(inicio.getTime() + 24 * HORA_MS) };
    }
    case 'semana': {
      const inicio = instante(fecha, hora);
      return { inicio, fin: new Date(inicio.getTime() + 7 * 24 * HORA_MS) };
    }
    case 'mes': {
      const inicio = instante(fecha, hora);
      return { inicio, fin: instante(masUnMes(fecha), hora) };
    }
    default:
      return null;
  }
}

// Hoy en Cancún como 'YYYY-MM-DD' (para validar "fecha desde hoy").
function hoyCancun() {
  const ahora = new Date(Date.now() - 5 * 3600 * 1000);
  return ahora.toISOString().slice(0, 10);
}

module.exports = { ventana, hoyCancun, masUnMes, instante, RE_FECHA, RE_HORA };
