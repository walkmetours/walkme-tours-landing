/* ========================================
   WalkMe · Canvas de firma táctil
   API global: WMFirma.init(canvas) → { isEmpty(), clear(), toDataURL() }
   - Eventos pointer (dedo, stylus, mouse), trazo suave.
   - Escala por devicePixelRatio para que el PNG no salga pixelado.
   ======================================== */
(function () {
  function init(canvas) {
    const ctx = canvas.getContext('2d');
    let trazos = 0;
    let dibujando = false;
    let ultimo = null;

    function ajustar() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0d2e1a';
    }
    ajustar();

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      dibujando = true;
      ultimo = pos(e);
    });
    canvas.addEventListener('pointermove', e => {
      if (!dibujando) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(ultimo.x, ultimo.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ultimo = p;
      trazos++;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
      canvas.addEventListener(ev, () => { dibujando = false; })
    );
    // El dedo no debe hacer scroll mientras firma
    canvas.style.touchAction = 'none';

    return {
      isEmpty: () => trazos < 8,
      clear: () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        trazos = 0;
      },
      toDataURL: () => canvas.toDataURL('image/png')
    };
  }
  window.WMFirma = { init };
})();
