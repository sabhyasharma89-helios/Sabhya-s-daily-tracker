/**
 * TaskDB — reads/writes tasks.json via the GitHub Contents API.
 * Falls back to localStorage cache when offline.
 */
const TaskDB = (() => {
  const CACHE_KEY = 'tasktracker_data';
  const CONFIG_KEY = 'tasktracker_config';
  const PATTERN_KEY = 'tasktracker_pattern';

  /* ---- Config ---- */

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  }

  function clearConfig() {
    localStorage.removeItem(CONFIG_KEY);
  }

  /* ---- Pattern ---- */

  function getPatternHash() {
    return localStorage.getItem(PATTERN_KEY);
  }

  function savePatternHash(hash) {
    localStorage.setItem(PATTERN_KEY, hash);
  }

  function clearPattern() {
    localStorage.removeItem(PATTERN_KEY);
  }

  /* ---- Cache ---- */

  function getCached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Cache write failed (storage full?):', e);
    }
  }

  /* ---- GitHub API ---- */

  async function _apiRequest(path, method = 'GET', body = null) {
    const cfg = getConfig();
    if (!cfg || !cfg.token) throw new Error('GitHub not configured');

    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error ${res.status}`);
    }
    return res.json();
  }

  async function _getFileMeta() {
    try {
      return await _apiRequest('data/tasks.json');
    } catch (e) {
      if (e.message && e.message.includes('404')) return null;
      throw e;
    }
  }

  /* ---- Public: Load ---- */

  async function load() {
    // 1. Try GitHub
    try {
      const meta = await _getFileMeta();
      if (meta && meta.content) {
        const json = atob(meta.content.replace(/\n/g, ''));
        const data = JSON.parse(json);
        data._sha = meta.sha;
        setCache(data);
        return data;
      }
      // File exists but empty — return default
      return _defaultData();
    } catch (e) {
      console.warn('GitHub load failed, using cache:', e.message);
    }

    // 2. Fall back to localStorage cache
    const cached = getCached();
    if (cached) return cached;

    // 3. Brand new
    return _defaultData();
  }

  /* ---- Public: Save ---- */

  async function save(data) {
    const cfg = getConfig();
    if (!cfg || !cfg.token) {
      setCache(data);
      throw new Error('GitHub not configured — saved locally only');
    }

    const payload = { ...data };
    delete payload._sha;

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
    const sha = data._sha;

    const body = {
      message: 'chore: update tasks [skip ci]',
      content,
      branch: cfg.branch || 'main'
    };
    if (sha) body.sha = sha;

    const result = await _apiRequest('data/tasks.json', 'PUT', body);
    data._sha = result.content.sha;
    setCache(data);
    return data;
  }

  /* ---- Helpers ---- */

  function _defaultData() {
    return {
      metadata: { lastProcessed: null, version: '1.0', createdAt: new Date().toISOString() },
      employees: [],
      clients: {}
    };
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---- Task CRUD helpers (operate on the data object in memory) ---- */

  function ensureClient(data, clientName) {
    if (!data.clients[clientName]) {
      data.clients[clientName] = {
        id: generateId(),
        name: clientName,
        order: Object.keys(data.clients).length,
        tasks: []
      };
    }
    return data.clients[clientName];
  }

  function addTask(data, { clientName, title, description = '', priority = 'medium',
    assignedTo = null, source = 'manual', emailThreadId = null, emailSubject = null,
    participants = [], summary = '', actionables = [], responsibleParty = null,
    emailHistory = [] }) {

    const client = ensureClient(data, clientName);
    const task = {
      id: generateId(),
      clientName,
      title,
      description,
      priority,
      status: 'pending',
      assignedTo,
      source,
      emailThreadId,
      emailSubject,
      participants,
      summary,
      actionables,
      responsibleParty,
      emailHistory,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    client.tasks.push(task);
    return task;
  }

  function updateTask(data, taskId, updates) {
    for (const client of Object.values(data.clients)) {
      const idx = client.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        Object.assign(client.tasks[idx], updates, { updatedAt: new Date().toISOString() });
        return client.tasks[idx];
      }
    }
    return null;
  }

  function completeTask(data, taskId) {
    return updateTask(data, taskId, { status: 'completed', completedAt: new Date().toISOString() });
  }

  function reopenTask(data, taskId) {
    return updateTask(data, taskId, { status: 'pending', completedAt: null });
  }

  function deleteTask(data, taskId) {
    for (const client of Object.values(data.clients)) {
      const idx = client.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        client.tasks.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  function getAllTasks(data) {
    return Object.values(data.clients).flatMap(c => c.tasks);
  }

  function getTaskById(data, taskId) {
    for (const client of Object.values(data.clients)) {
      const t = client.tasks.find(t => t.id === taskId);
      if (t) return t;
    }
    return null;
  }

  function reorderClients(data, orderedNames) {
    orderedNames.forEach((name, i) => {
      if (data.clients[name]) data.clients[name].order = i;
    });
  }

  function renameClient(data, oldName, newName) {
    if (oldName === newName || !data.clients[oldName]) return;
    data.clients[newName] = { ...data.clients[oldName], name: newName };
    data.clients[newName].tasks = data.clients[newName].tasks.map(t => ({ ...t, clientName: newName }));
    delete data.clients[oldName];
  }

  return {
    // Config
    getConfig, saveConfig, clearConfig,
    // Pattern
    getPatternHash, savePatternHash, clearPattern,
    // Data
    load, save, getCached,
    // Task helpers
    generateId, ensureClient,
    addTask, updateTask, completeTask, reopenTask, deleteTask,
    getAllTasks, getTaskById, reorderClients, renameClient
  };
})();
