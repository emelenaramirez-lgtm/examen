(() => {
  const { $, showScreen, showModal, hideModal, setLoading, setSyncStatus, clearEl } = UI;

  /* ---------------- Estado global ---------------- */
  const state = {
    config: {},
    alumnos: [],
    preguntas: [],
    opciones: [],   // agrupadas por id_pregunta
    intento: null,  // intento en curso
    ordenPreguntas: [],
    indice: 0,
    bloqueados: new Set()
  };

  /* ---------------- Utilidades de mezcla ---------------- */
  function seedFromAlumno(alumnoId, examenId) {
    const s = String(alumnoId) + '_' + String(examenId);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffleSeeded(arr, seed) {
    const rand = mulberry32(seed);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------- Carga de datos ---------------- */
  async function cargarDatosDesdeServidor() {
    const data = await API.getData();
    Timer.setServerTime(data.serverTime);

    // Persistir en IndexedDB
    await DB.clear('config');
    await DB.clear('alumnos');
    await DB.clear('preguntas');
    await DB.clear('opciones');

    const configArr = Object.keys(data.config).map(k => ({ clave: k, valor: data.config[k] }));
    await DB.bulkPut('config', configArr);

    const alumnos = (data.alumnos || [])
      .filter(a => String(a.activo).toUpperCase() === 'SI')
      .map(a => ({ id: String(a.id), nombre: String(a.nombre) }));
    await DB.bulkPut('alumnos', alumnos);

    const preguntas = (data.preguntas || [])
      .filter(p => String(p.activo).toUpperCase() === 'SI')
      .map(p => ({
        id: String(p.id),
        examen_id: String(p.examen_id),
        enunciado: String(p.enunciado || ''),
        tipo: String(p.tipo || 'unica'),
        puntaje: parseFloat(p.puntaje || 1),
        explicacion: String(p.explicacion || '')
      }));
    await DB.bulkPut('preguntas', preguntas);

    const opciones = (data.opciones || []).map(o => ({
      id: String(o.id_pregunta) + '_' + String(o.letra),
      id_pregunta: String(o.id_pregunta),
      letra: String(o.letra),
      texto: String(o.texto || '')
    }));
    await DB.bulkPut('opciones', opciones);

    await DB.put('meta', { key: 'last_sync', value: new Date().toISOString() });
  }

  async function cargarDatosDesdeCache() {
    const cfgArr = await DB.all('config');
    const cfg = {};
    cfgArr.forEach(c => cfg[c.clave] = c.valor);
    state.config = cfg;

    state.alumnos = await DB.all('alumnos');
    state.preguntas = await DB.all('preguntas');
    state.opciones = await DB.all('opciones');

    const bloqueados = await DB.all('bloqueados');
    state.bloqueados = new Set(bloqueados.map(b => b.key));
  }

  async function sincronizarPendientes(clave) {
    const intentos = await DB.all('intentos');
    const pendientes = intentos.filter(i => i.estado === 'pendiente');
    if (pendientes.length === 0) return { enviados: 0, fallidos: 0 };

    let enviados = 0, fallidos = 0;
    for (const it of pendientes) {
      try {
        const payload = {
          intento_id: it.intento_id,
          alumno_id: it.alumno_id,
          alumno_nombre: it.alumno_nombre,
          examen_id: it.examen_id,
          duracion_seg: it.duracion_seg,
          respuestas: it.respuestas
        };
        const res = await API.saveIntento(payload);
        if (res.ok) {
          it.estado = 'enviado';
          it.enviado_en = new Date().toISOString();
          await DB.put('intentos', it);
          enviados++;
        } else {
          fallidos++;
        }
      } catch (e) {
        fallidos++;
      }
    }
    return { enviados, fallidos };
  }

  async function actualizarEstadoSync() {
    const intentos = await DB.all('intentos');
    const pend = intentos.filter(i => i.estado === 'pendiente').length;
    const last = await DB.get('meta', 'last_sync');
    const txt = pend === 0
      ? `Todo sincronizado (${last ? new Date(last.value).toLocaleString() : 'nunca'})`
      : `${pend} intento(s) pendiente(s) de enviar`;
    setSyncStatus(txt);
    return { pend, txt };
  }

  /* ---------------- Flujo: home ---------------- */
  async function refrescarHome() {
    const cfg = state.config;
    $('home-institucion').textContent = cfg.nombre_institucion || 'Institución';
    if (cfg.logo_url) {
      $('home-logo').src = cfg.logo_url;
      $('home-logo').style.display = '';
    } else {
      $('home-logo').style.display = 'none';
    }
    await actualizarEstadoSync();
  }

  /* ---------------- Flujo: selección de alumno ---------------- */
  function renderListaAlumnos(filtro) {
    const ul = $('lista-alumnos');
    clearEl(ul);
    const q = (filtro || '').trim().toLowerCase();
    const examenId = String(state.config.examen_id || '1');

    state.alumnos
      .filter(a => !q || a.nombre.toLowerCase().includes(q))
      .forEach(a => {
        const li = document.createElement('li');
        const key = a.id + '_' + examenId;
        const estaBloqueado = state.bloqueados.has(key);
        if (estaBloqueado) li.classList.add('bloqueado');
        li.textContent = a.nombre + (estaBloqueado ? '  (ya rendido)' : '');
        li.dataset.id = a.id;
        li.dataset.bloqueado = estaBloqueado ? '1' : '0';
        li.addEventListener('click', () => {
          if (estaBloqueado) return;
          document.querySelectorAll('#lista-alumnos li').forEach(x => x.classList.remove('seleccionado'));
          li.classList.add('seleccionado');
          state.alumnoSeleccionado = a;
          $('alumno-elegido').textContent = 'Seleccionado: ' + a.nombre;
          $('btn-comenzar-examen').disabled = false;
        });
        ul.appendChild(li);
      });
  }

  /* ---------------- Flujo: examen ---------------- */
  function opcionesDePregunta(idPregunta) {
    return state.opciones
      .filter(o => o.id_pregunta === idPregunta)
      .sort((a, b) => a.letra.localeCompare(b.letra));
  }

  function renderPreguntaActual() {
    const pid = state.ordenPreguntas[state.indice];
    const p = state.preguntas.find(x => x.id === pid);
    if (!p) return;

    $('pregunta-enunciado').textContent = p.enunciado;

    const ul = $('pregunta-opciones');
    clearEl(ul);
    const marcada = state.intento.respuestas[pid];
    opcionesDePregunta(pid).forEach(op => {
      const li = document.createElement('li');
      if (marcada === op.letra) li.classList.add('seleccionada');
      li.innerHTML = `<span class="letra">${op.letra}</span><span>${escapeHtml(op.texto)}</span>`;
      li.addEventListener('click', () => seleccionarOpcion(pid, op.letra));
      ul.appendChild(li);
    });

    const total = state.ordenPreguntas.length;
    $('progress-text').textContent = (state.indice + 1) + ' / ' + total;
    $('progress-fill').style.width = ((state.indice + 1) / total * 100) + '%';

    $('btn-prev').disabled = state.indice === 0;
    $('btn-next').disabled = state.indice === total - 1;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  async function seleccionarOpcion(pid, letra) {
    state.intento.respuestas[pid] = letra;
    await DB.put('intentos', state.intento);
    renderPreguntaActual();
  }

  async function iniciarExamen() {
    const alumno = state.alumnoSeleccionado;
    if (!alumno) return;

    const examenId = String(state.config.examen_id || '1');
    const seed = seedFromAlumno(alumno.id, examenId);
    const mezclar = String(state.config.mezclar_preguntas).toUpperCase() === 'SI';

    const preguntasExamen = state.preguntas.filter(p => String(p.examen_id) === examenId);
    const ids = preguntasExamen.map(p => p.id);
    const orden = mezclar ? shuffleSeeded(ids, seed) : ids;

    const intento_id = `${alumno.id}_${examenId}_${Date.now()}`;

    state.intento = {
      intento_id,
      alumno_id: alumno.id,
      alumno_nombre: alumno.nombre,
      examen_id: examenId,
      inicio_ms: Timer.now(),
      duracion_seg: 0,
      respuestas: {},
      orden: orden,
      estado: 'en_curso'
    };
    state.ordenPreguntas = orden;
    state.indice = 0;

    await DB.put('intentos', state.intento);

    $('exam-timer').textContent = '00:00:00';
    Timer.start(state.intento.inicio_ms, (txt) => {
      $('exam-timer').textContent = txt;
    });

    renderPreguntaActual();
    showScreen('screen-exam');
    activarProteccionBack();
  }

  function activarProteccionBack() {
    history.pushState({ exam: true }, '', location.href);
  }

  async function reanudarIntento(intento) {
    state.intento = intento;
    state.ordenPreguntas = intento.orden;
    // Buscar índice de la primera no respondida
    let idx = intento.orden.findIndex(pid => !intento.respuestas[pid]);
    state.indice = idx === -1 ? intento.orden.length - 1 : idx;
    state.alumnoSeleccionado = state.alumnos.find(a => a.id === intento.alumno_id) || {
      id: intento.alumno_id, nombre: intento.alumno_nombre
    };

    $('exam-timer').textContent = Timer.fmt(Timer.now() - intento.inicio_ms);
    Timer.start(intento.inicio_ms, (txt) => { $('exam-timer').textContent = txt; });
    renderPreguntaActual();
    showScreen('screen-exam');
    activarProteccionBack();
  }

  async function finalizarExamen() {
    hideModal('modal-confirm-finish');
    Timer.stop();
    const it = state.intento;
    it.duracion_seg = Math.floor((Timer.now() - it.inicio_ms) / 1000);
    it.estado = 'pendiente';
    it.fin_ms = Timer.now();
    await DB.put('intentos', it);

    // Bloquear localmente
    const key = it.alumno_id + '_' + it.examen_id;
    await DB.put('bloqueados', { key });
    state.bloqueados.add(key);

    // Intentar sincronizar de inmediato
    try { await sincronizarPendientes(); } catch (_) {}

    state.intento = null;
    state.ordenPreguntas = [];
    state.indice = 0;
    state.alumnoSeleccionado = null;

    // Pantalla final con countdown
    showScreen('screen-finish');
    let n = 10;
    $('finish-countdown').textContent = n;
    const t = setInterval(() => {
      n--;
      $('finish-countdown').textContent = n;
      if (n <= 0) {
        clearInterval(t);
        volverHome();
      }
    }, 1000);
  }

  async function volverHome() {
    Timer.stop();
    $('input-buscar').value = '';
    $('alumno-elegido').textContent = 'Ningún alumno seleccionado';
    $('btn-comenzar-examen').disabled = true;
    state.alumnoSeleccionado = null;
    await refrescarHome();
    showScreen('screen-home');
  }

  /* ---------------- Sync ---------------- */
  async function sincronizarAhora(clave) {
    if (!navigator.onLine) {
      alert('Sin conexión. Intenta cuando recuperes internet.');
      return;
    }
    try {
      const r = await sincronizarPendientes();
      await actualizarEstadoSync();
      alert(`Sincronización completa. Enviados: ${r.enviados}, fallidos: ${r.fallidos}.`);
    } catch (e) {
      alert('Error al sincronizar: ' + e.message);
    }
  }

  /* ---------------- Arranque ---------------- */
  async function init() {
    setLoading('Iniciando…');

    // Registrar SW
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (_) {}
    }

    // Intentar cargar datos del servidor si hay internet
    if (navigator.onLine) {
      try {
        setLoading('Descargando examen…');
        await cargarDatosDesdeServidor();
      } catch (e) {
        console.warn('No se pudo descargar del servidor, usando caché:', e);
      }
    }

    // Cargar desde IndexedDB
    await cargarDatosDesdeCache();

    if (state.alumnos.length === 0 || state.preguntas.length === 0) {
      showScreen('screen-nodata');
      return;
    }

    // ¿Hay examen en curso?
    const intentos = await DB.all('intentos');
    const enCurso = intentos.find(i => i.estado === 'en_curso');
    if (enCurso) {
      UI.$('btn-continue-yes').onclick = async () => {
        hideModal('modal-continue');
        await reanudarIntento(enCurso);
      };
      UI.$('btn-continue-no').onclick = async () => {
        hideModal('modal-continue');
        await DB.del('intentos', enCurso.intento_id);
        await refrescarHome();
        showScreen('screen-home');
      };
      showModal('modal-continue');
      return;
    }

    await refrescarHome();
    showScreen('screen-home');
  }

  /* ---------------- Eventos ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    $('btn-empezar').onclick = () => {
      renderListaAlumnos('');
      $('input-buscar').value = '';
      $('alumno-elegido').textContent = 'Ningún alumno seleccionado';
      $('btn-comenzar-examen').disabled = true;
      showScreen('screen-select');
    };

    $('btn-back-home').onclick = () => volverHome();
    $('input-buscar').addEventListener('input', e => renderListaAlumnos(e.target.value));
    $('btn-comenzar-examen').onclick = iniciarExamen;

    $('btn-prev').onclick = () => {
      if (state.indice > 0) { state.indice--; renderPreguntaActual(); }
    };
    $('btn-next').onclick = () => {
      if (state.indice < state.ordenPreguntas.length - 1) { state.indice++; renderPreguntaActual(); }
    };
    $('btn-finalizar').onclick = () => showModal('modal-confirm-finish');
    $('btn-finish-cancel').onclick = () => hideModal('modal-confirm-finish');
    $('btn-finish-confirm').onclick = finalizarExamen;

    $('btn-blocked-back').onclick = volverHome;
    $('btn-retry-data').onclick = () => location.reload();

    $('btn-sync-open').onclick = async () => {
      const { txt } = await actualizarEstadoSync();
      $('sync-info').textContent = txt;
      $('sync-clave').value = '';
      showModal('modal-sync');
    };
    $('btn-sync-close').onclick = () => hideModal('modal-sync');
    $('btn-sync-now').onclick = async () => {
      const cfg = state.config;
      const claveIngresada = $('sync-clave').value;
      const claveOk = String(cfg.clave_sync_forzado || '');
      if (claveOk && claveIngresada !== claveOk) {
        alert('Clave incorrecta');
        return;
      }
      hideModal('modal-sync');
      await sincronizarAhora(claveIngresada);
    };

    window.addEventListener('online', async () => {
      try { await sincronizarPendientes(); await actualizarEstadoSync(); } catch (_) {}
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.intento && state.intento.estado === 'en_curso') {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    window.addEventListener('popstate', () => {
      if (state.intento && state.intento.estado === 'en_curso') {
        history.pushState({ exam: true }, '', location.href);
      }
    });

    init();
  });
})();