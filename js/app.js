/* ═══════════════════════════════════════
   APP  –  Initialisation + orchestration
═══════════════════════════════════════ */
const App = (() => {

  let _pollTimer    = null;
  let _patternLock  = null;   // main lock screen instance
  let _setupPattern = null;   // setup wizard instance
  let _changePat    = null;   // change-pattern modal instance
  let _currentFilters = {};

  /* ══════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════ */
  async function init() {
    await DB.open();

    const hasPattern = await Auth.hasPattern();
    const hasKeys    = !!(await DB.getConfig('anthropicKey')) && !!(await DB.getConfig('googleClientId'));
    const hasToken   = !!(await Auth.getToken());

    document.getElementById('currentOrigin').textContent = `${location.origin}/`;

    if (!hasPattern || !hasKeys || !hasToken) {
      _initSetupWizard(hasPattern, hasKeys, hasToken);
      UI.showScreen('screen-setup');
    } else {
      _initPatternLock();
      UI.showScreen('screen-pattern');
    }
  }

  /* ══════════════════════════════════════════════════
     SETUP WIZARD
  ══════════════════════════════════════════════════ */
  function _initSetupWizard(hasPattern, hasKeys, hasToken) {
    const startStep = !hasPattern ? 1 : !hasKeys ? 2 : 3;
    _goSetupStep(startStep);

    // Step 1 – pattern
    let _pendingPattern = null;
    _setupPattern = Auth.createPatternLock(
      document.getElementById('setupCanvas'),
      document.getElementById('setupDots'),
      {
        onPattern: async (arr) => {
          if (!_pendingPattern) {
            _pendingPattern = arr;
            document.getElementById('setupMsg').textContent = 'Draw again to confirm';
            document.getElementById('setupMsg').className   = 'pattern-msg';
          } else {
            const h1 = await Auth.hashPattern(_pendingPattern);
            const h2 = await Auth.hashPattern(arr);
            if (h1 === h2) {
              await Auth.savePattern(arr);
              _setupPattern.setConfirmed(true);
              document.getElementById('setupMsg').textContent   = 'Pattern set! ✓';
              document.getElementById('setupMsg').className     = 'pattern-msg success';
              document.getElementById('btnConfirmPattern').disabled = false;
            } else {
              _pendingPattern = null;
              _setupPattern.setConfirmed(false);
              document.getElementById('setupMsg').textContent  = 'Patterns did not match. Try again.';
              document.getElementById('setupMsg').className    = 'pattern-msg error';
            }
          }
        },
        onTooShort: () => {
          document.getElementById('setupMsg').textContent = 'Connect at least 4 dots';
          document.getElementById('setupMsg').className   = 'pattern-msg error';
        }
      }
    );

    document.getElementById('btnConfirmPattern').addEventListener('click', () => _goSetupStep(2));

    // Step 2 – API keys
    document.getElementById('btnSaveApiKeys').addEventListener('click', async () => {
      const ak = document.getElementById('setupAnthropicKey').value.trim();
      const gk = document.getElementById('setupGoogleClientId').value.trim();
      if (!ak || !gk) { UI.toast('Both keys are required.', 'error'); return; }
      await DB.setConfig('anthropicKey',    ak);
      await DB.setConfig('googleClientId',  gk);
      _goSetupStep(3);
    });

    // Step 3 – Google Auth
    document.getElementById('btnGoogleAuth').addEventListener('click', async () => {
      const statusEl = document.getElementById('googleAuthStatus');
      statusEl.textContent = 'Opening auth…'; statusEl.className = 'auth-status';
      try {
        await Auth.googleAuth();
        statusEl.textContent  = '✅ Gmail connected! Loading dashboard…';
        statusEl.className    = 'auth-status success';
        setTimeout(() => _loadDashboard(), 1200);
      } catch (err) {
        statusEl.textContent  = '❌ ' + err.message;
        statusEl.className    = 'auth-status error';
      }
    });
  }

  function _goSetupStep(n) {
    document.querySelectorAll('.setup-step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`step${n}`).classList.add('active');
    document.querySelectorAll('.step-dot').forEach((d, i) => {
      d.classList.toggle('active', i + 1 === n);
      d.classList.toggle('done',   i + 1 < n);
    });
  }

  /* ══════════════════════════════════════════════════
     PATTERN LOCK (main screen)
  ══════════════════════════════════════════════════ */
  function _initPatternLock() {
    const canvas  = document.getElementById('patternCanvas');
    const dots    = document.getElementById('patternDots');
    const msgEl   = document.getElementById('patternMsg');
    const forgotBtn = document.getElementById('btnForgotPattern');
    let _attempts = 0;

    _patternLock = Auth.createPatternLock(canvas, dots, {
      onPattern: async (arr) => {
        const ok = await Auth.checkPattern(arr);
        if (ok) {
          _patternLock.setConfirmed(true);
          msgEl.textContent = 'Unlocked ✓'; msgEl.className = 'pattern-msg success';
          setTimeout(() => _loadDashboard(), 400);
        } else {
          _patternLock.setConfirmed(false);
          _attempts++;
          msgEl.textContent = `Incorrect pattern (${_attempts})`;
          msgEl.className   = 'pattern-msg error';
          if (_attempts >= 5) forgotBtn.style.display = 'block';
        }
      },
      onTooShort: () => { msgEl.textContent = 'Connect at least 4 dots'; msgEl.className = 'pattern-msg error'; }
    });

    forgotBtn.addEventListener('click', async () => {
      if (confirm('This will DELETE all data and reset the app. Are you sure?')) {
        await DB.clearAll();
        location.reload();
      }
    });
  }

  /* ══════════════════════════════════════════════════
     DASHBOARD LOAD + WIRE
  ══════════════════════════════════════════════════ */
  async function _loadDashboard() {
    UI.showScreen('screen-dashboard');
    await UI.renderDashboard();

    _wireButtons();
    _wireFilters();
    _wireModals();
    _startPolling();

    // Check if first run (no emails yet fetched)
    const lastCheck = await DB.getConfig('lastEmailCheck');
    if (!lastCheck) {
      UI.toast('First run! Fetching last 30 days of emails…', 'info', 6000);
      await syncEmails();
    } else {
      const elapsed = Date.now() - lastCheck;
      const pollMin = (await DB.getConfig('pollIntervalMin')) || 10;
      if (elapsed > pollMin * 60 * 1000) await syncEmails();
    }
  }

  /* ══════════════════════════════════════════════════
     EVENT WIRING
  ══════════════════════════════════════════════════ */
  function _wireButtons() {
    document.getElementById('btnSyncNow').addEventListener('click', () => syncEmails());

    document.getElementById('btnToggleSearch').addEventListener('click', () => {
      const bar = document.getElementById('searchBar');
      const btn = document.getElementById('btnToggleSearch');
      bar.classList.toggle('hidden');
      btn.classList.toggle('active');
      if (!bar.classList.contains('hidden')) document.getElementById('searchInput').focus();
    });

    document.getElementById('btnAddTask').addEventListener('click', () => UI.showAddTask());
    document.getElementById('btnOpenSettings').addEventListener('click', () => UI.openSettings());

    document.getElementById('btnSaveTask').addEventListener('click', _saveTask);

    // Settings modal buttons
    document.getElementById('btnSaveSettings').addEventListener('click', async () => {
      const ak = document.getElementById('settingsAnthropicKey').value.trim();
      const gk = document.getElementById('settingsGoogleClientId').value.trim();
      if (ak) await DB.setConfig('anthropicKey', ak);
      if (gk) await DB.setConfig('googleClientId', gk);
      UI.toast('Settings saved.', 'success');
    });

    document.getElementById('btnSavePoll').addEventListener('click', async () => {
      const v = parseInt(document.getElementById('settingsPollInterval').value, 10);
      if (v >= 5 && v <= 60) {
        await DB.setConfig('pollIntervalMin', v);
        _startPolling();
        UI.toast(`Polling interval set to ${v} min.`, 'success');
      }
    });

    document.getElementById('btnReconnectGmail').addEventListener('click', async () => {
      try {
        await Auth.googleAuth();
        UI.toast('Gmail reconnected.', 'success');
        await UI.openSettings();
      } catch (err) { UI.toast(err.message, 'error'); }
    });

    document.getElementById('btnChangePattern').addEventListener('click', () => {
      closeModal('modalSettings');
      _openChangePattern();
    });

    document.getElementById('btnExportData').addEventListener('click', _exportData);
    document.getElementById('btnImportData').addEventListener('click', () => document.getElementById('importFileInput').click());
    document.getElementById('importFileInput').addEventListener('change', _importData);

    document.getElementById('btnResetAll').addEventListener('click', async () => {
      if (confirm('Delete ALL data and log out? This cannot be undone.')) {
        await DB.clearAll();
        Auth.clearToken();
        location.reload();
      }
    });
  }

  function _wireFilters() {
    const update = () => {
      _currentFilters = {
        query:    document.getElementById('searchInput').value,
        status:   document.getElementById('filterStatus').value,
        priority: document.getElementById('filterPriority').value,
        assignee: document.getElementById('filterAssignee').value,
        clientId: document.getElementById('filterClient').value
      };
      UI.renderDashboard(_currentFilters);
    };
    document.getElementById('searchInput').addEventListener('input', update);
    document.getElementById('filterStatus').addEventListener('change', update);
    document.getElementById('filterPriority').addEventListener('change', update);
    document.getElementById('filterAssignee').addEventListener('change', update);
    document.getElementById('filterClient').addEventListener('change', update);
  }

  function _wireModals() {
    // Enter key on task form
    document.getElementById('taskTitle').addEventListener('keydown', e => { if (e.key === 'Enter') _saveTask(); });
  }

  /* ══════════════════════════════════════════════════
     TASK ACTIONS  (called from UI cards)
  ══════════════════════════════════════════════════ */
  async function toggleTask(id) {
    const task = await DB.get('tasks', id);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    await Tasks.setStatus(id, newStatus);
    UI.toast(newStatus === 'completed' ? 'Task completed ✓' : 'Task moved back to pending', 'success');
    await UI.renderDashboard(_currentFilters);
  }

  async function cyclePriority(id) {
    const task  = await DB.get('tasks', id);
    if (!task) return;
    const order = ['urgent', 'medium', 'low'];
    const next  = order[(order.indexOf(task.priority) + 1) % order.length];
    await Tasks.setPriority(id, next);
    await UI.renderDashboard(_currentFilters);
  }

  async function promptAssign(id) {
    const task = await DB.get('tasks', id);
    if (!task) return;
    const name = prompt('Assign to:', task.assignee || '');
    if (name === null) return;
    await Tasks.setAssignee(id, name.trim());
    await UI.renderDashboard(_currentFilters);
  }

  async function _saveTask() {
    const id          = document.getElementById('editTaskId').value;
    const clientName  = document.getElementById('taskClient').value.trim();
    const title       = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const priority    = document.getElementById('taskPriority').value;
    const dueDate     = document.getElementById('taskDueDate').value || null;
    const assignee    = document.getElementById('taskAssignee').value.trim();
    const actionables = document.getElementById('taskActionables').value
      .split('\n').map(l => l.trim()).filter(Boolean);

    if (!title) { UI.toast('Task title is required.', 'error'); return; }
    if (!clientName) { UI.toast('Client name is required.', 'error'); return; }

    if (id) {
      await Tasks.updateTask(parseInt(id, 10), { clientName, title, description, priority, dueDate, assignee, actionables });
      UI.toast('Task updated.', 'success');
    } else {
      await Tasks.createTask({ clientName, title, description, priority, dueDate, assignee, actionables });
      UI.toast('Task created.', 'success');
    }

    closeModal('modalAddTask');
    await UI.renderDashboard(_currentFilters);
  }

  /* ══════════════════════════════════════════════════
     EMAIL SYNC
  ══════════════════════════════════════════════════ */
  let _syncing = false;

  async function syncEmails() {
    if (_syncing) return;
    _syncing = true;
    const syncBtn = document.getElementById('btnSyncNow');
    syncBtn.disabled = true;
    UI.setSyncState(true, 'Fetching emails…', 0);

    try {
      const threads = await Gmail.fetchNewEmails((done, total) => {
        const pct = Math.round((done / total) * 80);
        UI.setSyncState(true, `Processing ${done}/${total} threads…`, pct);
      });

      if (!threads.length) {
        UI.setSyncState(false);
        UI.toast('All up to date.', 'info');
        return;
      }

      UI.setSyncState(true, `Analysing ${threads.length} thread(s) with AI…`, 82);

      let processed = 0;
      for (const { threadId, messages } of threads) {
        if (!messages || !messages.length) { processed++; continue; }
        try {
          const aiResult = await AI.analyseThread(messages);
          if (aiResult && aiResult.clientName) {
            await Tasks.upsertFromEmail(threadId, aiResult, messages);
          }
        } catch (err) {
          console.warn('AI error for thread', threadId, err);
        }
        processed++;
        const pct = 82 + Math.round((processed / threads.length) * 16);
        UI.setSyncState(true, `AI analysed ${processed}/${threads.length}…`, pct);
        if (processed % 3 === 0) await new Promise(r => setTimeout(r, 200));
      }

      UI.setSyncState(true, 'Rendering…', 99);
      await UI.renderDashboard(_currentFilters);
      UI.setSyncState(false);
      UI.toast(`Sync complete — ${threads.length} thread(s) processed.`, 'success');

    } catch (err) {
      UI.setSyncState(false);
      console.error('Sync error:', err);
      UI.toast(err.message, 'error', 6000);
    } finally {
      _syncing = false;
      syncBtn.disabled = false;
    }
  }

  /* ══════════════════════════════════════════════════
     POLLING
  ══════════════════════════════════════════════════ */
  async function _startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    const pollMin = (await DB.getConfig('pollIntervalMin')) || 10;
    _pollTimer = setInterval(() => syncEmails(), pollMin * 60 * 1000);
  }

  /* ══════════════════════════════════════════════════
     CHANGE PATTERN
  ══════════════════════════════════════════════════ */
  function _openChangePattern() {
    let _pending = null;
    const canvas  = document.getElementById('changePatternCanvas');
    const dots    = document.getElementById('changePatternDots');
    const msgEl   = document.getElementById('changePatternMsg');
    const btn     = document.getElementById('btnConfirmChangePattern');
    const title   = document.getElementById('changePatternTitle');

    title.textContent = 'Draw New Pattern';
    msgEl.textContent = 'Draw your new pattern';
    btn.disabled = true;
    if (_changePat) _changePat.reset();

    _changePat = Auth.createPatternLock(canvas, dots, {
      onPattern: async (arr) => {
        if (!_pending) {
          _pending = arr;
          msgEl.textContent = 'Draw again to confirm'; msgEl.className = 'pattern-msg';
          title.textContent = 'Confirm Pattern';
        } else {
          const h1 = await Auth.hashPattern(_pending);
          const h2 = await Auth.hashPattern(arr);
          if (h1 === h2) {
            await Auth.savePattern(arr);
            _changePat.setConfirmed(true);
            msgEl.textContent = 'Pattern changed! ✓'; msgEl.className = 'pattern-msg success';
            btn.disabled = false;
          } else {
            _pending = null;
            _changePat.setConfirmed(false);
            msgEl.textContent = 'Patterns did not match.'; msgEl.className = 'pattern-msg error';
            title.textContent = 'Draw New Pattern';
          }
        }
      },
      onTooShort: () => { msgEl.textContent = 'Connect at least 4 dots'; msgEl.className = 'pattern-msg error'; }
    });

    btn.onclick = () => { closeModal('modalChangePattern'); UI.toast('Pattern updated.', 'success'); };
    openModal('modalChangePattern');
  }

  function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }

  /* ══════════════════════════════════════════════════
     DATA EXPORT / IMPORT
  ══════════════════════════════════════════════════ */
  async function _exportData() {
    const data = await DB.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `task-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast('Data exported.', 'success');
  }

  async function _importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.tasks && !data.clients) throw new Error('Invalid backup file.');
      if (!confirm(`Import ${(data.tasks||[]).length} tasks and ${(data.clients||[]).length} clients? Current data will be replaced.`)) return;
      await DB.importAll(data);
      UI.toast('Data imported successfully.', 'success');
      await UI.renderDashboard();
    } catch (err) {
      UI.toast('Import failed: ' + err.message, 'error');
    }
    e.target.value = '';
  }

  /* expose to window for inline handlers */
  return { init, toggleTask, cyclePriority, promptAssign, syncEmails };
})();

/* ══════════════════════════════════════════════════
   GLOBAL INLINE HELPERS  (used in HTML onclick)
══════════════════════════════════════════════════ */
window.openModal  = (id) => document.getElementById(id)?.classList.remove('hidden');

document.addEventListener('DOMContentLoaded', () => App.init());
