const Tasks = {
  PRI: { urgent: 0, medium: 1, low: 2 },

  create({ title, client, description = '', priority = 'medium', assignee = '', actionables = [], responsiblePerson = '', emailSummary = '', emailThreadId = null, emailSubject = '', source = 'manual' }) {
    return DB.saveTask({
      id: DB.uid(), title, client: client.trim(), description, priority,
      status: 'pending', assignee, actionables: Array.isArray(actionables) ? actionables : [actionables].filter(Boolean),
      responsiblePerson, emailSummary, emailThreadId, emailSubject, source,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completedAt: null, userModified: {}
    });
  },

  update(id, changes) {
    const t = DB.getTask(id); if (!t) return null;
    const um = t.userModified || {};
    if (changes.priority && changes.priority !== t.priority) um.priority = true;
    if ('assignee' in changes) um.assignee = true;
    return DB.saveTask({ ...t, ...changes, userModified: um });
  },

  complete(id) {
    const t = DB.getTask(id); if (!t) return null;
    const um = { ...(t.userModified || {}), status: true };
    return DB.saveTask({ ...t, status: 'completed', completedAt: new Date().toISOString(), userModified: um });
  },

  reopen(id) {
    const t = DB.getTask(id); if (!t) return null;
    const um = { ...(t.userModified || {}), status: true };
    return DB.saveTask({ ...t, status: 'pending', completedAt: null, userModified: um });
  },

  remove(id) { DB.deleteTask(id); },

  filtered({ q = '', filter = 'all' } = {}) {
    let all = Object.values(DB.getTasks());
    if (q) {
      const s = q.toLowerCase();
      all = all.filter(t =>
        t.title.toLowerCase().includes(s) || t.client.toLowerCase().includes(s) ||
        (t.assignee || '').toLowerCase().includes(s) || (t.description || '').toLowerCase().includes(s)
      );
    }
    if (filter === 'urgent') all = all.filter(t => t.priority === 'urgent' && t.status === 'pending');
    else if (filter === 'medium') all = all.filter(t => t.priority === 'medium' && t.status === 'pending');
    else if (filter === 'low') all = all.filter(t => t.priority === 'low' && t.status === 'pending');
    else if (filter === 'assigned') all = all.filter(t => t.assignee && t.status === 'pending');
    else if (filter === 'email') all = all.filter(t => t.source === 'email');
    return all;
  },

  mergeEmail(incoming) {
    const existing = DB.getTasks();
    let added = 0, updated = 0;
    incoming.forEach(e => {
      const ex = existing[e.id];
      if (!ex) { DB.saveTask({ ...e, userModified: {} }); added++; }
      else {
        const um = ex.userModified || {};
        const merged = { ...ex };
        if (!um.status && e.status === 'completed') { merged.status = 'completed'; if (!merged.completedAt) merged.completedAt = new Date().toISOString(); }
        if (!um.priority) merged.priority = e.priority;
        merged.emailSummary = e.emailSummary || merged.emailSummary;
        merged.actionables = e.actionables?.length ? e.actionables : merged.actionables;
        merged.responsiblePerson = e.responsiblePerson || merged.responsiblePerson;
        merged.description = e.description || merged.description;
        DB.saveTask(merged); updated++;
      }
    });
    return { added, updated };
  }
};
