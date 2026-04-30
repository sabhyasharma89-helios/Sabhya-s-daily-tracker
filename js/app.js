/**
 * App — main controller. Wires together PatternLock, TaskDB, and UI.
 */
const App = (() => {

  const state = {
    data: null,
    filters: {
      client: '__all__',
      status: 'all',
      priority: 'all',
      employee: 'all',
      stat: null,
      search: ''
    },
    setupPatternFirst: null,  // stores first-draw during setup confirm
    setupStep: 1,
    saving: false
  };

  let lockCanvas, setupCanvas, lockPattern, setupPattern;

  /* ============================================================
     BOOT
     ============================================================ */

  async function init() {
    _bindModalBackdrops();
    _bindCloseButtons();

    const hasConfig = !!TaskDB.getConfig();
    const hasPattern = !!TaskDB.getPatternHash();

    if (!hasConfig) {
      _showSetupStep('github');
    } else if (!hasPattern) {
      _showSetupStep('pattern');
    } else {
      _showLockScreen();
    }
  }

  /* ============================================================
     SETUP FLOW
     ============================================================ */

  function _showSetupStep(step) {
    UI.showScreen('setup-screen');

    document.querySelectorAll('.setup-step').forEach(el => el.classList.remove('active'));

    if (step === 'github') {
      document.getElementById('setup-github').classList.add('active');
      _bindSetupGitHub();
    } else if (step === 'pattern') {
      document.getElementById('setup-pattern-step').classList.add('active');
      _initSetupPattern();
    }
  }

  function _bindSetupGitHub() {
    const form = document.getElementById('github-config-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const owner = document.getElementById('setup-owner').value.trim();
      const repo = document.getElementById('setup-repo').value.trim();
      const token = document.getElementById('setup-token').value.trim();
      const branch = document.getElementById('setup-branch').value.trim() || 'main';

      if (!owner || !repo || !token) {
        UI.toast('Please fill all required fields', 'error');
        return;
      }

      TaskDB.saveConfig({ owner, repo, token, branch });
      _showSetupStep('pattern');
    };
  }

  function _initSetupPattern() {
    if (!setupCanvas) {
      setupCanvas = document.getElementById('setup-pattern-canvas');
      _sizeCanvas(setupCanvas);
    }

    state.setupPatternFirst = null;
    document.getElementById('setup-pattern-title').textContent = 'Create Your Lock Pattern';
    document.getElementById('setup-pattern-instruction').textContent =
      'Draw a pattern connecting at least 4 dots. Remember this — it protects your dashboard.';
    document.getElementById('setup-pattern-message').textContent = '';
    document.getElementById('setup-pattern-message').className = 'lock-message';

    setupPattern = new PatternLock(setupCanvas, {
      minDots: 4,
      onComplete: async (pattern) => {
        if (!state.setupPatternFirst) {
          // First draw — ask for confirmation
          state.setupPatternFirst = pattern;
          document.getElementById('setup-pattern-title').textContent = 'Confirm Your Pattern';
          document.getElementById('setup-pattern-instruction').textContent = 'Draw the same pattern again to confirm.';
          _showSetupMsg('Pattern recorded. Draw again to confirm.', 'info');
          setupPattern.reset();
        } else {
          // Second draw — compare
          if (JSON.stringify(pattern) === JSON.stringify(state.setupPatternFirst)) {
            const hash = await PatternLock.hash(pattern);
            TaskDB.savePatternHash(hash);
            _showSetupMsg('Pattern set! Loading…', 'success');
            setTimeout(() => _loadDashboard(), 700);
          } else {
            _showSetupMsg('Patterns did not match. Try again.', 'error');
            state.setupPatternFirst = null;
            document.getElementById('setup-pattern-title').textContent = 'Create Your Lock Pattern';
            document.getElementById('setup-pattern-instruction').textContent = 'Draw a pattern connecting at least 4 dots.';
            setupPattern.reset();
          }
        }
      }
    }).onError(msg => _showSetupMsg(msg, 'error'));

    document.getElementById('setup-back-btn').onclick = () => _showSetupStep('github');
  }

  function _showSetupMsg(msg, type) {
    const el = document.getElementById('setup-pattern-message');
    el.textContent = msg;
    el.className = 'lock-message ' + type;
  }

  /* ============================================================
     LOCK SCREEN
     ============================================================ */

  function _showLockScreen() {
    UI.showScreen('lock-screen');

    if (!lockCanvas) {
      lockCanvas = document.getElementById('pattern-canvas');
      _sizeCanvas(lockCanvas);
    }

    document.getElementById('lock-message').textContent = '';
    document.getElementById('lock-message').className = 'lock-message';
    document.getElementById('lock-subtitle').textContent = 'Draw your pattern to unlock';

    lockPattern = new PatternLock(lockCanvas, {
      minDots: 4,
      onComplete: async (pattern) => {
        const hash = await PatternLock.hash(pattern);
        const stored = TaskDB.getPatternHash();

        if (hash === stored) {
          _showLockMsg('Unlocking…', 'success');
          setTimeout(() => _loadDashboard(), 400);
        } else {
          _showLockMsg('Incorrect pattern. Try again.', 'error');
          lockPattern.reset();
        }
      }
    }).onError(msg => _showLockMsg(msg, 'error'));

    document.getElementById('forgot-pattern-btn').onclick = () => {
      UI.openModal('reset-modal');
    };

    document.getElementById('confirm-reset-btn').onclick = () => {
      TaskDB.clearPattern();
      UI.closeModal('reset-modal');
      _showSetupStep('pattern');
    };
  }

  function _showLockMsg(msg, type) {
    const el = document.getElementById('lock-message');
    el.textContent = msg;
    el.className = 'lock-message ' + type;
  }

  /* ============================================================
     DASHBOARD
     ============================================================ */

  async function _loadDashboard() {
    UI.showScreen('dashboard');
    UI.setSyncStatus('syncing', 'Loading…');

    try {
      state.data = await TaskDB.load();
      _render();
      UI.setSyncStatus('synced', 'Synced');
    } catch (e) {
      UI.setSyncStatus('error', 'Offline');
      UI.toast('Could not load from GitHub — showing cached data', 'warning');
      state.data = TaskDB.getCached() || { metadata: {}, employees: [], clients: {} };
      _render();
    }

    _bindDashboard();
  }

  function _render() {
    if (!state.data) return;
    UI.updateStats(state.data, state.filters);
    UI.renderTabs(state.data, state.filters.client, _onTabSelect, _onTabReorder);
    UI.renderTasks(state.data, state.filters, _onTaskAction);
    UI.updateFilterEmployeeDropdown(state.data);
  }

  function _bindDashboard() {
    // Lock
    document.getElementById('lock-btn').onclick = () => {
      UI.closeAllModals();
      _showLockScreen();
    };

    // Sync
    document.getElementById('sync-btn').onclick = async () => {
      UI.setSyncStatus('syncing', 'Syncing…');
      try {
        state.data = await TaskDB.load();
        _render();
        UI.setSyncStatus('synced', 'Synced');
        UI.toast('Synced with GitHub', 'success');
      } catch {
        UI.setSyncStatus('error', 'Failed');
        UI.toast('Sync failed — check settings', 'error');
      }
    };

    // Add task button
    document.getElementById('add-task-btn').onclick = () => UI.openTaskForm(state.data);
    document.getElementById('add-first-task-btn')?.addEventListener('click', () => UI.openTaskForm(state.data));

    // Settings
    document.getElementById('settings-btn').onclick = () => UI.openSettings(state.data);

    // Task form submit
    document.getElementById('task-form').onsubmit = async (e) => {
      e.preventDefault();
      await _saveTaskForm();
    };

    // Filters
    document.getElementById('search-input').oninput = (e) => {
      state.filters.search = e.target.value.trim();
      document.getElementById('search-clear').classList.toggle('hidden', !state.filters.search);
      _render();
    };

    document.getElementById('search-clear').onclick = () => {
      document.getElementById('search-input').value = '';
      state.filters.search = '';
      document.getElementById('search-clear').classList.add('hidden');
      _render();
    };

    document.getElementById('filter-status').onchange = (e) => {
      state.filters.status = e.target.value;
      _render();
    };

    document.getElementById('filter-priority').onchange = (e) => {
      state.filters.priority = e.target.value;
      _render();
    };

    document.getElementById('filter-employee').onchange = (e) => {
      state.filters.employee = e.target.value;
      _render();
    };

    // Stats bar click → filter shortcut
    document.querySelectorAll('.stat-card').forEach(card => {
      card.onclick = () => {
        const stat = card.dataset.stat;
        state.filters.stat = state.filters.stat === stat ? null : stat;
        _render();
      };
    });

    // Completed toggle
    document.getElementById('completed-toggle').onclick = (e) => {
      const list = document.getElementById('completed-tasks-list');
      const btn = e.currentTarget;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      list.classList.toggle('collapsed', expanded);
      list.setAttribute('aria-hidden', String(expanded));
    };

    // Add client
    document.getElementById('add-client-btn').onclick = () => UI.openModal('add-client-modal');
    document.getElementById('save-client-btn').onclick = () => {
      const name = document.getElementById('new-client-name').value.trim();
      if (!name) { UI.toast('Enter a client name', 'error'); return; }
      if (state.data.clients[name]) { UI.toast('Client already exists', 'warning'); return; }
      TaskDB.ensureClient(state.data, name);
      UI.closeModal('add-client-modal');
      document.getElementById('new-client-name').value = '';
      _autoSave();
      _render();
      UI.toast(`Client "${name}" added`, 'success');
    };

    // Settings form
    document.getElementById('settings-github-form').onsubmit = (e) => {
      e.preventDefault();
      const cfg = {
        owner: document.getElementById('cfg-owner').value.trim(),
        repo: document.getElementById('cfg-repo').value.trim(),
        token: document.getElementById('cfg-token').value.trim(),
        branch: document.getElementById('cfg-branch').value.trim() || 'main'
      };
      TaskDB.saveConfig(cfg);
      UI.toast('GitHub config saved', 'success');
    };

    // Change pattern
    document.getElementById('change-pattern-btn').onclick = () => {
      UI.closeAllModals();
      TaskDB.clearPattern();
      _showSetupStep('pattern');
    };

    // Export
    document.getElementById('export-data-btn').onclick = () => {
      const json = JSON.stringify(state.data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tasks-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    // Force reload
    document.getElementById('force-sync-btn').onclick = async () => {
      UI.toast('Reloading from GitHub…', 'info');
      try {
        state.data = await TaskDB.load();
        _render();
        UI.toast('Reloaded successfully', 'success');
      } catch (e) {
        UI.toast('Reload failed: ' + e.message, 'error');
      }
    };

    // Add employee
    document.getElementById('add-employee-btn').onclick = () => _addEmployee();
    document.getElementById('new-employee-input').onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _addEmployee(); }
    };

    // Employee remove (delegated)
    document.getElementById('employees-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.employee-remove');
      if (!btn) return;
      const name = btn.dataset.employee;
      state.data.employees = (state.data.employees || []).filter(x => x !== name);
      UI.refreshEmployeeList(state.data);
      _autoSave();
    });
  }

  /* ============================================================
     TAB ACTIONS
     ============================================================ */

  function _onTabSelect(clientName) {
    state.filters.client = clientName;
    _render();
  }

  function _onTabReorder(fromName, toName) {
    const clients = Object.values(state.data.clients).sort((a, b) => a.order - b.order);
    const names = clients.map(c => c.name);
    const fi = names.indexOf(fromName);
    const ti = names.indexOf(toName);
    if (fi === -1 || ti === -1) return;
    names.splice(fi, 1);
    names.splice(ti, 0, fromName);
    TaskDB.reorderClients(state.data, names);
    _autoSave();
    _render();
  }

  /* ============================================================
     TASK ACTIONS
     ============================================================ */

  function _onTaskAction(action, taskId, el) {
    const task = TaskDB.getTaskById(state.data, taskId);
    if (!task && action !== 'edit') return;

    switch (action) {
      case 'expand': {
        const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
        if (card) card.classList.toggle('expanded');
        break;
      }

      case 'toggle':
        if (task.status === 'completed') {
          TaskDB.reopenTask(state.data, taskId);
          UI.toast('Task reopened', 'info');
        } else {
          TaskDB.completeTask(state.data, taskId);
          UI.toast('Task completed ✓', 'success');
        }
        _autoSave();
        _render();
        break;

      case 'complete':
        TaskDB.completeTask(state.data, taskId);
        UI.toast('Task marked complete ✓', 'success');
        _autoSave();
        UI.closeModal('detail-modal');
        _render();
        break;

      case 'reopen':
        TaskDB.reopenTask(state.data, taskId);
        UI.toast('Task reopened', 'info');
        _autoSave();
        UI.closeModal('detail-modal');
        _render();
        break;

      case 'edit':
        UI.closeModal('detail-modal');
        UI.openTaskForm(state.data, task);
        break;

      case 'delete':
        if (confirm(`Delete task "${task.title}"? This cannot be undone.`)) {
          TaskDB.deleteTask(state.data, taskId);
          _autoSave();
          UI.closeModal('detail-modal');
          UI.toast('Task deleted', 'info');
          _render();
        }
        break;

      case 'priority':
        _changePriorityInline(task, el);
        break;

      case 'assign':
        _assignInline(task, el);
        break;

      case 'detail':
        UI.openDetailModal(task, state.data, _onTaskAction);
        break;
    }
  }

  function _changePriorityInline(task, triggerEl) {
    // Simple prompt-based fallback; works everywhere
    const options = { high: '1', medium: '2', low: '3' };
    const rev = { '1': 'high', '2': 'medium', '3': 'low' };
    const choice = prompt('Change priority:\n1 = 🔴 Urgent\n2 = 🟡 Medium\n3 = 🟢 Low', options[task.priority]);
    const p = rev[choice];
    if (p && p !== task.priority) {
      TaskDB.updateTask(state.data, task.id, { priority: p });
      _autoSave();
      _render();
      UI.toast(`Priority changed to ${p}`, 'success');
    }
  }

  function _assignInline(task, triggerEl) {
    const emps = (state.data.employees || []);
    const list = emps.length ? emps.join(', ') + '\n\n' : '';
    const current = task.assignedTo || '';
    const name = prompt(`${list}Assign to (leave blank to unassign):`, current)?.trim();
    if (name === null) return; // cancelled
    if (name && emps.length && !emps.includes(name)) {
      if (confirm(`"${name}" is not in your team list. Add them?`)) {
        state.data.employees = [...(state.data.employees || []), name];
        UI.refreshEmployeeList(state.data);
      }
    }
    TaskDB.updateTask(state.data, task.id, { assignedTo: name || null });
    _autoSave();
    _render();
    UI.toast(name ? `Assigned to ${name}` : 'Unassigned', 'success');
  }

  /* ============================================================
     TASK FORM SAVE
     ============================================================ */

  async function _saveTaskForm() {
    const id = document.getElementById('edit-task-id').value;
    const title = document.getElementById('form-task-title').value.trim();
    const clientName = document.getElementById('form-task-client').value.trim();
    const priority = document.getElementById('form-task-priority').value;
    const assignedTo = document.getElementById('form-task-assigned').value.trim() || null;
    const description = document.getElementById('form-task-description').value.trim();

    if (!title) { UI.toast('Title is required', 'error'); return; }
    if (!clientName) { UI.toast('Client is required', 'error'); return; }

    if (id) {
      // Edit existing
      const originalClient = document.getElementById('edit-task-client-original').value;
      if (originalClient !== clientName) {
        // Move to new client
        const task = TaskDB.getTaskById(state.data, id);
        if (task) {
          TaskDB.deleteTask(state.data, id);
          TaskDB.addTask(state.data, { ...task, clientName, title, priority, assignedTo, description, id: undefined });
        }
      } else {
        TaskDB.updateTask(state.data, id, { title, priority, assignedTo, description });
      }
      UI.toast('Task updated', 'success');
    } else {
      // New task
      if (assignedTo && !(state.data.employees || []).includes(assignedTo)) {
        state.data.employees = [...(state.data.employees || []), assignedTo];
      }
      TaskDB.addTask(state.data, { clientName, title, priority, assignedTo, description, source: 'manual' });
      UI.toast('Task added', 'success');
    }

    UI.closeModal('task-form-modal');
    await _autoSave();
    _render();
  }

  /* ============================================================
     AUTO SAVE
     ============================================================ */

  let _saveTimer = null;

  async function _autoSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      if (state.saving) return;
      state.saving = true;
      UI.setSyncStatus('syncing', 'Saving…');
      try {
        state.data = await TaskDB.save(state.data);
        UI.setSyncStatus('synced', 'Saved');
      } catch (e) {
        UI.setSyncStatus('error', 'Save failed');
        UI.toast('Saved locally (GitHub sync failed): ' + e.message, 'warning');
      }
      state.saving = false;
    }, 800);
  }

  /* ============================================================
     EMPLOYEES
     ============================================================ */

  function _addEmployee() {
    const input = document.getElementById('new-employee-input');
    const name = input.value.trim();
    if (!name) return;
    if ((state.data.employees || []).includes(name)) {
      UI.toast('Employee already exists', 'warning');
      return;
    }
    state.data.employees = [...(state.data.employees || []), name];
    input.value = '';
    UI.refreshEmployeeList(state.data);
    _autoSave();
    UI.toast(`${name} added to team`, 'success');
  }

  /* ============================================================
     MODAL WIRING
     ============================================================ */

  function _bindModalBackdrops() {
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.onclick = () => UI.closeAllModals();
    });
  }

  function _bindCloseButtons() {
    document.querySelectorAll('.modal-close-btn[data-modal]').forEach(btn => {
      btn.onclick = () => UI.closeModal(btn.dataset.modal);
    });

    // Also close on backdrop click
    document.querySelectorAll('[data-modal]').forEach(el => {
      if (el.classList.contains('btn-secondary') || el.classList.contains('btn-link')) {
        el.addEventListener('click', () => {
          const modalId = el.dataset.modal;
          if (modalId) UI.closeModal(modalId);
        });
      }
    });
  }

  /* ============================================================
     CANVAS SIZING
     ============================================================ */

  function _sizeCanvas(canvas) {
    const size = Math.min(canvas.parentElement?.offsetWidth || 280, 280);
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
  }

  /* ============================================================
     START
     ============================================================ */

  return { init };

})();

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
