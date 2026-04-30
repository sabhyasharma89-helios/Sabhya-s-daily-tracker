/* ════════════════════════════════════════════════════
   db.js — read/write database.json via GitHub API
════════════════════════════════════════════════════ */

const DB = (() => {
  let _data = null;   // in-memory copy
  let _sha  = null;   // current file SHA (needed for updates)

  /* ── helpers ── */
  function repo()   { return localStorage.getItem(CFG.LS.GITHUB_REPO) || CFG.DEFAULT_REPO; }
  function pat()    { return localStorage.getItem(CFG.LS.GITHUB_PAT)  || ''; }
  function apiBase(){ return `https://api.github.com/repos/${repo()}/contents/${CFG.DB_PATH}`; }
  function rawUrl() { return `https://raw.githubusercontent.com/${repo()}/${CFG.BRANCH}/${CFG.DB_PATH}?t=${Date.now()}`; }

  function headers(withAuth = true) {
    const h = { 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' };
    if (withAuth && pat()) h['Authorization'] = `token ${pat()}`;
    return h;
  }

  /* ── empty schema ── */
  function emptyDb() {
    return {
      version:       '1.0',
      lastSyncTime:  null,
      lastEmailDate: null,
      clients:       {},
      employees:     [],
      settings:      { syncInterval: 10 }
    };
  }

  /* ── LOAD ── */
  async function load() {
    /* 1. Try authenticated GitHub API (gets SHA too) */
    if (pat()) {
      try {
        const res = await fetch(apiBase(), { headers: headers() });
        if (res.ok) {
          const json = await res.json();
          _sha  = json.sha;
          _data = JSON.parse(atob(json.content.replace(/\n/g, '')));
          _mergeLocalOverrides();
          return _data;
        }
      } catch (_) {}
    }

    /* 2. Fallback: raw URL (public repo, no PAT needed) */
    try {
      const res = await fetch(rawUrl());
      if (res.ok) {
        _data = await res.json();
        _mergeLocalOverrides();
        return _data;
      }
    } catch (_) {}

    /* 3. Completely offline — use whatever we already have */
    if (_data) return _data;

    /* 4. Brand new — return empty schema */
    _data = emptyDb();
    return _data;
  }

  /* Merge any locally-buffered overrides (priority / assignee changes
     made while offline) into freshly-loaded data. */
  function _mergeLocalOverrides() {
    const raw = localStorage.getItem(CFG.LS.LOCAL_OVERRIDES);
    if (!raw) return;
    try {
      const overrides = JSON.parse(raw); // { [taskId]: { priority, assignedTo, status, completedAt } }
      for (const [tid, patch] of Object.entries(overrides)) {
        const task = _findTask(tid);
        if (task) Object.assign(task, patch);
      }
    } catch (_) {}
  }

  /* ── SAVE ── */
  async function save() {
    if (!pat() || !_data) return false;

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(_data, null, 2))));

    const body = {
      message: `Update task database [frontend ${new Date().toISOString()}]`,
      content,
      branch:  CFG.BRANCH,
    };
    if (_sha) body.sha = _sha;

    try {
      const res = await fetch(apiBase(), {
        method:  'PUT',
        headers: headers(),
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('GitHub API error', err);
        return false;
      }
      const json = await res.json();
      _sha = json.content.sha;
      /* clear local override buffer on successful save */
      localStorage.removeItem(CFG.LS.LOCAL_OVERRIDES);
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  }

  /* ── quick local patch (survives reload even if save fails) ── */
  function patchLocal(taskId, patch) {
    const raw = localStorage.getItem(CFG.LS.LOCAL_OVERRIDES);
    const overrides = raw ? JSON.parse(raw) : {};
    overrides[taskId] = Object.assign(overrides[taskId] || {}, patch);
    localStorage.setItem(CFG.LS.LOCAL_OVERRIDES, JSON.stringify(overrides));
  }

  /* ── CRUD helpers ── */
  function get() { return _data; }

  function _findTask(taskId) {
    if (!_data) return null;
    for (const client of Object.values(_data.clients)) {
      const t = client.tasks.find(t => t.id === taskId);
      if (t) return t;
    }
    return null;
  }

  function findTask(taskId)   { return _findTask(taskId); }

  function findClientOfTask(taskId) {
    if (!_data) return null;
    return Object.values(_data.clients).find(c => c.tasks.some(t => t.id === taskId)) || null;
  }

  function ensureClient(name) {
    const norm = name.trim();
    let client = Object.values(_data.clients).find(c => c.name.toLowerCase() === norm.toLowerCase());
    if (!client) {
      const id  = crypto.randomUUID();
      client    = { id, name: norm, order: Object.keys(_data.clients).length, collapsed: false, tasks: [] };
      _data.clients[id] = client;
    }
    return client;
  }

  function addTask(taskObj) {
    const client = ensureClient(taskObj.clientName);
    const now    = new Date().toISOString();
    const task   = {
      id:            crypto.randomUUID(),
      clientId:      client.id,
      title:         taskObj.title,
      description:   taskObj.description || '',
      priority:      taskObj.priority    || 'medium',
      status:        'pending',
      assignedTo:    taskObj.assignedTo  || null,
      emailThreadId: null,
      emailSubject:  null,
      summary:       '',
      actionables:   [],
      nextStepsPerson: null,
      createdAt:     now,
      updatedAt:     now,
      completedAt:   null,
      emailHistory:  [],
    };
    client.tasks.push(task);
    return task;
  }

  function updateTask(taskId, patch) {
    const task = _findTask(taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    return task;
  }

  function deleteTask(taskId) {
    for (const client of Object.values(_data.clients)) {
      const idx = client.tasks.findIndex(t => t.id === taskId);
      if (idx >= 0) { client.tasks.splice(idx, 1); return true; }
    }
    return false;
  }

  function completeTask(taskId) {
    const now = new Date().toISOString();
    return updateTask(taskId, { status: 'completed', completedAt: now });
  }

  function uncompleteTask(taskId) {
    return updateTask(taskId, { status: 'pending', completedAt: null });
  }

  function setClientOrder(clientId, newOrder) {
    if (_data.clients[clientId]) _data.clients[clientId].order = newOrder;
  }

  function setClientCollapsed(clientId, val) {
    if (_data.clients[clientId]) _data.clients[clientId].collapsed = val;
  }

  function updateEmployees(list) {
    _data.employees = list;
    localStorage.setItem(CFG.LS.EMPLOYEES, JSON.stringify(list));
  }

  function getEmployees() {
    /* prefer live data, fall back to LS cache */
    if (_data && _data.employees && _data.employees.length) return _data.employees;
    const raw = localStorage.getItem(CFG.LS.EMPLOYEES);
    return raw ? JSON.parse(raw) : [];
  }

  /* ── connectivity test ── */
  async function testConnection(repoOverride, patOverride) {
    const url = `https://api.github.com/repos/${repoOverride || repo()}/contents/${CFG.DB_PATH}`;
    const res = await fetch(url, {
      headers: { Authorization: `token ${patOverride || pat()}`, Accept: 'application/vnd.github+json' }
    });
    return res.ok;
  }

  /* trigger GitHub Actions workflow_dispatch (needs PAT + actions:write) */
  async function triggerSync() {
    const url = `https://api.github.com/repos/${repo()}/actions/workflows/email-sync.yml/dispatches`;
    const res = await fetch(url, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify({ ref: CFG.BRANCH }),
    });
    return res.ok || res.status === 204;
  }

  return {
    load, save, get,
    findTask, findClientOfTask,
    ensureClient,
    addTask, updateTask, deleteTask,
    completeTask, uncompleteTask,
    setClientOrder, setClientCollapsed,
    updateEmployees, getEmployees,
    testConnection, triggerSync,
    patchLocal,
  };
})();
