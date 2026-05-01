/* ── Task Business Logic ─────────────────────────────────────────────
   All data mutations go through here, then persist via Storage.
   ─────────────────────────────────────────────────────────────────── */

const Tasks = (() => {

  const PRIORITY_ORDER = { urgent: 0, medium: 1, low: 2 };

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function uid() {
    return 'task-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function now() { return new Date().toISOString(); }

  function sortByPriority(tasks) {
    return [...tasks].sort((a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
    );
  }

  /* Group pending tasks by clientName, return [{name, tasks}] */
  function groupByClient(allTasks, clientOrder = []) {
    const pending = allTasks.filter(t => t.status !== 'completed');
    const map = {};
    pending.forEach(t => {
      const c = t.clientName || 'Uncategorised';
      if (!map[c]) map[c] = [];
      map[c].push(t);
    });
    // Sort tasks within each client by priority
    Object.keys(map).forEach(k => { map[k] = sortByPriority(map[k]); });

    // Order clients by stored preference, then alphabetical for new ones
    const ordered = [...clientOrder.filter(c => map[c])];
    const remaining = Object.keys(map).filter(c => !ordered.includes(c)).sort();
    return [...ordered, ...remaining].map(name => ({ name, tasks: map[name] }));
  }

  /* ── CRUD Operations ─────────────────────────────────────────────── */
  async function createTask({ title, clientName, priority = 'medium', assignedTo = '',
                               description = '', actionables = [] }) {
    const db = await Storage.loadTasks();
    const task = {
      id: uid(),
      clientName: clientName.trim(),
      title: title.trim(),
      description,
      priority,
      status: 'pending',
      assignedTo: assignedTo.trim(),
      emailThreadId: null,
      summary: description,
      actionables: Array.isArray(actionables) ? actionables : [actionables].filter(Boolean),
      nextStepPerson: assignedTo.trim(),
      createdAt: now(),
      updatedAt: now(),
      completedAt: null,
      emailHistory: [],
      manuallyCreated: true
    };
    db.tasks.push(task);
    _updateClientList(db);
    await Storage.saveTasks(db);
    return task;
  }

  async function updatePriority(taskId, priority) {
    const db = await Storage.loadTasks();
    const t = db.tasks.find(x => x.id === taskId);
    if (!t) throw new Error('Task not found');
    t.priority = priority;
    t.updatedAt = now();
    await Storage.saveTasks(db);
    return t;
  }

  async function updateAssignee(taskId, assignedTo) {
    const db = await Storage.loadTasks();
    const t = db.tasks.find(x => x.id === taskId);
    if (!t) throw new Error('Task not found');
    t.assignedTo = assignedTo.trim();
    t.updatedAt = now();
    await Storage.saveTasks(db);
    return t;
  }

  async function markComplete(taskId) {
    const db = await Storage.loadTasks();
    const t = db.tasks.find(x => x.id === taskId);
    if (!t) throw new Error('Task not found');
    t.status = 'completed';
    t.completedAt = now();
    t.updatedAt = now();
    await Storage.saveTasks(db);
    return t;
  }

  async function markPending(taskId) {
    const db = await Storage.loadTasks();
    const t = db.tasks.find(x => x.id === taskId);
    if (!t) throw new Error('Task not found');
    t.status = 'pending';
    t.completedAt = null;
    t.updatedAt = now();
    await Storage.saveTasks(db);
    return t;
  }

  async function addEmployee(name) {
    const db = await Storage.loadTasks();
    db.settings = db.settings || { employees: [] };
    if (!db.settings.employees.includes(name.trim())) {
      db.settings.employees.push(name.trim());
      await Storage.saveTasks(db);
    }
    return db.settings.employees;
  }

  async function setEmployees(list) {
    const db = await Storage.loadTasks();
    db.settings = db.settings || {};
    db.settings.employees = list.filter(Boolean).map(s => s.trim());
    await Storage.saveTasks(db);
    return db.settings.employees;
  }

  /* Reorder client tabs, persist in localStorage (UI preference only) */
  function saveClientOrder(order) {
    localStorage.setItem('client_order', JSON.stringify(order));
  }
  function loadClientOrder() {
    try { return JSON.parse(localStorage.getItem('client_order') || '[]'); }
    catch { return []; }
  }

  /* ── Stats ───────────────────────────────────────────────────────── */
  function computeStats(tasks) {
    const total     = tasks.length;
    const pending   = tasks.filter(t => t.status !== 'completed').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const urgent    = tasks.filter(t => t.priority === 'urgent' && t.status !== 'completed').length;
    const medium    = tasks.filter(t => t.priority === 'medium' && t.status !== 'completed').length;
    const low       = tasks.filter(t => t.priority === 'low'    && t.status !== 'completed').length;
    return { total, pending, completed, urgent, medium, low };
  }

  /* ── Filtering ───────────────────────────────────────────────────── */
  function filter(tasks, { search = '', status = 'all', priority = 'all', employee = 'all' }) {
    const q = search.toLowerCase().trim();
    return tasks.filter(t => {
      if (status === 'pending'   && t.status === 'completed') return false;
      if (status === 'completed' && t.status !== 'completed') return false;
      if (priority !== 'all' && t.priority !== priority) return false;
      if (employee !== 'all' && t.assignedTo !== employee) return false;
      if (q) {
        const haystack = [t.title, t.clientName, t.assignedTo, t.description, t.summary]
          .join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  function _updateClientList(db) {
    db.clients = [...new Set(db.tasks.map(t => t.clientName).filter(Boolean))].sort();
  }

  return {
    groupByClient, sortByPriority, computeStats, filter,
    createTask, updatePriority, updateAssignee, markComplete, markPending,
    setEmployees, saveClientOrder, loadClientOrder
  };
})();
