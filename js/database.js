/* ═══════════════════════════════════════════════════════
   INDEXEDDB DATABASE LAYER
═══════════════════════════════════════════════════════ */

const DB_NAME = 'SabhyaTaskTracker';
const DB_VERSION = 1;

const Database = {
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Tasks
        if (!db.objectStoreNames.contains('tasks')) {
          const ts = db.createObjectStore('tasks', { keyPath: 'id' });
          ts.createIndex('clientId',  'clientId',  { unique: false });
          ts.createIndex('status',    'status',    { unique: false });
          ts.createIndex('priority',  'priority',  { unique: false });
          ts.createIndex('assignedTo','assignedTo',{ unique: false });
          ts.createIndex('threadId',  'threadId',  { unique: false });
        }

        // Clients
        if (!db.objectStoreNames.contains('clients')) {
          const cs = db.createObjectStore('clients', { keyPath: 'id' });
          cs.createIndex('name',  'name',  { unique: false });
          cs.createIndex('order', 'order', { unique: false });
        }

        // Email threads (to avoid re-processing)
        if (!db.objectStoreNames.contains('emailThreads')) {
          const et = db.createObjectStore('emailThreads', { keyPath: 'id' });
          et.createIndex('clientId','clientId',{ unique: false });
        }

        // Employees
        if (!db.objectStoreNames.contains('employees')) {
          db.createObjectStore('employees', { keyPath: 'id' });
        }

        // Settings (key-value)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror   = (e) => reject(e.target.error);
    });
  },

  // ─── Generic helpers ────────────────────────────────────
  _tx(stores, mode = 'readonly') {
    return this.db.transaction(stores, mode);
  },

  _run(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  },

  async put(store, data) {
    return this._run(this._tx(store, 'readwrite').objectStore(store).put(data));
  },

  async get(store, key) {
    return this._run(this._tx(store).objectStore(store).get(key));
  },

  async getAll(store) {
    return this._run(this._tx(store).objectStore(store).getAll());
  },

  async delete(store, key) {
    return this._run(this._tx(store, 'readwrite').objectStore(store).delete(key));
  },

  async getByIndex(store, index, value) {
    return this._run(this._tx(store).objectStore(store).index(index).getAll(value));
  },

  // ─── Settings ───────────────────────────────────────────
  async getSetting(key) {
    const rec = await this.get('settings', key);
    return rec ? rec.value : null;
  },

  async setSetting(key, value) {
    await this.put('settings', { key, value });
  },

  // ─── Tasks ──────────────────────────────────────────────
  async saveTask(task) {
    if (!task.id) task.id = crypto.randomUUID();
    task.updatedAt = Date.now();
    if (!task.createdAt) task.createdAt = Date.now();
    return this.put('tasks', task);
  },

  async getTask(id) { return this.get('tasks', id); },

  async getAllTasks() { return this.getAll('tasks'); },

  async getTasksByClient(clientId) { return this.getByIndex('tasks', 'clientId', clientId); },

  async getTasksByStatus(status) { return this.getByIndex('tasks', 'status', status); },

  async getTasksByEmployee(name) { return this.getByIndex('tasks', 'assignedTo', name); },

  async getTasksByThread(threadId) { return this.getByIndex('tasks', 'threadId', threadId); },

  async markComplete(taskId) {
    const task = await this.getTask(taskId);
    if (!task) return;
    task.status = 'completed';
    task.completedAt = Date.now();
    return this.saveTask(task);
  },

  async markPending(taskId) {
    const task = await this.getTask(taskId);
    if (!task) return;
    task.status = 'pending';
    task.completedAt = null;
    return this.saveTask(task);
  },

  // ─── Clients ────────────────────────────────────────────
  async saveClient(client) {
    if (!client.id) client.id = crypto.randomUUID();
    if (client.order === undefined) {
      const all = await this.getAllClients();
      client.order = all.length;
    }
    return this.put('clients', client);
  },

  async getAllClients() {
    const all = await this.getAll('clients');
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },

  async findOrCreateClient(name) {
    const all = await this.getAllClients();
    const existing = all.find(c => c.name.toLowerCase() === name.toLowerCase().trim());
    if (existing) return existing;
    const colors = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#22c55e','#3b82f6','#a855f7','#ef4444','#06b6d4'];
    const color = colors[all.length % colors.length];
    const client = { name: name.trim(), color, order: all.length };
    await this.saveClient(client);
    return this.findOrCreateClient(name); // re-fetch with ID
  },

  // ─── Email Threads ───────────────────────────────────────
  async saveThread(thread) {
    return this.put('emailThreads', thread);
  },

  async getThread(id) { return this.get('emailThreads', id); },

  async getAllThreads() { return this.getAll('emailThreads'); },

  // ─── Employees ──────────────────────────────────────────
  async saveEmployee(name) {
    const id = name.toLowerCase().replace(/\s+/g, '-');
    return this.put('employees', { id, name });
  },

  async getAllEmployees() { return this.getAll('employees'); },

  async deleteEmployee(id) { return this.delete('employees', id); },

  // ─── Stats ──────────────────────────────────────────────
  async getStats() {
    const tasks = await this.getAllTasks();
    return {
      total:     tasks.length,
      pending:   tasks.filter(t => t.status === 'pending').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      urgent:    tasks.filter(t => t.priority === 'urgent' && t.status === 'pending').length,
      medium:    tasks.filter(t => t.priority === 'medium' && t.status === 'pending').length,
      low:       tasks.filter(t => t.priority === 'low'    && t.status === 'pending').length,
    };
  },
};
