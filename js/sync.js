/**
 * Syncs local IndexedDB with tasks.json on GitHub.
 * GitHub PAT stored encrypted in localStorage (encrypted with session pattern key).
 */
const Sync = {
  _repoOwner: null,
  _repoName: null,
  _branch: 'main',
  _isSyncing: false,
  _lastSyncAt: null,

  async init() {
    this._repoOwner = await DB.getSetting('repoOwner');
    this._repoName = await DB.getSetting('repoName');
    this._branch = (await DB.getSetting('repoBranch')) || 'main';
  },

  getToken() {
    const encrypted = localStorage.getItem('_gat');
    if (!encrypted) return null;
    const key = Auth.getSessionKey();
    if (!key) return null;
    try {
      return this._xorDecrypt(encrypted, key);
    } catch {
      return null;
    }
  },

  async setToken(token) {
    const key = Auth.getSessionKey();
    if (!key) return;
    const encrypted = this._xorEncrypt(token, key);
    localStorage.setItem('_gat', encrypted);
  },

  _xorEncrypt(str, key) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
      result += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
  },

  _xorDecrypt(encoded, key) {
    const str = atob(encoded);
    let result = '';
    for (let i = 0; i < str.length; i++) {
      result += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  },

  _apiBase() {
    return `https://api.github.com/repos/${this._repoOwner}/${this._repoName}`;
  },

  async _fetchFile(path) {
    const token = this.getToken();
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    const url = `${this._apiBase()}/contents/${path}?ref=${this._branch}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return { data: null, sha: null };
    const json = await r.json();
    const content = JSON.parse(atob(json.content.replace(/\n/g, '')));
    return { data: content, sha: json.sha };
  },

  async _putFile(path, content, sha, message) {
    const token = this.getToken();
    if (!token) throw new Error('No GitHub token configured');
    const body = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
    const payload = { message, content: body, branch: this._branch };
    if (sha) payload.sha = sha;
    const r = await fetch(`${this._apiBase()}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.message || `GitHub API error ${r.status}`);
    }
    return r.json();
  },

  /**
   * Pull latest tasks.json from GitHub and merge into IndexedDB.
   * Never deletes local data — only adds/updates.
   */
  async pull() {
    if (!this._repoOwner || !this._repoName) return { ok: false, msg: 'Repo not configured' };
    try {
      const { data } = await this._fetchFile('data/tasks.json');
      if (!data) return { ok: false, msg: 'Could not fetch tasks.json' };

      const remoteTasks = data.tasks || [];
      const remoteClients = data.clients || [];

      // Merge tasks: remote is authoritative for email-generated fields,
      // local is authoritative for manualFields (priority, assignee, status)
      const localTasks = await DB.getAllTasks();
      const localMap = new Map(localTasks.map(t => [t.id, t]));

      for (const rt of remoteTasks) {
        const lt = localMap.get(rt.id);
        if (!lt) {
          localMap.set(rt.id, rt);
        } else {
          // Preserve manually set fields
          const manual = lt.manualFields || {};
          const merged = { ...rt, manualFields: manual };
          if (manual.priority) merged.priority = lt.priority;
          if (manual.assignee) merged.assignee = lt.assignee;
          if (manual.status) { merged.status = lt.status; merged.completedAt = lt.completedAt; }
          localMap.set(rt.id, merged);
        }
      }

      await DB.putTasks([...localMap.values()]);

      // Merge clients
      const localClients = await DB.getAllClients();
      const localClientMap = new Map(localClients.map(c => [c.id, c]));
      for (const rc of remoteClients) {
        if (!localClientMap.has(rc.id)) localClientMap.set(rc.id, rc);
      }
      await DB.putClients([...localClientMap.values()]);

      this._lastSyncAt = new Date();
      await DB.setSetting('lastSyncAt', this._lastSyncAt.toISOString());
      return { ok: true, count: remoteTasks.length };
    } catch (e) {
      console.error('Sync pull error:', e);
      return { ok: false, msg: e.message };
    }
  },

  /**
   * Push user-initiated task changes back to GitHub tasks.json.
   */
  async push() {
    if (this._isSyncing) return { ok: false, msg: 'Sync in progress' };
    if (!this._repoOwner || !this._repoName) return { ok: false, msg: 'Repo not configured' };
    if (!this.getToken()) return { ok: false, msg: 'No GitHub token' };

    this._isSyncing = true;
    try {
      const { data, sha } = await this._fetchFile('data/tasks.json');
      const remoteTasks = (data && data.tasks) ? data.tasks : [];
      const remoteClients = (data && data.clients) ? data.clients : [];

      const localTasks = await DB.getAllTasks();
      const localClients = await DB.getAllClients();

      // Merge: local overrides remote for all tasks
      const remoteMap = new Map(remoteTasks.map(t => [t.id, t]));
      for (const lt of localTasks) {
        remoteMap.set(lt.id, lt);
      }

      const remoteClientMap = new Map(remoteClients.map(c => [c.id, c]));
      for (const lc of localClients) {
        remoteClientMap.set(lc.id, lc);
      }

      const merged = {
        ...(data || {}),
        tasks: [...remoteMap.values()],
        clients: [...remoteClientMap.values()],
        lastUpdated: new Date().toISOString(),
      };

      await this._putFile('data/tasks.json', merged, sha, 'chore: sync user changes [skip ci]');
      await DB.clearSyncQueue();
      this._lastSyncAt = new Date();
      return { ok: true };
    } catch (e) {
      console.error('Sync push error:', e);
      return { ok: false, msg: e.message };
    } finally {
      this._isSyncing = false;
    }
  },

  getLastSyncTime() {
    return this._lastSyncAt;
  },
};
