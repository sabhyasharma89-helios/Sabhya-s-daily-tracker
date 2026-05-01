/* ═══════════════════════════════════════
   DATABASE  –  IndexedDB wrapper
   Stores: tasks | clients | emailThreads | config
═══════════════════════════════════════ */
const DB_NAME    = 'SabhyaTrackerDB';
const DB_VERSION = 2;

const DB = (() => {
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('tasks')) {
          const ts = db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('clientId',  'clientId',  { unique: false });
          ts.createIndex('status',    'status',    { unique: false });
          ts.createIndex('priority',  'priority',  { unique: false });
          ts.createIndex('assignee',  'assignee',  { unique: false });
          ts.createIndex('threadId',  'threadIds', { unique: false, multiEntry: true });
        }
        if (!db.objectStoreNames.contains('clients')) {
          const cs = db.createObjectStore('clients', { keyPath: 'id' });
          cs.createIndex('name',     'name',     { unique: false });
          cs.createIndex('position', 'position', { unique: false });
        }
        if (!db.objectStoreNames.contains('emailThreads')) {
          db.createObjectStore('emailThreads', { keyPath: 'threadId' });
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
      };

      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror   = () => reject(req.error);
    });
  }

  function _tx(store, mode = 'readonly') {
    return _db.transaction(store, mode).objectStore(store);
  }

  function _wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  async function get(store, key)         { await open(); return _wrap(_tx(store).get(key)); }
  async function put(store, val)         { await open(); return _wrap(_tx(store,'readwrite').put(val)); }
  async function del(store, key)         { await open(); return _wrap(_tx(store,'readwrite').delete(key)); }
  async function getAll(store)           { await open(); return _wrap(_tx(store).getAll()); }
  async function getAllByIndex(store, idx, query) {
    await open(); return _wrap(_tx(store).index(idx).getAll(query));
  }
  async function count(store)            { await open(); return _wrap(_tx(store).count()); }

  async function getConfig(key)          { const r = await get('config', key); return r ? r.value : null; }
  async function setConfig(key, value)   { return put('config', { key, value }); }

  async function clearAll() {
    await open();
    const stores = ['tasks','clients','emailThreads','config'];
    return new Promise((res, rej) => {
      const tx = _db.transaction(stores, 'readwrite');
      stores.forEach(s => tx.objectStore(s).clear());
      tx.oncomplete = res;
      tx.onerror    = () => rej(tx.error);
    });
  }

  async function exportAll() {
    await open();
    const [tasks, clients, emailThreads, config] = await Promise.all([
      getAll('tasks'), getAll('clients'), getAll('emailThreads'), getAll('config')
    ]);
    return { tasks, clients, emailThreads, config, exportedAt: new Date().toISOString() };
  }

  async function importAll(data) {
    await open();
    const stores = ['tasks','clients','emailThreads','config'];
    return new Promise((res, rej) => {
      const tx = _db.transaction(stores, 'readwrite');
      stores.forEach(s => { tx.objectStore(s).clear(); });
      (data.tasks        || []).forEach(r => tx.objectStore('tasks').put(r));
      (data.clients      || []).forEach(r => tx.objectStore('clients').put(r));
      (data.emailThreads || []).forEach(r => tx.objectStore('emailThreads').put(r));
      (data.config       || []).forEach(r => tx.objectStore('config').put(r));
      tx.oncomplete = res;
      tx.onerror    = () => rej(tx.error);
    });
  }

  return { open, get, put, del, getAll, getAllByIndex, count, getConfig, setConfig, clearAll, exportAll, importAll };
})();
