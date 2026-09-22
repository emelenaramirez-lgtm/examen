const Timer = (() => {
  let interval = null;
  let onTick = null;

  function getOffsetMs() {
    return parseInt(localStorage.getItem('timer_offset_ms') || '0', 10);
  }

  function setServerTime(serverISO) {
    const server = new Date(serverISO).getTime();
    const local = Date.now();
    const offset = server - local;
    localStorage.setItem('timer_offset_ms', String(offset));
  }

  function now() {
    return Date.now() + getOffsetMs();
  }

  function fmt(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function start(inicioMs, callback) {
    stop();
    onTick = callback;
    const tick = () => {
      const elapsed = now() - inicioMs;
      onTick(fmt(elapsed), elapsed);
    };
    tick();
    interval = setInterval(tick, 1000);
  }

  function stop() {
    if (interval) { clearInterval(interval); interval = null; }
  }

  return { getOffsetMs, setServerTime, now, fmt, start, stop };
})();