/* ========================================
   WalkMe · Comportamiento del nav
   1) Toggle del botón hamburguesa (.nav-toggle) para mostrar/ocultar .nav-links
      en pantallas ≤900px. Se cierra al elegir un link.
   2) Nav transparente sobre el hero, sólido (.nav--solid) al hacer scroll,
      para que el logo quede integrado al fondo pero el menú siga siendo
      legible sobre el resto de la página.
   Vanilla, sin dependencias.
   ======================================== */
(function() {
  document.querySelectorAll('.nav-toggle').forEach(btn => {
    const nav = btn.closest('nav');
    const links = nav ? nav.querySelector('.nav-links') : null;
    if (!links) return;

    btn.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        links.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  });

  const nav = document.querySelector('nav');
  if (nav) {
    const THRESHOLD = 60;
    const updateNavBg = () => {
      nav.classList.toggle('nav--solid', window.scrollY > THRESHOLD);
    };
    updateNavBg();
    window.addEventListener('scroll', updateNavBg, { passive: true });
  }
})();
