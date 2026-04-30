const Sync = {
  URL: 'data/email_updates.json',
  INTERVAL: 5 * 60 * 1000,
  _timer: null,

  async run() {
    const badge = document.getElementById('last-sync');
    badge.textContent = 'Syncing...';
    badge.className = 'sync-badge syncing';
    try {
      const res = await fetch(this.URL + '?_=' + Date.now(), { cache: 'no-cache' });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const { version } = DB.getSync();
      if (data.version && data.version !== version && data.tasks?.length) {
        const { added, updated } = Tasks.mergeEmail(data.tasks);
        DB.setSync({ version: data.version, fetchedAt: new Date().toISOString() });
        const m = DB.getMeta();
        m.lastSync = new Date().toISOString();
        m.totalEmailsProcessed = data.totalEmailsProcessed || m.totalEmailsProcessed;
        DB.setMeta(m);
        UI.render();
        badge.textContent = `+${added} new, ${updated} updated`;
      } else {
        badge.textContent = 'Up to date';
      }
      badge.className = 'sync-badge synced';
    } catch {
      badge.textContent = 'Offline';
      badge.className = 'sync-badge';
    }
    setTimeout(() => {
      const m = DB.getMeta();
      badge.textContent = m.lastSync
        ? 'Synced ' + new Date(m.lastSync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : 'Not synced';
      badge.className = 'sync-badge';
    }, 3000);
  },

  start() { this.run(); this._timer = setInterval(() => this.run(), this.INTERVAL); },
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
};
