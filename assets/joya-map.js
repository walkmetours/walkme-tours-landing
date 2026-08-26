/* ========================================
   JOYÀ · Cirque du Soleil — mapa de teatro
   Dibuja los 6 anillos del teatro como SVG estático; cada anillo es un
   link (#tier-N) al precio correspondiente en la grid de experiencias.
   Sin estado, sin selección: solo navegación por anclas.
   ======================================== */
(function () {
  var svg = document.getElementById('joya-map');
  if (!svg) return;

  var NS = 'http://www.w3.org/2000/svg';
  var cx = 250, cy = 64, a1 = 26, a2 = 154;
  var R = [58, 100, 140, 178, 214, 248, 282];
  var tiers = [
    { id: 0, color: '#D0021B' },
    { id: 1, color: '#16247A' },
    { id: 2, color: '#F5A623' },
    { id: 3, color: '#29B6D8' },
    { id: 4, color: '#E8397D' },
    { id: 5, color: '#3DBB1F' }
  ];

  function pt(r, deg) {
    var a = deg * Math.PI / 180;
    return [(cx + r * Math.cos(a)).toFixed(1), (cy + r * Math.sin(a)).toFixed(1)];
  }

  tiers.forEach(function (t) {
    var r1 = R[t.id], r2 = R[t.id + 1];
    var o1 = pt(r2, a1), o2 = pt(r2, a2), i2 = pt(r1, a2), i1 = pt(r1, a1);
    var d = 'M ' + o1[0] + ' ' + o1[1] +
      ' A ' + r2 + ' ' + r2 + ' 0 0 1 ' + o2[0] + ' ' + o2[1] +
      ' L ' + i2[0] + ' ' + i2[1] +
      ' A ' + r1 + ' ' + r1 + ' 0 0 0 ' + i1[0] + ' ' + i1[1] + ' Z';

    var a = document.createElementNS(NS, 'a');
    a.setAttribute('href', '#tier-' + t.id);
    a.setAttribute('aria-label', 'Ver tarifa de la sección');

    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', t.color + '2b');
    path.setAttribute('fill-opacity', '0.32');
    path.setAttribute('stroke', t.color);
    path.setAttribute('stroke-width', '1.4');

    a.appendChild(path);
    svg.appendChild(a);
  });

  var glow = document.createElementNS(NS, 'circle');
  glow.setAttribute('cx', cx); glow.setAttribute('cy', cy); glow.setAttribute('r', 60);
  glow.setAttribute('fill', 'rgba(242,222,74,0.12)');
  glow.setAttribute('class', 'jy-map-glow');
  svg.insertBefore(glow, svg.firstChild);

  var stage = document.createElementNS(NS, 'circle');
  stage.setAttribute('cx', cx); stage.setAttribute('cy', cy); stage.setAttribute('r', 44);
  stage.setAttribute('fill', '#F2DE4A');
  svg.appendChild(stage);

  var ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', 44);
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', '#08121c');
  ring.setAttribute('stroke-width', '2');
  ring.setAttribute('stroke-opacity', '0.3');
  svg.appendChild(ring);
})();
