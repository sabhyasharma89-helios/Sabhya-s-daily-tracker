/**
 * IndexedDB wrapper for persistent local storage.
 */
const DB_NAME = 'SabhyaTracker';
const DB_VERSION = 1;

let _db = null;

const DB = {
  async open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tasks')) {
          const ts = db.createObjectStore('tasks', { keyPath: 'id' });
          ts.createIndex('clientName', 'clientName', { unique: false });
          ts.createIndex('status', 'status', { unique: false });
          ts.createIndex('priority', 'priority', { unique: false });
          ts.createIndex('assignee', 'assignee', { unique: false });
          ts.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('clients')) {
          const cs = db.createObjectStore('clients', { keyPath: 'id' });
          cs.createIndex('name', 'name', { unique: false });
          cs.createIndex('order', 'order', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = e => reject(e.target.error);
    });
  },

  async _tx(stores, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const storeList = Array.isArray(stores) ? stores : [stores];
      const tx = db.transaction(storeList, mode);
      const result = fn(tx, storeList.map(s => tx.objectStore(s)));
      tx.oncomplete = () => {};
      tx.onerror = e => reject(e.target.error);
      if (result instanceof IDBRequest) {
        result.onsuccess = e => resolve(e.target.result);
        result.onerror = e => reject(e.target.error);
      } else {
        resolve(result);
      }
    });
  },

  // ── Tasks ──────────────────────────────────────────────

  async getAllTasks() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tasks', 'readonly');
      const req = tx.objectStore('tasks').getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async getTask(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tasks', 'readonly');
      const req = tx.objectStore('tasks').get(id);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async putTask(task) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tasks', 'readwrite');
      const req = tx.objectStore('tasks').put(task);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async putTasks(tasks) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tasks', 'readwrite');
      const store = tx.objectStore('tasks');
      tasks.forEach(t => store.put(t));
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  },

  // ── Clients ────────────────────────────────────────────

  async getAllClients() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('clients', 'readonly');
      const req = tx.objectStore('clients').getAll();
      req.onsuccess = e => resolve(e.target.result.sort((a, b) => (a.order || 0) - (b.order || 0)));
      req.onerror = e => reject(e.target.error);
    });
  },

  async putClient(client) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('clients', 'readwrite');
      const req = tx.objectStore('clients').put(client);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async putClients(clients) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('clients', 'readwrite');
      const store = tx.objectStore('clients');
      clients.forEach(c => store.put(c));
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  },

  // ── Settings ───────────────────────────────────────────

  async getSetting(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = e => resolve(e.target.result ? e.target.result.value : null);
      req.onerror = e => reject(e.target.error);
    });
  },

  async setSetting(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const req = tx.objectStore('settings').put({ key, value });
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  // ── Sync queue ─────────────────────────────────────────

  async queueSync(change) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite');
      const req = tx.objectStore('syncQueue').add({
        ...change,
        queuedAt: new Date().toISOString(),
      });
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async clearSyncQueue() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite');
      const req = tx.objectStore('syncQueue').clear();
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  },

  async getSyncQueue() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readonly');
      const req = tx.objectStore('syncQueue').getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },
};
