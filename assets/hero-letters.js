(function () {
  var STEP_MS = 30;

  function splitLetters(el, startIndex) {
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
        span.textContent = ' ';
        span.style.display = 'inline-block';
      } else {
        span.className = 'hl';
        span.textContent = ch;
        span.style.animationDelay = (index * STEP_MS) + 'ms';
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
    var index = 0;
    var pre = title.querySelector('.hero-pre');
    var em = title.querySelector('em');
    if (pre) index = splitLetters(pre, index);
    if (em) splitLetters(em, index);
  });
})();
