/* ═══════════════════════════════════════════════════════════════
   sync.js — GitHub API read/write engine
   - Reads data/tasks.json committed by GitHub Actions
   - Writes data/user_data.json for user modifications
   - Polls every 5 minutes for new data from Actions
   ═══════════════════════════════════════════════════════════════ */

const Sync = (() => {
  const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
  let pollTimer = null;
  let isSyncing = false;

  // ─── GitHub API helpers ─────────────────────────────────────────
  async function ghGet(path, token) {
    const cfg = await DB.getConfig();
    const owner  = cfg.ghOwner;
    const repo   = cfg.ghRepo;
    const branch = cfg.ghBranch || 'main';
    if (!owner || !repo) return null;

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      const json = await res.json();
      const content = atob(json.content.replace(/\n/g, ''));
      return { data: JSON.parse(content), sha: json.sha };
    } catch { return null; }
  }

  async function ghPut(path, content, sha, token, message) {
    const cfg = await DB.getConfig();
    const owner  = cfg.ghOwner;
    const repo   = cfg.ghRepo;
    const branch = cfg.ghBranch || 'main';
    if (!owner || !repo || !token) return false;

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const body = {
      message: message || `Update ${path} [tracker]`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
      branch
    };
    if (sha) body.sha = sha;

    try {
      const res = await fetch(url, {
        method:  'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Accept':        'application/vnd.github.v3+json',
          'Content-Type':  'application/json'
        },
        body: JSON.stringify(body)
      });
      return res.ok;
    } catch { return false; }
  }

  // ─── Raw content read (no auth needed for public repos) ─────────
  async function fetchRaw(path) {
    const cfg = await DB.getConfig();
    if (!cfg.ghOwner || !cfg.ghRepo) return null;
    const url = `https://raw.githubusercontent.com/${cfg.ghOwner}/${cfg.ghRepo}/${cfg.ghBranch || 'main'}/${path}`;
    try {
      const res = await fetch(url + '?t=' + Date.now()); // cache bust
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  // ─── Decrypt stored token ───────────────────────────────────────
  async function getToken() {
    const cfg = await DB.getConfig();
    if (!cfg.ghTokenCipher) return null;
    try {
      return await Auth.decryptWithHash(cfg.ghTokenCipher);
    } catch { return null; }
  }

  // ─── Pull remote tasks.json ─────────────────────────────────────
  async function pullTasks() {
    const remote = await fetchRaw('data/tasks.json');
    if (!remote) return false;

    const tasks   = Object.values(remote.tasks   || {});
    const clients = Object.values(remote.clients || {});

    if (tasks.length)   await DB.mergeRemoteTasks(tasks);
    if (clients.length) await DB.saveClients(clients);

    // Update config with last email date from remote
    if (remote.metadata) {
      await DB.patchConfig({
        lastEmailDate:        remote.metadata.lastEmailDate,
        totalEmailsProcessed: remote.metadata.totalEmailsProcessed
      });
    }
    return true;
  }

  // ─── Push user_data.json ────────────────────────────────────────
  async function pushUserData() {
    const token = await getToken();
    if (!token) return; // no token = read-only mode

    const ud  = await DB.getUserData();
    ud.lastSyncAt = new Date().toISOString();

    const existing = await ghGet('data/user_data.json', token);
    const sha      = existing ? existing.sha : undefined;

    await ghPut('data/user_data.json', ud, sha, token, 'Update user data [tracker-ui]');
    await DB.patchUserData({ lastSyncAt: ud.lastSyncAt });
  }

  // ─── Trigger GitHub Actions workflow dispatch ───────────────────
  async function triggerWorkflow() {
    const token = await getToken();
    if (!token) return false;
    const cfg = await DB.getConfig();
    const url = `https://api.github.com/repos/${cfg.ghOwner}/${cfg.ghRepo}/actions/workflows/email-processor.yml/dispatches`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept':        'application/vnd.github.v3+json',
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ ref: cfg.ghBranch || 'main' })
      });
      return res.ok || res.status === 204;
    } catch { return false; }
  }

  // ─── Status indicator ───────────────────────────────────────────
  function setStatus(text, spinning) {
    const el  = document.getElementById('sync-status');
    const btn = document.getElementById('sync-btn');
    if (el)  el.textContent  = text;
    if (btn) btn.classList.toggle('syncing', !!spinning);
  }

  // ─── Full sync cycle ────────────────────────────────────────────
  async function sync(silent) {
    if (isSyncing) return;
    isSyncing = true;
    if (!silent) setStatus('Syncing…', true);

    try {
      const ok = await pullTasks();
      if (ok) {
        await pushUserData();
        const now = new Date().toLocaleTimeString();
        setStatus(`Synced ${now}`, false);
        if (typeof App !== 'undefined') App.ui.refreshAll();
      } else {
        setStatus('Offline', false);
      }
    } catch (err) {
      console.warn('Sync error:', err);
      setStatus('Sync failed', false);
    } finally {
      isSyncing = false;
    }
  }

  // ─── Public API ──────────────────────────────────────────────────
  function startPolling() {
    sync(true);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => sync(true), POLL_INTERVAL);
  }

  function stopPolling() {
    clearInterval(pollTimer);
  }

  async function manualSync() {
    await triggerWorkflow(); // ask Actions to run now (may fail silently if no token)
    await sync(false);
  }

  // Save encrypted GitHub token
  async function saveToken(plainToken) {
    if (!plainToken) {
      await DB.patchConfig({ ghTokenCipher: null });
      return;
    }
    const cipher = await Auth.encryptWithHash(plainToken);
    await DB.patchConfig({ ghTokenCipher: cipher });
  }

  return { startPolling, stopPolling, manualSync, saveToken, pushUserData, sync };
})();
