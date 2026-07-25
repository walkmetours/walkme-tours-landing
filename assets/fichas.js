/* ========================================
   WalkMe · Fichas ampliadas (Xcaret)
   - Badge .t-play[data-detail] sobre la foto abre un modal de detalle
   - Clona el bloque .t-detail oculto correspondiente dentro del shell
   - El <video preload="none"> NO descarga hasta que el usuario da play
   - Al cerrar se vacía el shell: se quita el <video> y se detiene la descarga
   - No toca el cotizador (contrato .t-card[data-quote] intacto)
   - Bilingüe: lee document.documentElement.lang
   ======================================== */
(function () {
  const HTML = document.documentElement;
  const lang = (HTML.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const T = {
    es: { close: 'Cerrar' },
    en: { close: 'Close' }
  }[lang];

  const badges = document.querySelectorAll('.t-play[data-detail]');
  if (!badges.length) return;

  // ---- Shell del modal (una sola vez) ----
  const modal = document.createElement('div');
  modal.className = 'tmodal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML =
    '<div class="tmodal-bg" data-close></div>' +
    '<div class="tmodal-box" role="dialog" aria-modal="true" tabindex="-1">' +
      '<button class="tmodal-close" type="button" data-close aria-label="' + T.close + '">×</button>' +
      '<div class="tmodal-content"></div>' +
    '</div>';
  document.body.appendChild(modal);

  const box = modal.querySelector('.tmodal-box');
  const content = modal.querySelector('.tmodal-content');
  let lastFocus = null;

  function openDetail(detail) {
    content.innerHTML = '';
    const node = detail.cloneNode(true);
    node.removeAttribute('id');
    node.hidden = false;
    content.appendChild(node);

    // Etiqueta accesible del diálogo = nombre de la experiencia
    const nameEl = node.querySelector('.t-detail-name');
    if (nameEl) box.setAttribute('aria-label', nameEl.textContent.trim());

    wireVideo(node);

    lastFocus = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    box.scrollTop = 0;
    box.focus();
  }

  function closeDetail() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    content.innerHTML = ''; // quita el <video> del DOM => detiene descarga/reproducción
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  // El video solo se carga cuando el usuario da play
  function wireVideo(scope) {
    const wrap = scope.querySelector('.t-detail-video');
    if (!wrap) return;
    const video = wrap.querySelector('video');
    const playBtn = wrap.querySelector('.t-detail-play');
    if (!video || !playBtn) return;
    playBtn.addEventListener('click', function () {
      video.setAttribute('controls', '');
      wrap.classList.add('playing');
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    });
  }

  badges.forEach(function (badge) {
    badge.addEventListener('click', function (e) {
      e.preventDefault();
      const detail = document.getElementById(badge.dataset.detail);
      if (detail) openDetail(detail);
    });
  });

  modal.querySelectorAll('[data-close]').forEach(function (el) {
    el.addEventListener('click', closeDetail);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeDetail();
  });
})();
