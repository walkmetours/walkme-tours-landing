/* Renta de bici WalkMe — lógica del formulario.
   Traducción de "Renta Bikes Escritorio.dc.html" + "Renta Bikes Movil.dc.html"
   (Claude Design) al stack estático del sitio. Los textos de T están copiados
   literales del dicts() y ex() de esos diseños.

   Qué NO cambia respecto al formulario anterior (regla de María: "no rompas el
   flujo que ya creamos para que se pase al CRM"):
     POST /api/bici/crear → folio WB-5xxx → redirección a cupon.html?t=<token>
   El servidor SIEMPRE recalcula el total desde el catálogo; lo que se manda
   desde aquí es informativo y jamás se guarda tal cual.

   Desviaciones deliberadas contra el diseño (decididas con María, 15-ago-26):
   · Sin autollenado: el diseño simulaba leer el pasaporte. Los campos van vacíos.
   · Se agregan CORREO (para mandar el cupón) y HORA DE INICIO (para calcular
     disponibilidad). El diseño no los tiene y el sistema los necesita.
   · Precios desde WM_BICIS, no los del diseño.
   · Al enviar se va al cupón, no a WhatsApp: el cupón ya trae su botón de
     WhatsApp y es la pieza que guarda el folio.                              */
(function () {
  'use strict';

  var IDIOMAS = window.WM_BICIS.IDIOMAS;          // ['es','en','it','fr','pt']
  var DEP = window.WM_BICIS.DEPOSITO_UNITARIO;    // 3000 por bici
  var DURACIONES = window.WM_BICIS.CATALOGO.duraciones;
  var WA = '525639748122';
  var MAX_BICIS = 10;

  // Montos desde el catálogo compartido (antes vivían hardcodeados aquí,
  // desincronizados con los de bikes.html — bug corregido 17-ago-26).
  var CARGOS = window.WM_BICIS.CATALOGO.CARGOS;
  var REPOSICION = CARGOS.reposicion, CARGO_RETRASO = CARGOS.retrasoHora;
  var ACC = {};
  IDIOMAS.forEach(function (l) { ACC[l] = window.WM_BICIS.textoAccesorios(l); });
  function n(x) { return Number(x).toLocaleString('en-US'); }

  function conds(l) {
    var d = n(DEP), r = n(REPOSICION), c = CARGO_RETRASO, a = ACC[l];
    return {
      es: ['Entiendo que WalkMe Bikes NO ofrece seguro médico ni de daños. Soy responsable de cualquier accidente o daño a mí o a terceros durante la renta.',
           'Dejaré un depósito en garantía de $' + d + ' MXN por bici — retención en tarjeta o efectivo — que se libera al devolverla sin daños ni faltantes.',
           'En caso de robo o pérdida total pagaré el valor de reposición de $' + r + ' MXN, además de cualquier daño parcial.',
           'Si pierdo un accesorio pagaré: ' + a + ' (MXN).',
           'Acepto un cargo de $' + c + ' MXN por cada hora de retraso en la devolución.',
           'Devolveré la bici y los accesorios en el mismo estado en que los recibí.'],
      en: ['I understand WalkMe Bikes does NOT provide medical or damage insurance. I am responsible for any accident or damage to myself or third parties during the rental.',
           'I will leave a security deposit of $' + d + ' MXN per bike — card hold or cash — released when the bike is returned with no damage or missing items.',
           'In case of theft or total loss I will pay the replacement value of $' + r + ' MXN, plus any partial damage.',
           'If I lose an accessory I will pay: ' + a + ' (MXN).',
           'I accept a late fee of $' + c + ' MXN per hour if I return the bike after the agreed time.',
           'I will return the bike and accessories in the same condition I received them.'],
      it: ['Capisco che WalkMe Bikes NON offre assicurazione medica né per danni. Sono responsabile di qualsiasi incidente o danno a me o a terzi durante il noleggio.',
           'Lascerò un deposito cauzionale di $' + d + ' MXN per bici — blocco su carta o contanti — rimborsato alla riconsegna senza danni né mancanze.',
           'In caso di furto o perdita totale pagherò il valore di sostituzione di $' + r + ' MXN, oltre a eventuali danni parziali.',
           'Se perdo un accessorio pagherò: ' + a + ' (MXN).',
           'Accetto un addebito di $' + c + ' MXN per ogni ora di ritardo nella riconsegna.',
           'Restituirò la bici e gli accessori nello stesso stato in cui li ho ricevuti.'],
      fr: ['Je comprends que WalkMe Bikes n’offre PAS d’assurance médicale ni dommages. Je suis responsable de tout accident ou dommage à moi-même ou à des tiers pendant la location.',
           'Je laisserai un dépôt de garantie de $' + d + ' MXN par vélo — empreinte bancaire ou espèces — remboursé à la restitution sans dommages ni manquants.',
           'En cas de vol ou perte totale, je paierai la valeur de remplacement de $' + r + ' MXN, plus tout dommage partiel.',
           'Si je perds un accessoire je paierai : ' + a + ' (MXN).',
           'J’accepte des frais de $' + c + ' MXN par heure de retard à la restitution.',
           'Je rendrai le vélo et les accessoires dans le même état que je les ai reçus.'],
      pt: ['Entendo que a WalkMe Bikes NÃO oferece seguro médico nem de danos. Sou responsável por qualquer acidente ou dano a mim ou a terceiros durante o aluguel.',
           'Deixarei um depósito caução de $' + d + ' MXN por bike — retenção no cartão ou dinheiro — devolvido na entrega sem danos nem faltas.',
           'Em caso de roubo ou perda total pagarei o valor de reposição de $' + r + ' MXN, além de danos parciais.',
           'Se perder um acessório pagarei: ' + a + ' (MXN).',
           'Aceito uma taxa de $' + c + ' MXN por hora de atraso na devolução.',
           'Devolverei a bike e os acessórios no mesmo estado em que recebi.']
    }[l];
  }

  var T = {
    es: { title:'Renta de Bici Eléctrica', sub:'Contrato digital · todo desde tu cel',
      docs:'Sube tus documentos', docsSub:'Foto de tu pasaporte o identificación. La de tu reserva de hotel es opcional, pero nos ayuda a tenerte ubicado.',
      fotoId:'Foto de tu pasaporte o ID', fotoRes:'Foto de tu reserva de hotel o Airbnb',
      subir:'Tomar foto o subir archivo', cambiar:'Cambiar', listo:'Listo ✓',
      quitarId:'Quitar foto de ID', quitarRes:'Quitar foto de reserva',
      fotoNota:'Tus documentos se guardan en privado. Solo los ven María y Gina.',
      revisa:'Tus datos', revisaSub:'Con estos datos hacemos tu contrato de renta.',
      nombre:'Nombre completo', pasaporte:'Pasaporte o ID', nac:'Nacionalidad',
      hotel:'Hotel o dirección en Playa', email:'Correo electrónico', tel:'Tu WhatsApp',
      opcional:'opcional', paraCupon:'aquí te llega tu cupón',
      renta:'Tu renta', fecha:'Fecha de inicio', hora:'Hora de inicio', bikes:'Bicis', plan:'Plan de renta',
      total:'Total renta', deposito:'Depósito en garantía',
      depNote:'Retención en efectivo al recoger. Se libera al devolver la bici sin daños ni faltantes.',
      incluye:'Incluye casco, candado y cargador', noIncluye:'No incluye seguro médico ni de daños',
      condiciones:'Condiciones — acepta cada punto',
      firma:'Firma', firmaHint:'Escribe tu nombre completo como firma',
      firmaAviso:'La firma tiene que ser igual a tu nombre completo.',
      idNote:'Presenta tu pasaporte o ID oficial al recoger la bici',
      faltan:'Completa tus datos y acepta todos los puntos', enviar:'Aceptar y reservar',
      enviando:'Enviando…', trasEnviar:'Al enviar recibes tu cupón con folio.' },
    en: { title:'E-Bike Rental', sub:'Digital agreement · all from your phone',
      docs:'Upload your documents', docsSub:'Photo of your passport or ID. The one of your hotel booking is optional, but helps us know where you are staying.',
      fotoId:'Photo of your passport or ID', fotoRes:'Photo of your hotel or Airbnb booking',
      subir:'Take photo or upload file', cambiar:'Change', listo:'Done ✓',
      quitarId:'Remove ID photo', quitarRes:'Remove booking photo',
      fotoNota:'Your documents are stored privately. Only María and Gina can see them.',
      revisa:'Your details', revisaSub:'We use these to prepare your rental agreement.',
      nombre:'Full name', pasaporte:'Passport or ID', nac:'Nationality',
      hotel:'Hotel or address in Playa', email:'Email', tel:'Your WhatsApp',
      opcional:'optional', paraCupon:'your voucher arrives here',
      renta:'Your rental', fecha:'Start date', hora:'Start time', bikes:'Bikes', plan:'Rental plan',
      total:'Rental total', deposito:'Security deposit',
      depNote:'Cash hold at pickup. Released when the bike is returned with no damage or missing items.',
      incluye:'Includes helmet, lock and charger', noIncluye:'No medical or damage insurance included',
      condiciones:'Conditions — accept each point',
      firma:'Signature', firmaHint:'Type your full name as your signature',
      firmaAviso:'The signature must match your full name.',
      idNote:'Show your passport or official ID when picking up the bike',
      faltan:'Fill in your details and accept every point', enviar:'Accept & book',
      enviando:'Sending…', trasEnviar:'You will get your voucher with its number.' },
    it: { title:'Noleggio E-Bike', sub:'Contratto digitale · tutto dal tuo cellulare',
      docs:'Carica i tuoi documenti', docsSub:'Foto del passaporto o documento. Quella della prenotazione è facoltativa, ma ci aiuta a sapere dove alloggi.',
      fotoId:'Foto del passaporto o documento', fotoRes:'Foto della prenotazione hotel o Airbnb',
      subir:'Scatta una foto o carica un file', cambiar:'Cambia', listo:'Fatto ✓',
      quitarId:'Rimuovi foto documento', quitarRes:'Rimuovi foto prenotazione',
      fotoNota:'I tuoi documenti restano privati. Li vedono solo María e Gina.',
      revisa:'I tuoi dati', revisaSub:'Con questi dati prepariamo il contratto di noleggio.',
      nombre:'Nome completo', pasaporte:'Passaporto o documento', nac:'Nazionalità',
      hotel:'Hotel o indirizzo a Playa', email:'Email', tel:'Il tuo WhatsApp',
      opcional:'facoltativo', paraCupon:'qui arriva il tuo voucher',
      renta:'Il tuo noleggio', fecha:'Data di inizio', hora:'Ora di inizio', bikes:'Bici', plan:'Piano di noleggio',
      total:'Totale noleggio', deposito:'Deposito cauzionale',
      depNote:'Deposito in contanti al ritiro. Rimborsato alla riconsegna senza danni né mancanze.',
      incluye:'Include casco, lucchetto e caricabatterie', noIncluye:'Non include assicurazione medica né per danni',
      condiciones:'Condizioni — accetta ogni punto',
      firma:'Firma', firmaHint:'Scrivi il tuo nome completo come firma',
      firmaAviso:'La firma deve essere uguale al tuo nome completo.',
      idNote:'Mostra il passaporto o un documento ufficiale al ritiro della bici',
      faltan:'Completa i tuoi dati e accetta tutti i punti', enviar:'Accetta e prenota',
      enviando:'Invio…', trasEnviar:'Riceverai il tuo voucher con il numero.' },
    fr: { title:'Location de Vélo Électrique', sub:'Contrat digital · tout depuis votre téléphone',
      docs:'Téléversez vos documents', docsSub:'Photo de votre pièce d’identité. Celle de votre réservation est facultative, mais nous aide à savoir où vous logez.',
      fotoId:'Photo de votre passeport ou pièce d’identité', fotoRes:'Photo de votre réservation d’hôtel ou Airbnb',
      subir:'Prendre une photo ou téléverser', cambiar:'Changer', listo:'Fait ✓',
      quitarId:'Retirer la photo d’identité', quitarRes:'Retirer la photo de réservation',
      fotoNota:'Vos documents restent privés. Seules María et Gina peuvent les voir.',
      revisa:'Vos informations', revisaSub:'Nous préparons votre contrat avec ces informations.',
      nombre:'Nom complet', pasaporte:'Passeport ou pièce d’identité', nac:'Nationalité',
      hotel:'Hôtel ou adresse à Playa', email:'E-mail', tel:'Votre WhatsApp',
      opcional:'facultatif', paraCupon:'votre bon arrive ici',
      renta:'Votre location', fecha:'Date de début', hora:'Heure de début', bikes:'Vélos', plan:'Formule',
      total:'Total location', deposito:'Dépôt de garantie',
      depNote:'Dépôt en espèces au retrait. Remboursé à la restitution sans dommages ni manquants.',
      incluye:'Casque, antivol et chargeur inclus', noIncluye:'Aucune assurance médicale ni dommages incluse',
      condiciones:'Conditions — acceptez chaque point',
      firma:'Signature', firmaHint:'Écrivez votre nom complet comme signature',
      firmaAviso:'La signature doit correspondre à votre nom complet.',
      idNote:'Présentez votre passeport ou pièce d’identité au retrait du vélo',
      faltan:'Complétez vos informations et acceptez tous les points', enviar:'Accepter et réserver',
      enviando:'Envoi…', trasEnviar:'Vous recevrez votre bon avec son numéro.' },
    pt: { title:'Aluguel de E-Bike', sub:'Contrato digital · tudo pelo seu celular',
      docs:'Envie seus documentos', docsSub:'Foto do seu passaporte ou documento. A da reserva é opcional, mas ajuda a saber onde você está hospedado.',
      fotoId:'Foto do seu passaporte ou documento', fotoRes:'Foto da sua reserva de hotel ou Airbnb',
      subir:'Tirar foto ou enviar arquivo', cambiar:'Trocar', listo:'Pronto ✓',
      quitarId:'Remover foto do documento', quitarRes:'Remover foto da reserva',
      fotoNota:'Seus documentos ficam privados. Só María e Gina veem.',
      revisa:'Seus dados', revisaSub:'Com estes dados preparamos seu contrato de aluguel.',
      nombre:'Nome completo', pasaporte:'Passaporte ou documento', nac:'Nacionalidade',
      hotel:'Hotel ou endereço em Playa', email:'E-mail', tel:'Seu WhatsApp',
      opcional:'opcional', paraCupon:'seu cupom chega aqui',
      renta:'Seu aluguel', fecha:'Data de início', hora:'Hora de início', bikes:'Bikes', plan:'Plano de aluguel',
      total:'Total do aluguel', deposito:'Depósito caução',
      depNote:'Retenção em dinheiro na retirada. Devolvido na entrega sem danos nem faltas.',
      incluye:'Inclui capacete, cadeado e carregador', noIncluye:'Não inclui seguro médico nem de danos',
      condiciones:'Condições — aceite cada ponto',
      firma:'Assinatura', firmaHint:'Escreva seu nome completo como assinatura',
      firmaAviso:'A assinatura precisa ser igual ao seu nome completo.',
      idNote:'Apresente seu passaporte ou documento oficial ao retirar a bike',
      faltan:'Preencha seus dados e aceite todos os pontos', enviar:'Aceitar e reservar',
      enviando:'Enviando…', trasEnviar:'Você vai receber seu cupom com o número.' }
  };

  var ERR = {
    es: { sin_disponibilidad:function(k){ return k > 0 ? 'Para ese horario solo quedan ' + k + ' bici' + (k===1?'':'s') + '. Cambia la cantidad, la fecha o la hora.' : 'Para ese horario ya no hay bicis. Prueba otra fecha u hora.'; },
      firma_no_coincide:'La firma debe coincidir con tu nombre completo.', email_invalido:'Revisa tu correo electrónico.',
      nombre_invalido:'Escribe tu nombre y tu apellido.', fecha_pasada:'Esa fecha ya pasó — elige hoy o una fecha futura.',
      demasiadas_reservas:'Demasiadas reservas seguidas. Espera un momento o escríbenos por WhatsApp.',
      foto_requerida:'Sube una foto de tu pasaporte o identificación.', foto_invalida:'No pudimos leer esa foto. Intenta con otra (JPG o PNG).',
      foto_reserva_invalida:'No pudimos leer la foto de tu reserva. Intenta con otra imagen o un PDF.',
      foto_muy_grande:'Esa foto pesa demasiado. Toma la foto de nuevo.',
      reservas_no_configuradas:'La reserva en línea aún no está activa. Escríbenos por WhatsApp y te apartamos tu bici.',
      generico:'No pudimos crear tu reserva. Inténtalo de nuevo o escríbenos por WhatsApp.', wa:'Abrir WhatsApp' },
    en: { sin_disponibilidad:function(k){ return k > 0 ? 'Only ' + k + ' bike' + (k===1?'':'s') + ' left for that slot. Change the amount, date or time.' : 'No bikes left for that slot. Try another date or time.'; },
      firma_no_coincide:'The signature must match your full name.', email_invalido:'Please check your email address.',
      nombre_invalido:'Please enter your first and last name.', fecha_pasada:'That date has passed — pick today or a future date.',
      demasiadas_reservas:'Too many bookings in a row. Wait a moment or message us on WhatsApp.',
      foto_requerida:'Upload a photo of your passport or ID.', foto_invalida:'We could not read that photo. Try another one (JPG or PNG).',
      foto_reserva_invalida:'We could not read your booking photo. Try another image or a PDF.',
      foto_muy_grande:'That photo is too large. Please take it again.',
      reservas_no_configuradas:'Online booking is not active yet. Message us on WhatsApp and we will hold your bike.',
      generico:'We could not create your booking. Try again or message us on WhatsApp.', wa:'Open WhatsApp' }
  };
  // it/fr/pt todavía no tienen mensajes de error propios: caen a inglés, igual
  // que el cupón y los correos. Traducirlos cuando se traduzca el resto.
  function err(lang) { return ERR[lang] || ERR.en; }

  // ── Estado ──
  var st = {
    lang: 'es', plan: 'dia', bikes: 1,
    checks: [false,false,false,false,false,false],
    fotoId: null, fotoRes: null,        // { dataUrl, url, esPdf }
    enviando: false
  };

  var $ = function (id) { return document.getElementById(id); };
  function money(v) { return window.WM_BICIS.money(v); }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function val(id) { return ($(id).value || '').trim(); }

  // ── Compresión de la foto en el navegador (igual que el formulario anterior:
  //    1600px de lado mayor, JPEG 75%). Los PDF se mandan tal cual.
  function comprimir(file) {
    return new Promise(function (resolve, reject) {
      if (/pdf/i.test(file.type)) {
        var fr = new FileReader();
        fr.onload = function () { resolve({ dataUrl: fr.result, url: null, esPdf: true }); };
        fr.onerror = reject;
        fr.readAsDataURL(file);
        return;
      }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var MAX = 1600, w = img.width, h = img.height;
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h >= w && h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: cv.toDataURL('image/jpeg', 0.75), url: url, esPdf: false });
      };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // ── Pintado ──
  function pintarIdiomas() {
    var box = $('rbLangs');
    box.textContent = '';
    IDIOMAS.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rb-lang';
      b.textContent = l.toUpperCase();
      b.setAttribute('aria-pressed', l === st.lang ? 'true' : 'false');
      b.setAttribute('lang', l);
      b.addEventListener('click', function () {
        st.lang = l;
        document.documentElement.lang = l;
        pintar();
      });
      box.appendChild(b);
    });
  }

  function pintarPlanes() {
    var t = T[st.lang], box = $('rbPlanes');
    box.textContent = '';
    DURACIONES.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rb-plan';
      b.setAttribute('aria-pressed', d.id === st.plan ? 'true' : 'false');
      var nom = document.createElement('span');
      nom.textContent = d.nombre[st.lang] || d.nombre.es;
      var pre = document.createElement('span');
      pre.className = 'precio';
      pre.textContent = money(d.precio);
      b.appendChild(nom); b.appendChild(pre);
      b.addEventListener('click', function () { st.plan = d.id; pintar(); });
      box.appendChild(b);
    });
    void t;
  }

  function pintarCondiciones() {
    var textos = conds(st.lang), box = $('rbConds');
    box.textContent = '';
    textos.forEach(function (texto, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rb-cond';
      b.setAttribute('aria-pressed', st.checks[i] ? 'true' : 'false');
      var caja = document.createElement('span');
      caja.className = 'rb-cond-box';
      caja.textContent = st.checks[i] ? '✓' : '';
      var txt = document.createElement('span');
      txt.className = 'rb-cond-text';
      txt.textContent = texto;
      b.appendChild(caja); b.appendChild(txt);
      b.addEventListener('click', function () { st.checks[i] = !st.checks[i]; pintar(); });
      box.appendChild(b);
    });
  }

  function pintarTile(cual) {
    var t = T[st.lang];
    var f = st[cual];
    var tile = $(cual === 'fotoId' ? 'rbTileId' : 'rbTileRes');
    var estado = $(cual === 'fotoId' ? 'rbTileIdState' : 'rbTileResState');
    var icono = $(cual === 'fotoId' ? 'rbTileIdIcon' : 'rbTileResIcon');
    var base = cual === 'fotoId' ? '🪪' : '🏨';
    tile.className = 'rb-tile' + (f ? ' listo' : '');
    icono.textContent = f ? '✓' : base;
    estado.textContent = f ? t.listo : t.subir;
    if (f && f.url) {
      tile.classList.add('con-foto');
      tile.style.backgroundImage = 'url(' + f.url + ')';
    } else {
      tile.classList.remove('con-foto');
      tile.style.backgroundImage = '';
    }
  }

  function pintarQuitar() {
    var t = T[st.lang], box = $('rbQuitar');
    box.textContent = '';
    [['fotoId', t.quitarId], ['fotoRes', t.quitarRes]].forEach(function (par) {
      if (!st[par[0]]) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = '✕ ' + par[1];
      b.addEventListener('click', function () {
        if (st[par[0]] && st[par[0]].url) URL.revokeObjectURL(st[par[0]].url);
        st[par[0]] = null;
        $(par[0] === 'fotoId' ? 'rbFileId' : 'rbFileRes').value = '';
        pintar();
      });
      box.appendChild(b);
    });
    box.style.display = box.children.length ? '' : 'none';
  }

  // Qué falta para poder enviar. Devuelve true si está todo.
  function completo() {
    var nombre = val('rbNombre');
    return !!(nombre && nombre.split(/\s+/).length >= 2
      && val('rbEmail') && val('rbDocumento') && val('rbFecha') && val('rbHora')
      && val('rbFirma') && norm(val('rbFirma')) === norm(nombre)
      && st.fotoId && st.checks.every(Boolean));
  }

  function pintar() {
    var t = T[st.lang];
    document.title = t.title + ' · WalkMe Tours';
    $('rbTitle').textContent = t.title;
    $('rbSub').textContent = t.sub;

    $('rbDocsH').textContent = '1 · ' + t.docs;
    $('rbDocsSub').textContent = t.docsSub;
    $('rbTileIdLabel').textContent = t.fotoId;
    $('rbTileResLabel').textContent = t.fotoRes;
    $('rbFotoNota').textContent = t.fotoNota;

    $('rbDatosH').textContent = '2 · ' + t.revisa;
    $('rbDatosSub').textContent = t.revisaSub;
    $('rbLblNombre').textContent = t.nombre;
    $('rbLblDocumento').textContent = t.pasaporte;
    $('rbLblNac').textContent = t.nac;
    $('rbLblHotel').textContent = t.hotel;
    $('rbLblEmail').textContent = t.email;
    $('rbLblTel').textContent = t.tel;
    $('rbTagEmail').textContent = t.paraCupon;
    $('rbTagNac').textContent = t.opcional;
    $('rbTagHotel').textContent = t.opcional;
    $('rbTagTel').textContent = t.opcional;

    $('rbRentaH').textContent = '3 · ' + t.renta;
    $('rbLblFecha').textContent = t.fecha;
    $('rbLblHora').textContent = t.hora;
    $('rbLblBikes').textContent = t.bikes;
    $('rbLblPlan').textContent = t.plan;
    $('rbCondsH').textContent = '4 · ' + t.condiciones;
    $('rbResumenH').textContent = t.renta;
    $('rbFirmaH').textContent = '5 · ' + t.firma;
    $('rbLblFirma').textContent = t.firmaHint;
    $('rbIdNote').textContent = t.idNote + ' · ' + new Date().toLocaleDateString(st.lang, { day: 'numeric', month: 'long', year: 'numeric' });

    pintarIdiomas();
    pintarPlanes();
    pintarCondiciones();
    pintarTile('fotoId');
    pintarTile('fotoRes');
    pintarQuitar();

    // Contador de bicis
    $('rbBikes').textContent = st.bikes;
    $('rbMenos').disabled = st.bikes <= 1;
    $('rbMas').disabled = st.bikes >= MAX_BICIS;

    // Resumen. El servidor recalcula esto igual; aquí es solo para que el
    // cliente vea cuánto va antes de enviar.
    var calc = window.WM_BICIS.calcularTotal(st.plan, st.bikes);
    $('rbLblTotal').textContent = t.total;
    $('rbLblDeposito').textContent = t.deposito;
    $('rbTotal').textContent = calc ? money(calc.total) : '—';
    $('rbDeposito').textContent = calc ? money(calc.depositoTotal) : '—';
    $('rbDepNote').textContent = t.depNote;
    $('rbIncluye').textContent = '✔ ' + t.incluye;
    $('rbNoIncluye').textContent = '✖ ' + t.noIncluye;

    // Aviso de firma: solo cuando ya escribió algo y no coincide.
    var firma = val('rbFirma'), nombre = val('rbNombre');
    var malaFirma = !!(firma && nombre && norm(firma) !== norm(nombre));
    $('rbFirmaAviso').textContent = malaFirma ? t.firmaAviso : '';
    $('rbFirmaAviso').style.display = malaFirma ? '' : 'none';

    var listo = completo();
    $('rbFalta').textContent = listo ? '' : '⚠ ' + t.faltan;
    $('rbFalta').style.display = listo ? 'none' : '';
    var btn = $('rbEnviar');
    btn.textContent = st.enviando ? t.enviando : t.enviar + ' →';
    btn.className = 'rb-enviar' + (listo && !st.enviando ? ' listo' : '');
    btn.disabled = !listo || st.enviando;
    $('rbTrasEnviar').textContent = t.trasEnviar;
  }

  function mostrarError(codigo, disponibles) {
    var e = err(st.lang);
    var msg = e[codigo];
    if (typeof msg === 'function') msg = msg(disponibles || 0);
    if (!msg) msg = e.generico;
    var box = $('rbError');
    box.textContent = msg + ' ';
    var a = document.createElement('a');
    a.href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent('Hola WalkMe Bikes 🚲');
    a.target = '_blank'; a.rel = 'noopener';
    a.textContent = e.wa;
    box.appendChild(a);
    box.classList.add('visible');
    box.scrollIntoView({ block: 'nearest' });
  }

  async function enviar() {
    if (st.enviando || !completo()) return;
    st.enviando = true; pintar();
    $('rbError').classList.remove('visible');
    try {
      var r = await fetch('/api/bici/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idioma: st.lang,
          duracionId: st.plan,
          fecha: val('rbFecha'),
          hora: val('rbHora'),
          cantidad: st.bikes,
          nombre: val('rbNombre'),
          email: val('rbEmail'),
          telefono: val('rbTel'),
          nacionalidad: val('rbNac'),
          documento: val('rbDocumento'),
          hotel: val('rbHotel'),
          firma: val('rbFirma'),
          aceptaTerminos: st.checks.every(Boolean),
          foto: st.fotoId ? st.fotoId.dataUrl : null,
          fotoReserva: st.fotoRes ? st.fotoRes.dataUrl : null,
          hp: $('rbHp').value
        })
      });
      var data = await r.json();
      if (!r.ok) { mostrarError(data.error, data.disponibles); st.enviando = false; pintar(); return; }
      // Mismo destino de siempre: el cupón con folio. Desde ahí se paga y
      // se abre WhatsApp.
      location.href = 'cupon.html?t=' + encodeURIComponent(data.token);
    } catch (x) {
      mostrarError('generico');
      st.enviando = false; pintar();
    }
  }

  function init() {
    // Idioma inicial: el del navegador si lo hablamos, si no español.
    var nav = (navigator.language || 'es').slice(0, 2).toLowerCase();
    if (IDIOMAS.indexOf(nav) >= 0) st.lang = nav;
    document.documentElement.lang = st.lang;

    $('rbFecha').min = new Date().toISOString().slice(0, 10);

    ['rbNombre','rbEmail','rbTel','rbNac','rbDocumento','rbHotel','rbFecha','rbHora','rbFirma']
      .forEach(function (id) {
        $(id).addEventListener('input', pintar);
        $(id).addEventListener('change', pintar);
      });

    $('rbMenos').addEventListener('click', function () { if (st.bikes > 1) { st.bikes--; pintar(); } });
    $('rbMas').addEventListener('click', function () { if (st.bikes < MAX_BICIS) { st.bikes++; pintar(); } });

    [['rbFileId','fotoId'], ['rbFileRes','fotoRes']].forEach(function (par) {
      $(par[0]).addEventListener('change', async function () {
        var file = this.files && this.files[0];
        if (st[par[1]] && st[par[1]].url) URL.revokeObjectURL(st[par[1]].url);
        st[par[1]] = null;
        if (file) {
          try { st[par[1]] = await comprimir(file); }
          catch (e) { st[par[1]] = null; mostrarError('foto_invalida'); }
        }
        pintar();
      });
    });

    $('rbForm').addEventListener('submit', function (e) { e.preventDefault(); enviar(); });
    pintar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
