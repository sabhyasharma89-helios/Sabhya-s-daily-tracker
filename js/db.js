/* ═══════════════════════════════════════════════════════════════
   db.js — IndexedDB wrapper + localStorage helpers
   Schema:
     tasks      — { id, clientId, clientName, title, priority, status,
                    assignedTo, emailThreadId, emailMessageIds[], summary,
                    actionables[], nextStepPerson, conversationHistory[],
                    createdAt, updatedAt, completedAt, source }
     user_data  — { taskOverrides{}, clientOrder[], collapsedClients[],
                    employees[], filters{}, lastSyncAt }
     config     — { ghOwner, ghRepo, ghBranch, ghTokenCipher,
                    lastEmailDate, totalEmailsProcessed }
   ═══════════════════════════════════════════════════════════════ */

const DB = (() => {
  const DB_NAME    = 'sabhya_tracker';
  const DB_VERSION = 1;
  let dbInstance   = null;

  // ─── Open / Init ────────────────────────────────────────────────
  function open() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tasks')) {
          const ts = db.createObjectStore('tasks', { keyPath: 'id' });
          ts.createIndex('clientId',   'clientId',   { unique: false });
          ts.createIndex('status',     'status',     { unique: false });
          ts.createIndex('priority',   'priority',   { unique: false });
          ts.createIndex('assignedTo', 'assignedTo', { unique: false });
        }
        if (!db.objectStoreNames.contains('user_data')) {
          db.createObjectStore('user_data', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('clients')) {
          db.createObjectStore('clients', { keyPath: 'id' });
        }
      };
      req.onsuccess = e => { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── Generic store helpers ───────────────────────────────────────
  async function tx(storeName, mode, fn) {
    const db   = await open();
    return new Promise((resolve, reject) => {
      const tr   = db.transaction(storeName, mode);
      const store = tr.objectStore(storeName);
      const req  = fn(store);
      tr.oncomplete = () => resolve(req ? req.result : undefined);
      tr.onerror    = () => reject(tr.error);
    });
  }

  async function getAll(storeName) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tr    = db.transaction(storeName, 'readonly');
      const store = tr.objectStore(storeName);
      const req   = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function getOne(storeName, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tr    = db.transaction(storeName, 'readonly');
      const store = tr.objectStore(storeName);
      const req   = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function putOne(storeName, obj) {
    return tx(storeName, 'readwrite', s => s.put(obj));
  }

  async function deleteOne(storeName, key) {
    return tx(storeName, 'readwrite', s => s.delete(key));
  }

  // ─── Tasks ──────────────────────────────────────────────────────
  async function getTasks() {
    return getAll('tasks');
  }

  async function saveTask(task) {
    task.updatedAt = new Date().toISOString();
    return putOne('tasks', task);
  }

  async function saveTasks(tasks) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tr    = db.transaction('tasks', 'readwrite');
      const store = tr.objectStore('tasks');
      for (const t of tasks) store.put(t);
      tr.oncomplete = () => resolve();
      tr.onerror    = () => reject(tr.error);
    });
  }

  async function getTask(id) {
    return getOne('tasks', id);
  }

  async function deleteTask(id) {
    return deleteOne('tasks', id);
  }

  // Merge remote tasks into DB without overwriting user modifications
  async function mergeRemoteTasks(remoteTasks) {
    const db = await open();
    const ud = await getUserData();
    const overrides = ud.taskOverrides || {};

    return new Promise((resolve, reject) => {
      const tr    = db.transaction('tasks', 'readwrite');
      const store = tr.objectStore('tasks');

      for (const rt of remoteTasks) {
        const req = store.get(rt.id);
        req.onsuccess = () => {
          const existing = req.result;
          // Apply user overrides on top of remote data
          const override = overrides[rt.id] || {};
          const merged   = Object.assign({}, rt, override);
          if (existing) {
            // Keep user-modified fields
            if (existing._userEdited) {
              merged.priority    = override.priority    ?? existing.priority    ?? rt.priority;
              merged.assignedTo  = override.assignedTo  ?? existing.assignedTo  ?? rt.assignedTo;
              merged.status      = override.status      ?? existing.status      ?? rt.status;
            }
          }
          store.put(merged);
        };
      }
      tr.oncomplete = () => resolve();
      tr.onerror    = () => reject(tr.error);
    });
  }

  // ─── Clients ────────────────────────────────────────────────────
  async function getClients() {
    return getAll('clients');
  }

  async function saveClient(client) {
    return putOne('clients', client);
  }

  async function saveClients(clients) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tr    = db.transaction('clients', 'readwrite');
      const store = tr.objectStore('clients');
      for (const c of clients) store.put(c);
      tr.oncomplete = () => resolve();
      tr.onerror    = () => reject(tr.error);
    });
  }

  // ─── User data (preferences, overrides, employees) ──────────────
  const UD_KEY = 'main';

  async function getUserData() {
    const row = await getOne('user_data', UD_KEY);
    return row ? row.value : {
      taskOverrides:    {},
      clientOrder:      [],
      collapsedClients: [],
      employees:        [],
      lastSyncAt:       null
    };
  }

  async function saveUserData(data) {
    return putOne('user_data', { key: UD_KEY, value: data });
  }

  async function patchUserData(patch) {
    const cur = await getUserData();
    return saveUserData(Object.assign({}, cur, patch));
  }

  // ─── Config (GitHub settings, token cipher, email state) ────────
  async function getConfig() {
    const row = await getOne('config', 'main');
    return row ? row.value : {
      ghOwner:              '',
      ghRepo:               '',
      ghBranch:             'main',
      ghTokenCipher:        null,
      lastEmailDate:        null,
      totalEmailsProcessed: 0
    };
  }

  async function saveConfig(cfg) {
    return putOne('config', { key: 'main', value: cfg });
  }

  async function patchConfig(patch) {
    const cur = await getConfig();
    return saveConfig(Object.assign({}, cur, patch));
  }

  // ─── Generate IDs ────────────────────────────────────────────────
  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  }

  return {
    open,
    // Tasks
    getTasks, saveTask, saveTasks, getTask, deleteTask, mergeRemoteTasks,
    // Clients
    getClients, saveClient, saveClients,
    // User data
    getUserData, saveUserData, patchUserData,
    // Config
    getConfig, saveConfig, patchConfig,
    // Utils
    newId
  };
})();
