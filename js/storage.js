/* ── GitHub-backed Storage ───────────────────────────────────────────
   Reads JSON from raw.githubusercontent.com (no auth needed).
   Writes back via GitHub Contents API (needs PAT with repo scope).
   ─────────────────────────────────────────────────────────────────── */

const Storage = (() => {

  function rawUrl(path) {
    return `https://raw.githubusercontent.com/${CONFIG.githubOwner}/${CONFIG.githubRepo}/${CONFIG.githubBranch}/${path}?_=${Date.now()}`;
  }

  function apiUrl(path) {
    return `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${path}`;
  }

  async function readJSON(path) {
    const res = await fetch(rawUrl(path));
    if (!res.ok) throw new Error(`Cannot read ${path}: ${res.status}`);
    return res.json();
  }

  /* Write (create or update) a JSON file via GitHub API */
  async function writeJSON(path, data, commitMsg = 'Update tracker data') {
    const token = getGhToken();
    if (!token) throw new Error('GitHub token not configured. Open Settings to add it.');

    const content = JSON.stringify(data, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(content)));
    const url = apiUrl(path) + `?ref=${CONFIG.githubBranch}`;

    /* Get current SHA (needed for update) */
    const headRes = await fetch(url, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
    });

    let sha = null;
    if (headRes.ok) {
      const meta = await headRes.json();
      sha = meta.sha;
    }

    const body = { message: commitMsg, content: encoded, branch: CONFIG.githubBranch };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiUrl(path), {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error ${putRes.status}`);
    }
    return putRes.json();
  }

  /* Load tasks with in-memory cache to reduce API calls */
  let _cache = null;
  let _cacheTime = 0;
  const CACHE_TTL = 60_000; // 1 minute

  async function loadTasks(forceRefresh = false) {
    if (!forceRefresh && _cache && Date.now() - _cacheTime < CACHE_TTL) {
      return _cache;
    }
    try {
      const data = await readJSON(CONFIG.tasksPath);
      _cache = data;
      _cacheTime = Date.now();
      return data;
    } catch {
      if (_cache) return _cache;
      return emptyDB();
    }
  }

  async function saveTasks(data) {
    _cache = data;
    _cacheTime = Date.now();
    data.lastUpdated = new Date().toISOString();
    return writeJSON(CONFIG.tasksPath, data, `chore: update tasks [${new Date().toLocaleTimeString()}]`);
  }

  function emptyDB() {
    return {
      version: '1.0',
      lastUpdated: '',
      settings: { employees: [] },
      tasks: [],
      clients: []
    };
  }

  async function loadEmailState() {
    try {
      return await readJSON(CONFIG.emailStatePath);
    } catch {
      return { lastProcessedTimestamp: null, isFirstRun: true, processedThreadIds: [] };
    }
  }

  function invalidateCache() { _cache = null; _cacheTime = 0; }

  return { loadTasks, saveTasks, loadEmailState, invalidateCache, emptyDB };
})();
