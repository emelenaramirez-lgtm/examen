const API = (() => {
  const URL = window.APP_CONFIG.APPS_SCRIPT_URL;

  function withCacheBuster(url) {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + '_=' + Date.now();
  }

  async function getData() {
    const r = await fetch(withCacheBuster(URL + '?action=getData'), {
      method: 'GET',
      cache: 'no-store'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Error del servidor');
    return j.data;
  }

  async function saveIntento(intento) {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveIntento', intento })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Error del servidor');
    return j;
  }

  return { getData, saveIntento };
})();