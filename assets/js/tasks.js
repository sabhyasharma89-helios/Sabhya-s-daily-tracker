/**
 * Task state management and business logic.
 * Centralised store: AppState.  All mutations go through these functions
 * so we have a single place to persist changes back to GitHub.
 */

const TaskManager = (() => {
  /* ── In-memory store ─────────────────────────────────────── */
  const state = {
    tasks: [],
    clients: [],
    employees: [],
    lastUpdated: null,
    tasksSha: null,
    loading: false,
    dirty: false,       // unsaved local changes
  };

  /* ── Load / save ─────────────────────────────────────────── */
  async function load() {
    state.loading = true;
    try {
      const result = await GithubAPI.getFile('data/tasks.json');
      if (!result) {
        state.tasks = []; state.clients = []; state.employees = [];
        state.tasksSha = null;
      } else {
        state.tasks      = result.content.tasks      || [];
        state.clients    = result.content.clients    || [];
        state.employees  = result.content.employees  || [];
        state.lastUpdated= result.content.lastUpdated|| null;
        state.tasksSha   = result.sha;
      }
      state.dirty = false;
    } finally {
      state.loading = false;
    }
    return state;
  }

  async function save(message) {
    const payload = {
      tasks: state.tasks,
      clients: state.clients,
      employees: state.employees,
      lastUpdated: new Date().toISOString(),
    };
    const result = await GithubAPI.putFile(
      'data/tasks.json', payload, state.tasksSha,
      message || '🔄 Update tasks from dashboard'
    );
    state.tasksSha = result.content.sha;
    state.dirty = false;
  }

  /* ── Task CRUD ───────────────────────────────────────────── */
  function getAll() { return state.tasks; }
  function getClients() { return state.clients.slice().sort((a, b) => a.order - b.order); }
  function getEmployees() { return state.employees; }

  function getPending() { return state.tasks.filter(t => t.status === 'pending'); }
  function getCompleted() { return state.tasks.filter(t => t.status === 'completed'); }

  function getById(id) { return state.tasks.find(t => t.id === id) || null; }

  function getForClient(clientId) {
    if (clientId === 'all') return state.tasks;
    return state.tasks.filter(t => t.clientId === clientId);
  }

  /** Add a manually-created task */
  function addTask(fields) {
    const id = 'task_manual_' + Date.now().toString(36);
    const now = new Date().toISOString();

    // Ensure client exists
    let client = state.clients.find(c => c.id === fields.clientId);
    if (!client && fields.clientName) {
      const cid = 'client_' + Math.random().toString(36).slice(2, 10);
      client = { id: cid, name: fields.clientName, order: state.clients.length, collapsed: false };
      state.clients.push(client);
    }

    const task = {
      id,
      clientId:  client ? client.id   : 'client_general',
      clientName:client ? client.name : 'General',
      threadId: null,
      subject:   fields.subject || fields.taskTitle,
      taskTitle: fields.taskTitle,
      priority:  fields.priority  || 'medium',
      status:    'pending',
      assignee:  fields.assignee  || null,
      createdAt: now,
      updatedAt: now,
      summary:   fields.summary   || '',
      actionables: fields.actionables || [],
      responsiblePerson: fields.responsiblePerson || '',
      emailCount: 0,
      latestEmailDate: null,
      manuallyCreated: true,
    };
    state.tasks.push(task);
    state.dirty = true;
    return task;
  }

  function updateTask(id, updates) {
    const task = getById(id);
    if (!task) return null;
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    state.dirty = true;
    return task;
  }

  function markComplete(id) {
    return updateTask(id, { status: 'completed' });
  }

  function markPending(id) {
    return updateTask(id, { status: 'pending' });
  }

  function setPriority(id, priority) {
    return updateTask(id, { priority });
  }

  function setAssignee(id, assignee) {
    return updateTask(id, { assignee: assignee || null });
  }

  /* ── Client management ───────────────────────────────────── */
  function addClient(name) {
    const id = 'client_' + Math.random().toString(36).slice(2, 10);
    const client = { id, name, order: state.clients.length, collapsed: false };
    state.clients.push(client);
    state.dirty = true;
    return client;
  }

  function reorderClients(orderedIds) {
    orderedIds.forEach((id, i) => {
      const c = state.clients.find(x => x.id === id);
      if (c) c.order = i;
    });
    state.dirty = true;
  }

  /* ── Employee management ─────────────────────────────────── */
  function addEmployee(name) {
    if (state.employees.find(e => e.name.toLowerCase() === name.toLowerCase())) return null;
    const emp = { id: 'emp_' + Date.now().toString(36), name };
    state.employees.push(emp);
    state.dirty = true;
    return emp;
  }

  function removeEmployee(id) {
    state.employees = state.employees.filter(e => e.id !== id);
    state.dirty = true;
  }

  /* ── Filtering ───────────────────────────────────────────── */
  function filter({ clientId = 'all', priority = 'all', status = 'pending', assignee = 'all', query = '' } = {}) {
    let tasks = clientId === 'all' ? state.tasks : getForClient(clientId);

    if (status !== 'all') tasks = tasks.filter(t => t.status === status);
    if (priority !== 'all') tasks = tasks.filter(t => t.priority === priority);
    if (assignee !== 'all') tasks = tasks.filter(t => t.assignee === assignee);

    if (query) {
      const q = query.toLowerCase();
      tasks = tasks.filter(t =>
        t.taskTitle?.toLowerCase().includes(q) ||
        t.clientName?.toLowerCase().includes(q) ||
        t.summary?.toLowerCase().includes(q) ||
        t.assignee?.toLowerCase().includes(q) ||
        t.responsiblePerson?.toLowerCase().includes(q)
      );
    }

    return tasks;
  }

  /* ── Stats ───────────────────────────────────────────────── */
  function getStats() {
    const pending   = state.tasks.filter(t => t.status === 'pending');
    const completed = state.tasks.filter(t => t.status === 'completed');
    return {
      total:     state.tasks.length,
      pending:   pending.length,
      completed: completed.length,
      urgent:    pending.filter(t => t.priority === 'urgent').length,
      medium:    pending.filter(t => t.priority === 'medium').length,
      low:       pending.filter(t => t.priority === 'low').length,
    };
  }

  /* ── Expose ──────────────────────────────────────────────── */
  return {
    load, save,
    getAll, getClients, getEmployees, getPending, getCompleted,
    getById, getForClient,
    addTask, updateTask, markComplete, markPending, setPriority, setAssignee,
    addClient, reorderClients,
    addEmployee, removeEmployee,
    filter, getStats,
    get dirty() { return state.dirty; },
    get lastUpdated() { return state.lastUpdated; },
  };
})();
