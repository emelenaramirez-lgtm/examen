const UI = (() => {
  const $ = (id) => document.getElementById(id);

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const s = $(id);
    if (s) s.classList.add('active');
  }

  function showModal(id)   { $(id).classList.add('active'); }
  function hideModal(id)   { $(id).classList.remove('active'); }

  function setLoading(msg) { $('loading-msg').textContent = msg || 'Cargando…'; }

  function setSyncStatus(text) { $('status-cache').textContent = text; }

  function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  return { $, showScreen, showModal, hideModal, setLoading, setSyncStatus, clearEl };
})();