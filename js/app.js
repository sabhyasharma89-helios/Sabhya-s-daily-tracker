/* ════════════════════════════════════════════════════
   app.js — bootstraps everything after auth unlock
════════════════════════════════════════════════════ */

document.addEventListener('app:unlocked', () => App.init());

const App = (() => {
  let _refreshTimer = null;

  async function init() {
    _wireModalCloseButtons();
    _wireSettings();
    _wireFAB();
    _wireTaskModal();
    Dashboard.wireFilters();
    Dashboard.wireCompletedToggle();

    /* first-time setup prompt */
    if (!localStorage.getItem(CFG.LS.GITHUB_PAT)) {
      openModal('settings-modal-backdrop');
      toast('Enter your GitHub PAT in Settings to enable sync');
    }

    await _loadAndRender();

    /* auto-refresh every 2 min to pick up Action commits */
    _refreshTimer = setInterval(_loadAndRender, CFG.AUTO_REFRESH_MS);
  }

  /* ── load database + render ── */
  async function _loadAndRender() {
    _setSyncStatus('syncing', 'Loading…');
    try {
      await DB.load();
      Dashboard.render();
      const data = DB.get();
      const ts   = data?.lastSyncTime
        ? 'Synced ' + _ago(data.lastSyncTime)
        : 'No sync yet';
      _setSyncStatus('idle', ts);
    } catch (e) {
      console.error(e);
      _setSyncStatus('error', 'Load failed');
    }
  }

  /* ── sync status indicator ── */
  function _setSyncStatus(state, text) {
    const dot  = document.getElementById('sync-dot');
    const txt  = document.getElementById('sync-text');
    const btn  = document.getElementById('refresh-btn');
    dot.className  = `sync-dot ${state}`;
    txt.textContent = text;
    if (state === 'syncing') btn.querySelector('svg')?.classList.add('spinning');
    else                     btn.querySelector('svg')?.classList.remove('spinning');
  }

  /* ── FAB + empty-state add button ── */
  function _wireFAB() {
    document.getElementById('fab-add').addEventListener('click', () => Tasks.openAdd());
    document.getElementById('empty-add-btn')?.addEventListener('click', () => Tasks.openAdd());
    document.getElementById('refresh-btn').addEventListener('click', _loadAndRender);
  }

  /* ── task modal wiring ── */
  function _wireTaskModal() {
    document.getElementById('task-save-btn').addEventListener('click', () => Tasks.save());

    /* submit on Enter in text inputs */
    ['task-client','task-title-inp','task-assignee-inp'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') Tasks.save();
      });
    });
  }

  /* ── close buttons on all modals ── */
  function _wireModalCloseButtons() {
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });

    /* click outside modal closes it */
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) closeModal(backdrop.id);
      });
    });
  }

  /* ── settings modal ── */
  function _wireSettings() {
    const settingsBtn = document.getElementById('settings-btn');
    settingsBtn.addEventListener('click', () => _openSettings());

    document.getElementById('settings-save-btn').addEventListener('click', _saveSettings);

    document.getElementById('toggle-pat-vis').addEventListener('click', () => {
      const inp = document.getElementById('cfg-pat');
      const btn = document.getElementById('toggle-pat-vis');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.textContent = inp.type === 'password' ? 'Show' : 'Hide';
    });

    document.getElementById('test-connection-btn').addEventListener('click', async () => {
      const repo = document.getElementById('cfg-repo').value.trim();
      const pat  = document.getElementById('cfg-pat').value.trim();
      const el   = document.getElementById('connection-status');
      el.className = 'connection-status';
      el.textContent = 'Testing…';
      try {
        const ok = await DB.testConnection(repo, pat);
        el.className   = 'connection-status ' + (ok ? 'ok' : 'err');
        el.textContent = ok ? '✓ Connected' : '✗ Failed — check repo & PAT';
      } catch (_) {
        el.className   = 'connection-status err';
        el.textContent = '✗ Network error';
      }
    });

    document.getElementById('cfg-force-sync-btn').addEventListener('click', async () => {
      const ok = await DB.triggerSync();
      toast(ok ? 'Sync workflow triggered — check Actions tab' : 'Could not trigger sync (check PAT permissions)', ok ? 'success' : 'error');
    });

    document.getElementById('change-pattern-btn').addEventListener('click', () => {
      closeModal('settings-modal-backdrop');
      Auth.promptChange();
    });

    _wireEmployeeManager();
  }

  function _openSettings() {
    const data = DB.get();
    document.getElementById('cfg-repo').value = localStorage.getItem(CFG.LS.GITHUB_REPO) || CFG.DEFAULT_REPO;
    document.getElementById('cfg-pat').value  = localStorage.getItem(CFG.LS.GITHUB_PAT)  || '';

    if (data) {
      document.getElementById('cfg-last-sync').textContent  = data.lastSyncTime  ? _ago(data.lastSyncTime)  + ' ago' : 'Never';
      document.getElementById('cfg-last-email').textContent = data.lastEmailDate ? _ago(data.lastEmailDate) + ' ago' : 'Never';
    }

    _renderEmployeeChips();
    openModal('settings-modal-backdrop');
  }

  function _saveSettings() {
    const repo = document.getElementById('cfg-repo').value.trim();
    const pat  = document.getElementById('cfg-pat').value.trim();
    if (repo) localStorage.setItem(CFG.LS.GITHUB_REPO, repo);
    if (pat)  localStorage.setItem(CFG.LS.GITHUB_PAT, pat);
    closeModal('settings-modal-backdrop');
    toast('Settings saved', 'success');
    _loadAndRender();
  }

  /* ── employee manager ── */
  function _wireEmployeeManager() {
    document.getElementById('add-employee-btn').addEventListener('click', _addEmployee);
    document.getElementById('new-employee-inp').addEventListener('keydown', e => {
      if (e.key === 'Enter') _addEmployee();
    });
  }

  function _addEmployee() {
    const inp  = document.getElementById('new-employee-inp');
    const name = inp.value.trim();
    if (!name) return;
    const list = DB.getEmployees();
    if (!list.includes(name)) {
      list.push(name);
      DB.updateEmployees(list);
      const data = DB.get();
      if (data) { data.employees = list; DB.save().catch(() => {}); }
    }
    inp.value = '';
    _renderEmployeeChips();
    toast(`${name} added`);
  }

  function _renderEmployeeChips() {
    const container = document.getElementById('employee-chips');
    container.innerHTML = '';
    DB.getEmployees().forEach(name => {
      const chip = document.createElement('span');
      chip.className = 'employee-chip';
      chip.innerHTML = `${esc(name)}<button data-name="${esc(name)}" title="Remove">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        const list = DB.getEmployees().filter(n => n !== name);
        DB.updateEmployees(list);
        const data = DB.get();
        if (data) { data.employees = list; DB.save().catch(() => {}); }
        _renderEmployeeChips();
      });
      container.appendChild(chip);
    });
  }

  /* ── time helper ── */
  function _ago(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)   return 'just now';
    if (diff < 3600) return Math.floor(diff / 60)    + 'm ago';
    if (diff < 86400)return Math.floor(diff / 3600)  + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  return { init };
})();
