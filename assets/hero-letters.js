(function () {
  var STEP_MS = 30;

  function splitLetters(el, startIndex, step) {
    var text = el.textContent;
    el.setAttribute('role', 'text');
    el.setAttribute('aria-label', text);
    el.textContent = '';
    var index = startIndex;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var span = document.createElement('span');
      span.setAttribute('aria-hidden', 'true');
      if (ch === ' ') {
        span.textContent = ' ';
        span.style.display = 'inline-block';
      } else {
        span.className = 'hl';
        span.textContent = ch;
        span.style.animationDelay = (index * step) + 'ms';
        span.addEventListener('animationend', function () {
          this.classList.add('settled');
        }, { once: true });
        index++;
      }
      el.appendChild(span);
    }
    return index;
  }

  document.querySelectorAll('.hero-title').forEach(function (title) {
    // Cadencia por titulo: la home camina mas lento que el flip por defecto
    var step = parseInt(title.getAttribute('data-step'), 10) || STEP_MS;
    var index = 0;

    // Titulos que marcan sus partes con [data-hl] (home): se parten en orden
    var marked = title.querySelectorAll('[data-hl]');
    if (marked.length) {
      marked.forEach(function (el) { index = splitLetters(el, index, step); });
      return;
    }

    // Patron original (resto de las paginas): .hero-pre + primer <em>
    var pre = title.querySelector('.hero-pre');
    var em = title.querySelector('em');
    if (pre) index = splitLetters(pre, index, step);
    if (em) splitLetters(em, index, step);
  });
})();
