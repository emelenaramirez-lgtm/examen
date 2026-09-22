/* Envoltorio mínimo de IndexedDB basado en Promesas */
const DB = (() => {
  const DB_NAME = 'examen_db';
  const DB_VERSION = 1;

  const STORES = {
    meta: { keyPath: 'key' },
    config: { keyPath: 'clave' },
    alumnos: { keyPath: 'id' },
    preguntas: { keyPath: 'id' },
    opciones: { keyPath: 'id' },      // id = `${id_pregunta}_${letra}`
    intentos: { keyPath: 'intento_id' },
    bloqueados: { keyPath: 'key' }
  };

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        Object.keys(STORES).forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, STORES[name]);
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function get(store, key)     { return wrap((await tx(store,'readonly')).get(key)); }
  async function put(store, value)   { return wrap((await tx(store,'readwrite')).put(value)); }
  async function del(store, key)     { return wrap((await tx(store,'readwrite')).delete(key)); }
  async function all(store)          { return wrap((await tx(store,'readonly')).getAll()); }

  async function clear(store) {
    return wrap((await tx(store,'readwrite')).clear());
  }

  async function bulkPut(storeName, items) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(storeName, 'readwrite');
      const s = t.objectStore(storeName);
      items.forEach(it => s.put(it));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  return { get, put, del, all, clear, bulkPut, open };
})();