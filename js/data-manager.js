/**
 * DataManager — loads, merges, and caches all data sources.
 *
 * Sources:
 *   1. data/tasks.json    — email-derived tasks (written by GitHub Actions)
 *   2. data/clients.json  — clients discovered from emails (written by GitHub Actions)
 *   3. data/metadata.json — sync status (written by GitHub Actions)
 *   4. user-overrides     — user edits (priority, status, assignment, manual tasks)
 *                           loaded via GitHub API when token available,
 *                           otherwise from localStorage cache.
 */

const DataManager = (() => {
  const CACHE_KEY = 'sdt_overrides_cache';
  const CACHE_SHA_KEY = 'sdt_overrides_sha';

  let _overridesSha = null;

  // ── Fetch helpers ─────────────────────────────────────────

  async function fetchJson(url) {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
  }

  // ── Load remote data ──────────────────────────────────────

  async function loadEmailData() {
    const [tasks, clients, metadata] = await Promise.all([
      fetchJson('data/tasks.json'),
      fetchJson('data/clients.json'),
      fetchJson('data/metadata.json'),
    ]);
    return { tasks, clients, metadata };
  }

  async function loadOverrides() {
    if (GithubAPI.hasToken()) {
      try {
        const { data, sha } = await GithubAPI.loadOverrides();
        _overridesSha = sha;
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_SHA_KEY, sha || '');
        return data;
      } catch (err) {
        console.warn('GitHub API load failed, falling back to cache:', err.message);
      }
    }
    // Fallback: localStorage cache
    const cached = localStorage.getItem(CACHE_KEY);
    _overridesSha = localStorage.getItem(CACHE_SHA_KEY) || null;
    return cached ? JSON.parse(cached) : GithubAPI.defaultOverrides();
  }

  // ── Merge ─────────────────────────────────────────────────

  function mergeData(emailData, overrides) {
    const { tasks: tasksData, clients: clientsData } = emailData;

    // Build merged task list
    const mergedTasks = tasksData.tasks.map(task => {
      const ov = overrides.overrides[task.id];
      if (!ov) return { ...task };
      return {
        ...task,
        priority:    ov.priority    ?? task.priority,
        status:      ov.status      ?? task.status,
        assignedTo:  ov.assignedTo  ?? task.assignedTo,
        completedAt: ov.completedAt ?? task.completedAt,
        manualNote:  ov.manualNote  ?? '',
      };
    });

    // Add manual tasks
    const allTasks = [...mergedTasks, ...(overrides.manualTasks || [])];

    // Determine client order
    const orderFromOverrides = overrides.clientOrder || [];
    const orderFromData = clientsData.clientOrder || [];
    const effectiveOrder = orderFromOverrides.length > 0 ? orderFromOverrides : orderFromData;

    // Build sorted client list
    const clientMap = Object.fromEntries(clientsData.clients.map(c => [c.id, c]));

    // Add any clients that appear only in manual tasks
    allTasks.forEach(t => {
      if (t.clientId && !clientMap[t.clientId]) {
        clientMap[t.clientId] = { id: t.clientId, name: t.clientName, color: '#4A90E2', order: 999 };
      }
    });

    const sortedClients = [...new Set([
      ...effectiveOrder,
      ...Object.keys(clientMap),
    ])]
      .filter(id => clientMap[id])
      .map(id => clientMap[id]);

    return {
      tasks: allTasks,
      clients: sortedClients,
      employees: overrides.employees || [],
      metadata: emailData.metadata,
    };
  }

  // ── Save overrides ────────────────────────────────────────

  async function saveOverrides(overrides) {
    overrides.lastUpdated = new Date().toISOString();

    // Persist to localStorage immediately
    localStorage.setItem(CACHE_KEY, JSON.stringify(overrides));

    // Attempt GitHub API save
    if (GithubAPI.hasToken()) {
      try {
        _overridesSha = await GithubAPI.saveOverrides(overrides, _overridesSha);
        localStorage.setItem(CACHE_SHA_KEY, _overridesSha || '');
        return true;
      } catch (err) {
        console.warn('GitHub API save failed (changes saved locally):', err.message);
        return false;
      }
    }
    return false;
  }

  // ── Override helpers ──────────────────────────────────────

  function applyTaskOverride(overrides, taskId, changes) {
    if (!overrides.overrides) overrides.overrides = {};
    overrides.overrides[taskId] = { ...(overrides.overrides[taskId] || {}), ...changes };
    return overrides;
  }

  function addManualTask(overrides, task) {
    if (!overrides.manualTasks) overrides.manualTasks = [];
    overrides.manualTasks.push(task);
    return overrides;
  }

  function updateManualTask(overrides, taskId, changes) {
    if (!overrides.manualTasks) return overrides;
    const idx = overrides.manualTasks.findIndex(t => t.id === taskId);
    if (idx >= 0) overrides.manualTasks[idx] = { ...overrides.manualTasks[idx], ...changes };
    return overrides;
  }

  function removeManualTask(overrides, taskId) {
    if (!overrides.manualTasks) return overrides;
    overrides.manualTasks = overrides.manualTasks.filter(t => t.id !== taskId);
    return overrides;
  }

  return {
    loadEmailData,
    loadOverrides,
    mergeData,
    saveOverrides,
    applyTaskOverride,
    addManualTask,
    updateManualTask,
    removeManualTask,
    get overridesSha() { return _overridesSha; },
  };
})();
