/* ── App Entry Point ─────────────────────────────────────────────────
   Bootstraps authentication, wires all UI, manages the reload cycle.
   ─────────────────────────────────────────────────────────────────── */

const App = (() => {
  let _db = Storage.emptyDB();
  let _filters = { search: '', status: 'all', priority: 'all', employee: 'all' };
  let _refreshTimer = null;

  /* ── Boot ───────────────────────────────────────────────────────── */
  async function boot() {
    // Wire all permanent event listeners
    UI.wireStatChips(onFilterChange);
    UI.wireFilterBar(onFilterChange);
    UI.wireAddTask();
    UI.wireCompletedToggle();

    // Authenticate then load data
    await Auth.init(onAuthenticated);
  }

  async function onAuthenticated() {
    document.getElementById('dashboard').classList.remove('hidden');
    UI.wireSettings(_db);
    document.getElementById('refreshBtn').addEventListener('click', () => reload(true));
    await reload(true);
    scheduleRefresh();
  }

  /* ── Data load / render cycle ───────────────────────────────────── */
  async function reload(force = false) {
    try {
      _db = await Storage.loadTasks(force);
      UI.render(_db, _filters);
    } catch (err) {
      console.error('Load error:', err);
      UI.toast('Could not load data: ' + err.message, 'error', 4000);
      UI.render(_db, _filters); // Render with cached/empty data
    }
  }

  function scheduleRefresh() {
    clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => reload(true), CONFIG.refreshInterval);
  }

  function onFilterChange(partial) {
    Object.assign(_filters, partial);
    // Sync dropdowns to match stat chip filter
    if (partial.status !== undefined) document.getElementById('filterStatus').value = partial.status;
    if (partial.priority !== undefined) document.getElementById('filterPriority').value = partial.priority;
    UI.render(_db, _filters);
  }

  return { reload, onFilterChange };
})();

/* Kick everything off once DOM is ready */
document.addEventListener('DOMContentLoaded', () => App.boot());
