/* ========================================
   WalkMe · Catálogo de tours reservables en línea
   - ÚNICA fuente de precios para el flujo de reserva:
     la usan assets/reserva.js (front) y /api (backend, vía require).
   - Sembrado desde los data-* de tours.html / xcaret.html
     (contrato Cabo Safe 2026). Si cambian los precios en las
     fichas, hay que actualizarlos TAMBIÉN aquí.
   - precios: pdc = Playa del Carmen (base, siempre existe),
     rm = Riviera Maya, cun = Cancún. null = esa zona requiere
     cotización personalizada. menor null = precio por confirmar.
   ======================================== */
(function (root, factory) {
  const CATALOGO = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = CATALOGO;
  else root.WM_CATALOGO = CATALOGO;
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    version: '2026-08-12',
    moneda: 'MXN',
    tours: [
      /* ---- Grupo Xcaret ---- */
      { id: 'xcaret-basico',  grupo: 'xcaret', nombre: { es: 'Xcaret Básico',  en: 'Xcaret Basic' },
        precios: { pdc: { adulto: 3423, menor: 2567 }, rm: { adulto: 3608, menor: 2706 }, cun: { adulto: 3608, menor: 2706 } } },
      { id: 'xcaret-plus',    grupo: 'xcaret', nombre: { es: 'Xcaret Plus',    en: 'Xcaret Plus' },
        precios: { pdc: { adulto: 3904, menor: 2928 }, rm: { adulto: 4163, menor: 3122 }, cun: { adulto: 4163, menor: 3122 } } },
      { id: 'xcaret-noche',   grupo: 'xcaret', nombre: { es: 'Xcaret de Noche', en: 'Xcaret at Night' },
        precios: { pdc: { adulto: 2683, menor: 2012 }, rm: { adulto: 2868, menor: 2151 }, cun: { adulto: 2868, menor: 2151 } } },
      { id: 'xelha',          grupo: 'xcaret', nombre: { es: 'Xel-Há All Inclusive', en: 'Xel-Há All Inclusive' },
        precios: { pdc: { adulto: 3238, menor: 2428 }, rm: null, cun: null } },
      { id: 'xplor',          grupo: 'xcaret', nombre: { es: 'Xplor', en: 'Xplor' },
        precios: { pdc: { adulto: 3608, menor: 2706 }, rm: { adulto: 3793, menor: 2844 }, cun: { adulto: 3793, menor: 2844 } } },
      { id: 'xplor-fuego',    grupo: 'xcaret', nombre: { es: 'Xplor Fuego', en: 'Xplor Fuego' },
        precios: { pdc: { adulto: 3053, menor: 2289 }, rm: { adulto: 3238, menor: 2428 }, cun: { adulto: 3238, menor: 2428 } } },
      { id: 'xenses',         grupo: 'xcaret', nombre: { es: 'Xenses', en: 'Xenses' },
        precios: { pdc: { adulto: 2128, menor: 1596 }, rm: { adulto: 2313, menor: 1734 }, cun: { adulto: 2313, menor: 1734 } } },
      { id: 'xoximilco',      grupo: 'xcaret', nombre: { es: 'Xoximilco', en: 'Xoximilco' },
        precios: { pdc: { adulto: 2868, menor: 2151 }, rm: { adulto: 2868, menor: 2151 }, cun: { adulto: 2683, menor: 2012 } } },
      { id: 'xenotes',        grupo: 'xcaret', nombre: { es: 'Tour Xenotes', en: 'Xenotes Tour' },
        precios: { pdc: { adulto: 2942, menor: 2206 }, rm: null, cun: null } },
      { id: 'xichen-deluxe',  grupo: 'xcaret', nombre: { es: 'Xichén Itzá Deluxe', en: 'Xichén Itzá Deluxe' },
        precios: { pdc: { adulto: 3423, menor: 2567 }, rm: null, cun: null } },
      { id: 'xichen-clasico', grupo: 'xcaret', nombre: { es: 'Xichén Itzá Clásico', en: 'Xichén Itzá Classic' },
        precios: { pdc: { adulto: 3053, menor: 2289 }, rm: null, cun: null } },
      { id: 'xailing-prime',  grupo: 'xcaret', nombre: { es: 'Catamarán Xailing Prime · Isla Mujeres', en: 'Xailing Prime Catamaran · Isla Mujeres' },
        precios: { pdc: { adulto: 3127, menor: 2345 }, rm: { adulto: 3127, menor: 2345 }, cun: { adulto: 2942, menor: 2206 } } },
      { id: 'xailing-light',  grupo: 'xcaret', nombre: { es: 'Catamarán Xailing Light · Isla Mujeres', en: 'Xailing Light Catamaran · Isla Mujeres' },
        precios: { pdc: { adulto: 2387, menor: 1790 }, rm: { adulto: 2387, menor: 1790 }, cun: { adulto: 2202, menor: 1651 } } },
      { id: 'atv-doble',      grupo: 'xcaret', nombre: { es: 'ATV Xperience Doble', en: 'ATV Xperience Double' },
        precios: { pdc: { adulto: 1832, menor: null }, rm: null, cun: null } },
      { id: 'atv-sencilla',   grupo: 'xcaret', nombre: { es: 'ATV Xperience Sencilla', en: 'ATV Xperience Single' },
        precios: { pdc: { adulto: 2202, menor: null }, rm: null, cun: null } },

      /* ---- Tours Riviera Maya ---- */
      { id: 'whale-shark',    grupo: 'tours', nombre: { es: 'Whale Shark Discovery', en: 'Whale Shark Discovery' },
        precios: { pdc: { adulto: 4052, menor: 3496 }, rm: null, cun: null },
        nota: { es: 'Temporada 1 jun – 17 sep. No incluye impuesto de muelle: $25 USD por persona, en efectivo al abordar.',
                en: 'Season Jun 1 – Sep 17. Dock tax not included: $25 USD per person, cash when boarding.' } },
      { id: 'tulum-cenote',   grupo: 'tours', nombre: { es: 'Tulum & Cenote', en: 'Tulum & Cenote' },
        precios: { pdc: { adulto: 2016, menor: 1646 }, rm: { adulto: 2016, menor: 1646 }, cun: null } },
      { id: 'chichen-clasico', grupo: 'tours', nombre: { es: 'Chichén Itzá Clásico', en: 'Chichén Itzá Classic' },
        precios: { pdc: { adulto: 2498, menor: 1572 }, rm: { adulto: 2498, menor: 1572 }, cun: null } },
      { id: 'snorkel-discovery', grupo: 'tours', nombre: { es: 'Snorkel Discovery', en: 'Snorkel Discovery' },
        precios: { pdc: { adulto: 1832, menor: 1462 }, rm: { adulto: 1832, menor: 1462 }, cun: { adulto: 2016, menor: 1646 } } },
      { id: 'tulum-akumal-cenote', grupo: 'tours', nombre: { es: 'Tulum, Akumal & Cenote', en: 'Tulum, Akumal & Cenote' },
        precios: { pdc: { adulto: 2572, menor: 2202 }, rm: { adulto: 2572, menor: 2202 }, cun: { adulto: 2756, menor: 2386 } } },
      { id: 'paradise-island', grupo: 'tours', nombre: { es: 'Paradise Island', en: 'Paradise Island' },
        precios: { pdc: { adulto: 3126, menor: 2942 }, rm: { adulto: 3126, menor: 2942 }, cun: { adulto: 3126, menor: 2942 } } },
      { id: 'full-adventure', grupo: 'tours', nombre: { es: 'Full Adventure Discovery', en: 'Full Adventure Discovery' },
        precios: { pdc: { adulto: 2386, menor: 2016 }, rm: { adulto: 2386, menor: 2016 }, cun: { adulto: 2572, menor: 2202 } } }
    ]
  };
});
