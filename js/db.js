const DB = {
  K: { T: 'tracker_tasks', M: 'tracker_meta', S: 'tracker_sync' },

  _g(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  _s(k, v) { localStorage.setItem(k, JSON.stringify(v)); },

  getTasks() { return this._g(this.K.T) || {}; },
  setTasks(t) { this._s(this.K.T, t); },
  getTask(id) { return (this._g(this.K.T) || {})[id] || null; },

  saveTask(t) {
    const tasks = this.getTasks();
    t.updatedAt = new Date().toISOString();
    tasks[t.id] = t;
    this.setTasks(tasks);
    return t;
  },

  deleteTask(id) { const t = this.getTasks(); delete t[id]; this.setTasks(t); },

  getMeta() {
    return this._g(this.K.M) || { lastSync: null, totalEmailsProcessed: 0 };
  },
  setMeta(m) { this._s(this.K.M, m); },

  getSync() { return this._g(this.K.S) || { version: null, fetchedAt: null }; },
  setSync(s) { this._s(this.K.S, s); },

  uid() { return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8); },

  stats() {
    const all = Object.values(this.getTasks());
    const pend = all.filter(t => t.status === 'pending');
    return {
      total: all.length,
      pending: pend.length,
      completed: all.filter(t => t.status === 'completed').length,
      urgent: pend.filter(t => t.priority === 'urgent').length,
      medium: pend.filter(t => t.priority === 'medium').length,
      low: pend.filter(t => t.priority === 'low').length
    };
  },

  clientList() {
    const names = new Set(Object.values(this.getTasks()).map(t => t.client));
    return [...names].sort();
  }
};
