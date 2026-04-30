/* ═══════════════════════════════════════════════════════════════
   DB — Data layer: fetch remote JSON + localStorage merge
   ═══════════════════════════════════════════════════════════════

   Remote (data/tasks.json):   email-derived tasks written by GitHub Actions
   Local  (localStorage):       user overrides (priority, assignee, status)
                                 + manually added tasks
                                 + client ordering

   Merge rule: local overrides take priority over remote data.
   Email-derived tasks are identified by their 'id' field.
   ═══════════════════════════════════════════════════════════════ */

const DB = (() => {

  /* localStorage keys */
  const K = {
    OVERRIDES:    'sdt_overrides',    // { [taskId]: { priority, assignee, status, completedAt } }
    MANUAL_TASKS: 'sdt_manual_tasks', // [ task, … ]
    CLIENT_ORDER: 'sdt_client_order', // [ clientName, … ]
    ASSIGNEES:    'sdt_assignees',    // [ name, … ]
    REMOTE_CACHE: 'sdt_remote_cache', // last fetched tasks.json blob
    CACHE_TS:     'sdt_cache_ts',     // timestamp of last fetch
  };

  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  /* ── Local helpers ── */
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  }

  /* ── ID generator ── */
  function uid() {
    return 'manual-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  /* ══════════════════ Remote fetch ══════════════════ */
  async function fetchRemote(force = false) {
    const ts    = parseInt(localStorage.getItem(K.CACHE_TS) || '0', 10);
    const stale = (Date.now() - ts) > CACHE_TTL_MS;

    if (!force && !stale) {
      const cached = loadJSON(K.REMOTE_CACHE, null);
      if (cached) return cached;
    }

    try {
      const url  = 'data/tasks.json?_t=' + Date.now();
      const res  = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      saveJSON(K.REMOTE_CACHE, data);
      localStorage.setItem(K.CACHE_TS, Date.now().toString());
      return data;
    } catch (err) {
      console.warn('[DB] fetchRemote failed:', err.message);
      return loadJSON(K.REMOTE_CACHE, { version: 1, tasks: [], clients: [], lastUpdated: null, lastEmailDate: null });
    }
  }

  /* ══════════════════ Merge ══════════════════ */
  function mergeTasks(remoteTasks, overrides, manualTasks) {
    const merged = remoteTasks.map(rt => {
      const ov = overrides[rt.id] || {};
      return { ...rt, ...ov };
    });

    /* Append manual tasks, applying any overrides */
    manualTasks.forEach(mt => {
      const ov = overrides[mt.id] || {};
      merged.push({ ...mt, ...ov });
    });

    return merged;
  }

  /* ══════════════════ Public: load all data ══════════════════ */
  async function load(force = false) {
    const remote    = await fetchRemote(force);
    const overrides = loadJSON(K.OVERRIDES, {});
    const manual    = loadJSON(K.MANUAL_TASKS, []);
    const tasks     = mergeTasks(remote.tasks || [], overrides, manual);

    /* Build client list: remote + manual, preserving user order */
    const allClients = [...new Set([
      ...(remote.clients || []),
      ...manual.map(t => t.clientName).filter(Boolean),
    ])];
    const savedOrder = loadJSON(K.CLIENT_ORDER, []);
    const ordered    = [
      ...savedOrder.filter(c => allClients.includes(c)),
      ...allClients.filter(c => !savedOrder.includes(c)),
    ];

    return {
      tasks,
      clients: ordered,
      lastUpdated:   remote.lastUpdated   || null,
      lastEmailDate: remote.lastEmailDate || null,
    };
  }

  /* ══════════════════ Task mutations (stored in localStorage) ══════════════════ */

  function setOverride(taskId, patch) {
    const ov = loadJSON(K.OVERRIDES, {});
    ov[taskId] = { ...(ov[taskId] || {}), ...patch };
    saveJSON(K.OVERRIDES, ov);
  }

  function markComplete(taskId) {
    setOverride(taskId, { status: 'completed', completedAt: new Date().toISOString() });
  }

  function markPending(taskId) {
    setOverride(taskId, { status: 'pending', completedAt: null });
  }

  function setPriority(taskId, priority) {
    setOverride(taskId, { priority });
  }

  function setAssignee(taskId, assignee) {
    setOverride(taskId, { assignee });

    /* Remember assignee for autocomplete */
    if (assignee && assignee.trim()) {
      const list = loadJSON(K.ASSIGNEES, []);
      if (!list.includes(assignee.trim())) {
        list.push(assignee.trim());
        saveJSON(K.ASSIGNEES, list);
      }
    }
  }

  /* ── Manual task add / edit / delete ── */
  function addManualTask({ clientName, title, description, priority, assignee }) {
    const task = {
      id:          uid(),
      clientName:  clientName.trim(),
      title:       title.trim(),
      description: description ? description.trim() : '',
      priority:    priority || 'medium',
      status:      'pending',
      assignee:    assignee ? assignee.trim() : '',
      source:      'manual',
      emailThreadId: null,
      emailSubject:  '',
      emailSummary:  '',
      actionables:   [],
      responsiblePerson: '',
      emails:       [],
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
      completedAt:  null,
    };

    const list = loadJSON(K.MANUAL_TASKS, []);
    list.push(task);
    saveJSON(K.MANUAL_TASKS, list);

    /* Add client to known list */
    addClient(task.clientName);

    /* Remember assignee */
    if (task.assignee) setAssignee(task.id, task.assignee);

    return task;
  }

  function updateManualTask(taskId, patch) {
    const list = loadJSON(K.MANUAL_TASKS, []);
    const idx  = list.findIndex(t => t.id === taskId);
    if (idx === -1) {
      /* It's an email-derived task — apply as override */
      setOverride(taskId, { ...patch, updatedAt: new Date().toISOString() });
      return;
    }
    list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
    saveJSON(K.MANUAL_TASKS, list);
  }

  /* ── Client ordering ── */
  function addClient(name) {
    if (!name) return;
    const order = loadJSON(K.CLIENT_ORDER, []);
    if (!order.includes(name)) {
      order.push(name);
      saveJSON(K.CLIENT_ORDER, order);
    }
  }

  function moveClientUp(name) {
    const order = loadJSON(K.CLIENT_ORDER, []);
    const i = order.indexOf(name);
    if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; saveJSON(K.CLIENT_ORDER, order); }
  }

  function moveClientDown(name) {
    const order = loadJSON(K.CLIENT_ORDER, []);
    const i = order.indexOf(name);
    if (i !== -1 && i < order.length - 1) { [order[i], order[i + 1]] = [order[i + 1], order[i]]; saveJSON(K.CLIENT_ORDER, order); }
  }

  /* ── Assignee list for autocomplete ── */
  function getAssignees() { return loadJSON(K.ASSIGNEES, []); }

  /* ── Stats ── */
  function computeStats(tasks) {
    const pending = tasks.filter(t => t.status !== 'completed');
    return {
      total:     tasks.length,
      pending:   pending.length,
      completed: tasks.length - pending.length,
      urgent:    pending.filter(t => t.priority === 'urgent').length,
      medium:    pending.filter(t => t.priority === 'medium').length,
      low:       pending.filter(t => t.priority === 'low').length,
    };
  }

  return {
    load,
    markComplete, markPending,
    setPriority, setAssignee,
    addManualTask, updateManualTask,
    moveClientUp, moveClientDown, addClient,
    getAssignees,
    computeStats,
  };
})();
