/* ============================================================
   GitHub Contents API — reads & writes data/tasks.json
   ============================================================ */
class GitHubAPI {
  constructor() {
    this._base = "https://api.github.com";
  }

  get token()  { return localStorage.getItem(CONFIG.LS_GITHUB_TOKEN) || ""; }
  get offline(){ return localStorage.getItem(CONFIG.LS_OFFLINE) === "true"; }

  _headers(write = false) {
    const h = {
      "Accept": "application/vnd.github.v3+json",
    };
    if (this.token) h["Authorization"] = `token ${this.token}`;
    if (write) h["Content-Type"] = "application/json";
    return h;
  }

  _url(path) {
    return `${this._base}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${path}?ref=${CONFIG.BRANCH}`;
  }

  /* Returns { data: <parsed JSON>, sha: <string> }
     Falls back to localStorage cache if no token / offline */
  async readTasks() {
    // Offline / no-token: use cache
    if (this.offline || !this.token) {
      const cached = localStorage.getItem(CONFIG.LS_TASKS_CACHE);
      return { data: cached ? JSON.parse(cached) : this._emptyDB(), sha: null };
    }

    const resp = await fetch(this._url(CONFIG.DATA_PATH), { headers: this._headers() });
    if (!resp.ok) {
      const cached = localStorage.getItem(CONFIG.LS_TASKS_CACHE);
      if (cached) return { data: JSON.parse(cached), sha: null };
      throw new Error(`GitHub read error: ${resp.status} ${resp.statusText}`);
    }
    const json    = await resp.json();
    const content = JSON.parse(atob(json.content.replace(/\n/g, "")));
    // Cache locally
    localStorage.setItem(CONFIG.LS_TASKS_CACHE, JSON.stringify(content));
    return { data: content, sha: json.sha };
  }

  /* Writes data back to GitHub.  Returns new SHA. */
  async writeTasks(data, sha, message = "chore: update tasks via dashboard") {
    if (this.offline || !this.token) {
      // Persist to cache only
      localStorage.setItem(CONFIG.LS_TASKS_CACHE, JSON.stringify(data));
      return null;
    }

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    const body    = { message, content: encoded, branch: CONFIG.BRANCH };
    if (sha) body.sha = sha;

    const resp = await fetch(
      `${this._base}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${CONFIG.DATA_PATH}`,
      { method: "PUT", headers: this._headers(true), body: JSON.stringify(body) }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`GitHub write error: ${resp.status} — ${err.message || resp.statusText}`);
    }
    const result = await resp.json();
    // Refresh cache
    localStorage.setItem(CONFIG.LS_TASKS_CACHE, JSON.stringify(data));
    return result.content.sha;
  }

  _emptyDB() {
    return {
      version: "1.0",
      lastUpdated: null,
      lastEmailCheck: null,
      clients: {},
      employees: [],
      stats: { total: 0, pending: 0, completed: 0, urgent: 0, medium: 0, low: 0 },
    };
  }
}

const ghAPI = new GitHubAPI();
