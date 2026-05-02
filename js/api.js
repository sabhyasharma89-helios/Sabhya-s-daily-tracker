/**
 * API client that communicates with the Google Apps Script web app.
 * All data is sent/received as JSON over HTTPS.
 * Uses localStorage as an offline cache so the dashboard loads instantly.
 */
class TrackerAPI {
  constructor() {
    this.url    = localStorage.getItem('tracker_api_url')  || '';
    this.secret = localStorage.getItem('tracker_api_key')  || '';
    this.CACHE_KEY = 'tracker_cache';
  }

  configure(url, secret) {
    this.url    = url.trim();
    this.secret = secret.trim();
    localStorage.setItem('tracker_api_url', this.url);
    localStorage.setItem('tracker_api_key', this.secret);
  }

  isConfigured() {
    return !!(this.url && this.secret);
  }

  // ── cache helpers ─────────────────────────────────────────────
  _saveCache(data) {
    try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  loadCache() {
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ── core request ──────────────────────────────────────────────
  async _req(params, body = null) {
    if (!this.isConfigured()) throw new Error('API not configured');

    const qs = new URLSearchParams({
      ...params,
      secret: this.secret,
    }).toString();

    const opts = body
      ? { method: 'POST', body: JSON.stringify(body),
          headers: { 'Content-Type': 'text/plain' } }
      : { method: 'GET' };

    const res = await fetch(`${this.url}?${qs}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { throw new Error('Invalid JSON response'); }

    if (json.error) throw new Error(json.error);
    return json;
  }

  // ── public methods ────────────────────────────────────────────
  async testConnection() {
    return this._req({ action: 'ping' });
  }

  async getAll() {
    const data = await this._req({ action: 'getAll' });
    this._saveCache(data);
    return data;
  }

  async getTasks(filters = {}) {
    return this._req({ action: 'getTasks', ...filters });
  }

  async createTask(task) {
    return this._req({ action: 'createTask' }, task);
  }

  async updateTask(id, updates) {
    return this._req({ action: 'updateTask', id }, updates);
  }

  async deleteTask(id) {
    return this._req({ action: 'deleteTask', id });
  }

  async getEmployees() {
    return this._req({ action: 'getEmployees' });
  }

  async addEmployee(name) {
    return this._req({ action: 'addEmployee' }, { name });
  }

  async removeEmployee(id) {
    return this._req({ action: 'removeEmployee', id });
  }

  async triggerSync(fullSync = false) {
    return this._req({ action: 'triggerSync', fullSync: fullSync ? '1' : '0' });
  }

  async getStats() {
    return this._req({ action: 'getStats' });
  }

  async reorderClients(orderedIds) {
    return this._req({ action: 'reorderClients' }, { order: orderedIds });
  }
}

const api = new TrackerAPI();
