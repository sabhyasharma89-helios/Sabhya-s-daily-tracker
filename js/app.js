/* ═══════════════════════════════════════════════════════════════
   app.js — Main application orchestrator
   Exposes global `App` object used by onclick handlers in HTML
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {
  // ─── Wizard ─────────────────────────────────────────────────────
  const wizard = (() => {
    const steps  = ['step-welcome','step-github','step-employees','step-done'];
    let cur      = 0;
    let employees = [];

    function showStep(i) {
      steps.forEach((id, j) => {
        const el = document.getElementById(id);
        if (el) el.style.display = j === i ? 'block' : 'none';
      });
      cur = i;
    }

    function next() { showStep(Math.min(cur + 1, steps.length - 1)); }
    function back() { showStep(Math.max(cur - 1, 0)); }

    async function saveGitHub() {
      const owner  = document.getElementById('cfg-gh-owner').value.trim();
      const repo   = document.getElementById('cfg-gh-repo').value.trim();
      const branch = document.getElementById('cfg-gh-branch').value.trim() || 'main';
      const token  = document.getElementById('cfg-gh-token').value.trim();
      if (!owner || !repo) { ui.toast('Please fill in owner and repo.', 'error'); return; }
      await DB.patchConfig({ ghOwner: owner, ghRepo: repo, ghBranch: branch });
      if (token) await Sync.saveToken(token);
      next();
    }

    function addEmployee() {
      const nameEl  = document.getElementById('emp-name-input');
      const emailEl = document.getElementById('emp-email-input');
      const name    = nameEl.value.trim();
      if (!name) return;
      employees.push({ id: DB.newId('emp'), name, email: emailEl.value.trim() });
      nameEl.value = ''; emailEl.value = '';
      ui.renderSetupEmployeeList(employees);
    }

    function removeEmployee(i) {
      employees.splice(i, 1);
      ui.renderSetupEmployeeList(employees);
    }

    async function finish() {
      if (employees.length) await DB.patchUserData({ employees });
      document.getElementById('setup-wizard').style.display = 'none';
      document.getElementById('app').style.display    = 'block';
      localStorage.setItem('tracker_setup_done', '1');
      await ui.refreshAll();
      Sync.startPolling();
    }

    function open() {
      employees = [];
      showStep(0);
      document.getElementById('setup-wizard').style.display = 'flex';
    }

    return { next, back, saveGitHub, addEmployee, removeEmployee, finish, open };
  })();

  // ─── Auth flow ──────────────────────────────────────────────────
  const auth = (() => {
    async function run() {
      Auth.init();
      const { hash } = await Auth.prompt();
      document.getElementById('auth-overlay').style.display = 'none';
      const setupDone = localStorage.getItem('tracker_setup_done');
      if (!setupDone) {
        wizard.open();
      } else {
        document.getElementById('app').style.display = 'block';
        await ui.refreshAll();
        Sync.startPolling();
      }
    }

    async function startChangePattern() {
      ui.closeSettings();
      const result = await Auth.startChangePattern();
      if (result && result.success) {
        // Re-encrypt token with new pattern hash
        const cfg = await DB.getConfig();
        if (cfg.ghTokenCipher) {
          // We can't decrypt with old key since it's already changed — warn user
          ui.toast('Pattern changed. Please re-enter your GitHub token in Settings.', 'error');
          await DB.patchConfig({ ghTokenCipher: null });
        } else {
          ui.toast('Pattern updated successfully.', 'success');
        }
        // Return to app
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        await ui.refreshAll();
      }
    }

    return { run, startChangePattern };
  })();

  // ─── Task operations ────────────────────────────────────────────
  const tasks = (() => {
    async function saveFromModal() {
      const id         = document.getElementById('task-modal-id').value;
      const title      = document.getElementById('task-title-input').value.trim();
      const clientName = document.getElementById('task-client-input').value.trim();
      const priority   = document.getElementById('task-priority-input').value;
      const assignedTo = document.getElementById('task-assignee-input').value;
      const summary    = document.getElementById('task-summary-input').value.trim();
      const actRaw     = document.getElementById('task-actionables-input').value.trim();
      const nextStep   = document.getElementById('task-nextstep-input').value.trim();

      if (!title || !clientName) {
        ui.toast('Title and Client are required.', 'error'); return;
      }

      const actionables = actRaw ? actRaw.split('\n').map(l => l.trim()).filter(Boolean) : [];
      const now = new Date().toISOString();

      if (id) {
        // Edit existing
        const existing = await DB.getTask(id);
        const updated  = Object.assign({}, existing, {
          title, clientName, priority, assignedTo: assignedTo || null,
          summary, actionables, nextStepPerson: nextStep,
          updatedAt: now, _userEdited: true
        });
        await DB.saveTask(updated);
        // Also save override in user_data
        const ud = await DB.getUserData();
        ud.taskOverrides = ud.taskOverrides || {};
        ud.taskOverrides[id] = { priority, assignedTo: assignedTo || null, status: existing.status };
        await DB.saveUserData(ud);
      } else {
        // New task
        const newTask = {
          id:               DB.newId('task'),
          clientId:         clientName.toLowerCase().replace(/\W/g,'_'),
          clientName,
          title,
          priority,
          status:           'pending',
          assignedTo:       assignedTo || null,
          emailThreadId:    null,
          emailMessageIds:  [],
          summary,
          actionables,
          nextStepPerson:   nextStep,
          conversationHistory: [],
          createdAt:        now,
          updatedAt:        now,
          completedAt:      null,
          source:           'manual',
          _userEdited:      true
        };
        await DB.saveTask(newTask);
      }

      ui.closeTaskModal();
      await ui.refreshAll();
      Sync.pushUserData();
      ui.toast(id ? 'Task updated.' : 'Task created.', 'success');
    }

    async function toggleComplete(event, id) {
      event.stopPropagation();
      const task = await DB.getTask(id);
      if (!task) return;
      const now  = new Date().toISOString();
      const newStatus = task.status === 'completed' ? 'pending' : 'completed';
      const updated = Object.assign({}, task, {
        status:      newStatus,
        completedAt: newStatus === 'completed' ? now : null,
        updatedAt:   now,
        _userEdited: true
      });
      await DB.saveTask(updated);

      // Save override
      const ud = await DB.getUserData();
      ud.taskOverrides = ud.taskOverrides || {};
      ud.taskOverrides[id] = Object.assign({}, ud.taskOverrides[id] || {}, { status: newStatus });
      await DB.saveUserData(ud);

      await ui.refreshAll();
      Sync.pushUserData();
      ui.toast(newStatus === 'completed' ? '✅ Marked complete' : '↩ Moved back to pending');
    }

    async function toggleCompleteFromDetail() {
      const id = ui.getCurrentDetailId();
      if (!id) return;
      await toggleComplete({ stopPropagation: ()=>{} }, id);
      ui.closeDetailModal();
    }

    async function editCurrent() {
      const id = ui.getCurrentDetailId();
      if (!id) return;
      const task = await DB.getTask(id);
      ui.closeDetailModal();
      ui.openEditTask(task);
    }

    async function changePriorityFromDetail(priority) {
      const id = ui.getCurrentDetailId();
      if (!id) return;
      const task = await DB.getTask(id);
      const updated = Object.assign({}, task, { priority, updatedAt: new Date().toISOString(), _userEdited: true });
      await DB.saveTask(updated);
      const ud = await DB.getUserData();
      ud.taskOverrides = ud.taskOverrides || {};
      ud.taskOverrides[id] = Object.assign({}, ud.taskOverrides[id]||{}, { priority });
      await DB.saveUserData(ud);
      await ui.refreshAll();
      Sync.pushUserData();
      ui.toast('Priority updated.');
    }

    async function changeAssigneeFromDetail(assignedTo) {
      const id = ui.getCurrentDetailId();
      if (!id) return;
      const task = await DB.getTask(id);
      const updated = Object.assign({}, task, {
        assignedTo: assignedTo || null,
        updatedAt: new Date().toISOString(),
        _userEdited: true
      });
      await DB.saveTask(updated);
      const ud = await DB.getUserData();
      ud.taskOverrides = ud.taskOverrides || {};
      ud.taskOverrides[id] = Object.assign({}, ud.taskOverrides[id]||{}, { assignedTo: assignedTo || null });
      await DB.saveUserData(ud);
      // Refresh assignee display in detail modal
      const assigneeEl = document.getElementById('detail-assignee');
      if (assigneeEl) {
        assigneeEl.textContent = assignedTo ? `👤 ${assignedTo}` : '';
        assigneeEl.style.display = assignedTo ? 'inline' : 'none';
      }
      await ui.refreshAll();
      Sync.pushUserData();
      ui.toast('Assignee updated.');
    }

    return {
      saveFromModal, toggleComplete, toggleCompleteFromDetail,
      editCurrent, changePriorityFromDetail, changeAssigneeFromDetail
    };
  })();

  // ─── Employee management ────────────────────────────────────────
  const employees = (() => {
    async function addFromSettings() {
      const name  = document.getElementById('set-emp-name').value.trim();
      const email = document.getElementById('set-emp-email').value.trim();
      if (!name) return;
      const ud  = await DB.getUserData();
      const emp = ud.employees || [];
      if (emp.find(e => e.name === name)) { ui.toast('Employee already exists.', 'error'); return; }
      emp.push({ id: DB.newId('emp'), name, email });
      await DB.patchUserData({ employees: emp });
      document.getElementById('set-emp-name').value  = '';
      document.getElementById('set-emp-email').value = '';
      ui.renderEmployeeList(emp, 'employee-list-settings', 'App.employees.removeFromSettings');
      ui.toast('Team member added.');
    }

    async function removeFromSettings(i) {
      const ud  = await DB.getUserData();
      const emp = ud.employees || [];
      emp.splice(i, 1);
      await DB.patchUserData({ employees: emp });
      ui.renderEmployeeList(emp, 'employee-list-settings', 'App.employees.removeFromSettings');
    }

    return { addFromSettings, removeFromSettings };
  })();

  // ─── Settings save ───────────────────────────────────────────────
  const settings = (() => {
    async function save() {
      const owner  = document.getElementById('set-gh-owner').value.trim();
      const repo   = document.getElementById('set-gh-repo').value.trim();
      const branch = document.getElementById('set-gh-branch').value.trim() || 'main';
      const token  = document.getElementById('set-gh-token').value.trim();

      await DB.patchConfig({ ghOwner: owner, ghRepo: repo, ghBranch: branch });
      if (token) await Sync.saveToken(token);

      ui.closeSettings();
      ui.toast('Settings saved.', 'success');
      Sync.startPolling(); // restart polling with new config
    }
    return { save };
  })();

  // ─── Lock screen ─────────────────────────────────────────────────
  function lock() {
    Sync.stopPolling();
    document.getElementById('app').style.display         = 'none';
    document.getElementById('auth-overlay').style.display = 'flex';
    auth.run();
  }

  // ─── Global keyboard handler ─────────────────────────────────────
  function initKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.getElementById('task-modal').style.display   = 'none';
        document.getElementById('detail-modal').style.display = 'none';
        document.getElementById('settings-modal').style.display = 'none';
        document.getElementById('setup-wizard').style.display   = 'none';
      }
    });
    // Close modal on backdrop click
    ['task-modal','detail-modal','settings-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
    });
  }

  // ─── Bootstrap ──────────────────────────────────────────────────
  async function boot() {
    await DB.open();
    initKeyboard();
    auth.run();
  }

  // Public surface
  return { auth, wizard, tasks, employees, settings, ui: UI, sync: Sync, lock };
})();

// Boot on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => App.auth.run().catch(console.error));
