/* IndexedDB database layer - never deletes data, only adds/updates */
class TaskTrackerDB {
  constructor() {
    this.db = null;
    this.DB_NAME = 'SabhyaTaskTracker';
    this.DB_VERSION = 1;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('clients')) {
          const s = db.createObjectStore('clients', { keyPath: 'id' });
          s.createIndex('name', 'name');
          s.createIndex('domain', 'domain');
          s.createIndex('order', 'order');
        }

        if (!db.objectStoreNames.contains('tasks')) {
          const s = db.createObjectStore('tasks', { keyPath: 'id' });
          s.createIndex('clientId', 'clientId');
          s.createIndex('status', 'status');
          s.createIndex('priority', 'priority');
          s.createIndex('assigneeId', 'assigneeId');
          s.createIndex('threadId', 'threadId');
          s.createIndex('updatedAt', 'updatedAt');
          s.createIndex('createdAt', 'createdAt');
        }

        if (!db.objectStoreNames.contains('emails')) {
          const s = db.createObjectStore('emails', { keyPath: 'id' });
          s.createIndex('threadId', 'threadId');
          s.createIndex('date', 'date');
          s.createIndex('processed', 'processed');
          s.createIndex('from', 'from');
        }

        if (!db.objectStoreNames.contains('employees')) {
          const s = db.createObjectStore('employees', { keyPath: 'id' });
          s.createIndex('email', 'email', { unique: true });
          s.createIndex('name', 'name');
        }

        if (!db.objectStoreNames.contains('sync_log')) {
          const s = db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
          s.createIndex('timestamp', 'timestamp');
        }
      };

      req.onsuccess = e => { this.db = e.target.result; resolve(this.db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  _tx(storeName, mode = 'readonly') {
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  get(storeName, key) {
    return new Promise((res, rej) => {
      const r = this._tx(storeName).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  getAll(storeName) {
    return new Promise((res, rej) => {
      const r = this._tx(storeName).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  getAllByIndex(storeName, indexName, value) {
    return new Promise((res, rej) => {
      const store = this._tx(storeName);
      const r = store.index(indexName).getAll(IDBKeyRange.only(value));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  put(storeName, data) {
    return new Promise((res, rej) => {
      const r = this._tx(storeName, 'readwrite').put(data);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async getConfig(key) {
    const item = await this.get('config', key);
    return item ? item.value : null;
  }

  async setConfig(key, value) {
    await this.put('config', { key, value });
  }

  async search(storeName, filterFn) {
    const all = await this.getAll(storeName);
    return all.filter(filterFn);
  }

  async getTasksFiltered({ clientId, status, priority, assigneeId, query } = {}) {
    let tasks = await this.getAll('tasks');

    if (clientId && clientId !== 'all') {
      tasks = tasks.filter(t => t.clientId === clientId);
    }
    if (status) {
      tasks = tasks.filter(t => t.status === status);
    }
    if (priority) {
      tasks = tasks.filter(t => t.priority === priority);
    }
    if (assigneeId) {
      tasks = tasks.filter(t => t.assigneeId === assigneeId);
    }
    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      const clients = await this.getAll('clients');
      const employees = await this.getAll('employees');
      const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
      const empMap = Object.fromEntries(employees.map(e => [e.id, e]));

      tasks = tasks.filter(t => {
        const client = clientMap[t.clientId];
        const emp = t.assigneeId ? empMap[t.assigneeId] : null;
        return (
          t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.subject?.toLowerCase().includes(q) ||
          client?.name?.toLowerCase().includes(q) ||
          emp?.name?.toLowerCase().includes(q) ||
          t.actionables?.some(a => a.toLowerCase().includes(q))
        );
      });
    }
    return tasks;
  }

  async getStats() {
    const tasks = await this.getAll('tasks');
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      urgent: tasks.filter(t => t.priority === 'urgent' && t.status !== 'completed').length,
      high: tasks.filter(t => t.priority === 'high' && t.status !== 'completed').length,
      medium: tasks.filter(t => t.priority === 'medium' && t.status !== 'completed').length,
      low: tasks.filter(t => t.priority === 'low' && t.status !== 'completed').length
    };
  }

  async getEmailsByThread(threadId) {
    return this.getAllByIndex('emails', 'threadId', threadId);
  }
}

const db = new TaskTrackerDB();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

async function hashPattern(patternStr) {
  const salt = 'sabhya-task-tracker-auth-v1';
  const encoder = new TextEncoder();
  const data = encoder.encode(patternStr + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
