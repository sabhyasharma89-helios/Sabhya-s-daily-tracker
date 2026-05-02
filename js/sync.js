/* ══════════════════════════════════════════════════════════════════
   sync.js — GitHub Sync Layer
   - Reads tasks.json from GitHub raw URL (no auth required if public)
   - Writes back via GitHub REST API using user's PAT (optional)
   - Auto-syncs every 10 minutes in the background
   ══════════════════════════════════════════════════════════════════ */

'use strict';

const Sync = (() => {
  let _cfg = {};
  let _syncTimer = null;
  const SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes

  async function loadConfig() {
    _cfg = {
      owner:  await DB.getConfig('ghOwner',  ''),
      repo:   await DB.getConfig('ghRepo',   ''),
      branch: await DB.getConfig('ghBranch', 'main'),
      token:  await DB.getConfig('ghToken',  ''),
    };
    return _cfg;
  }

  async function saveConfig(owner, repo, branch, token) {
    await DB.setConfig('ghOwner',  owner);
    await DB.setConfig('ghRepo',   repo);
    await DB.setConfig('ghBranch', branch);
    await DB.setConfig('ghToken',  token);
    _cfg = { owner, repo, branch, token };
  }

  /* ── Fetch tasks.json from GitHub raw URL ── */
  async function fetchRemoteTasks() {
    if (!_cfg.owner || !_cfg.repo) return null;

    const url = `https://raw.githubusercontent.com/${_cfg.owner}/${_cfg.repo}/${_cfg.branch}/data/tasks.json`;
    const headers = {};
    if (_cfg.token) headers['Authorization'] = `token ${_cfg.token}`;

    // Cache-bust with timestamp
    const res = await fetch(url + '?t=' + Date.now(), { headers });
    if (!res.ok) {
      if (res.status === 404) return null; // File doesn't exist yet — OK
      throw new Error(`GitHub fetch failed: ${res.status}`);
    }
    return res.json();
  }

  /* ── Write tasks.json via GitHub API ── */
  async function pushTasksToGitHub(data) {
    if (!_cfg.token || !_cfg.owner || !_cfg.repo) return false;

    const apiUrl = `https://api.github.com/repos/${_cfg.owner}/${_cfg.repo}/contents/data/tasks.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));

    // Get current file SHA (required for updates)
    let sha;
    try {
      const getRes = await fetch(apiUrl, {
        headers: { 'Authorization': `token ${_cfg.token}`, 'Accept': 'application/vnd.github+json' }
      });
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
      }
    } catch (_) { /* new file */ }

    const body = {
      message: `sync: update tasks.json [${new Date().toISOString()}]`,
      content,
      branch: _cfg.branch,
      ...(sha ? { sha } : {})
    };

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${_cfg.token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/vnd.github+json'
      },
      body: JSON.stringify(body)
    });

    return putRes.ok;
  }

  /* ── Full sync cycle ── */
  async function syncNow(opts = {}) {
    const { silent = false, onStatus } = opts;

    await loadConfig();
    onStatus?.('syncing');

    try {
      const remote = await fetchRemoteTasks();
      if (remote) {
        await DB.mergeFromGitHub(remote);
        await DB.addSyncLog({ type: 'pull', status: 'ok', tasks: remote.tasks?.length || 0 });
      }

      onStatus?.('ok');
      return { ok: true, remote };
    } catch (err) {
      console.error('[Sync] pull error:', err);
      await DB.addSyncLog({ type: 'pull', status: 'error', error: err.message });
      onStatus?.('error');
      return { ok: false, error: err.message };
    }
  }

  /* ── Save a task locally and optionally push to GitHub ── */
  async function saveAndSync(task) {
    const saved = await DB.saveTask(task);

    if (_cfg.token) {
      try {
        const all = await DB.exportAll();
        await pushTasksToGitHub(all);
      } catch (err) {
        console.warn('[Sync] push error:', err);
      }
    }

    return saved;
  }

  /* ── Delete a task locally and push ── */
  async function deleteAndSync(taskId) {
    await DB.deleteTask(taskId);

    if (_cfg.token) {
      try {
        const all = await DB.exportAll();
        await pushTasksToGitHub(all);
      } catch (err) {
        console.warn('[Sync] push error:', err);
      }
    }
  }

  /* ── Background sync loop ── */
  function startAutoSync(onStatus, onDataChanged) {
    if (_syncTimer) clearInterval(_syncTimer);

    _syncTimer = setInterval(async () => {
      const result = await syncNow({ silent: true, onStatus });
      if (result.ok && result.remote) {
        onDataChanged?.();
      }
    }, SYNC_INTERVAL);
  }

  function stopAutoSync() {
    if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
  }

  return { loadConfig, saveConfig, syncNow, saveAndSync, deleteAndSync, startAutoSync, stopAutoSync };
})();
