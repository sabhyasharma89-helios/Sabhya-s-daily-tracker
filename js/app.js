/* ═══════════════════════════════════════════════════════════
   APP.JS — Main Orchestrator
   Waits for firebase-ready, then initialises everything.
═══════════════════════════════════════════════════════════ */

(function () {
  // ── STATE ──────────────────────────────────────────────────
  const state = {
    tasks:          [],
    clients:        [],
    employees:      [],
    activeClientId: 'all',
    activeFilter:   'all',
    searchQuery:    '',
    employeeFilter: '',
    unsubTasks:     null,
    unsubClients:   null,
    unsubEmployees: null,
    currentTask:    null,
    closeMobileSidebar: null,
  };

  // ── BOOT ───────────────────────────────────────────────────
  function boot() {
    Auth.init(onAuthSuccess);
    document.getElementById('lock-btn').addEventListener('click', () => Auth.lock());
  }

  function onAuthSuccess() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    // Wait for Firebase to be ready
    if (window._firebase) {
      initApp();
    } else {
      window.addEventListener('firebase-ready', initApp, { once: true });
      // Timeout fallback: show offline message
      setTimeout(() => {
        if (!window._firebase) {
          UI.toast('Firebase not configured. See setup.html', 'error', 8000);
          UI.setSyncStatus('error', 'Not configured');
        }
      }, 5000);
    }
  }

  function initApp() {
    UI.setSyncStatus('syncing', 'Connecting…');
    state.closeMobileSidebar = UI.setupMobileSidebar();

    // Wire all event listeners
    wireNavbar();
    wireSidebar();
    wireModals();
    wireFilters();

    // Subscribe to real-time data
    subscribeAll();

    UI.setSyncStatus('ok', 'Live');
  }

  // ── REAL-TIME SUBSCRIPTIONS ────────────────────────────────
  function subscribeAll() {
    // Tasks
    if (state.unsubTasks) state.unsubTasks();
    state.unsubTasks = DB.subscribeToTasks(tasks => {
      state.tasks = tasks;
      render();
    });

    // Clients
    if (state.unsubClients) state.unsubClients();
    state.unsubClients = DB.subscribeToClients(clients => {
      state.clients = clients;
      render();
    });

    // Employees
    if (state.unsubEmployees) state.unsubEmployees();
    state.unsubEmployees = DB.subscribeToEmployees(employees => {
      state.employees = employees;
      UI.populateEmployeeSelects(employees);
    });
  }

  // ── MASTER RENDER ──────────────────────────────────────────
  function render() {
    const stats = DB.computeStats(state.tasks);
    UI.updateStats(stats);

    UI.renderClientList(
      state.clients,
      state.tasks,
      state.activeClientId,
      (clientId, clientName) => {
        state.activeClientId = clientId;
        UI.setContentTitle(clientName);
        if (state.closeMobileSidebar) state.closeMobileSidebar();
        render();
      }
    );

    UI.renderTasks(
      state.tasks,
      state.clients,
      state.activeClientId,
      state.activeFilter,
      state.searchQuery,
      state.employeeFilter,
      onTaskClick,
      onToggleComplete
    );
  }

  // ── TASK INTERACTIONS ──────────────────────────────────────
  function onTaskClick(task) {
    state.currentTask = task;
    UI.openTaskModal(task, state.employees);
  }

  async function onToggleComplete(taskId, currentStatus) {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    try {
      await DB.updateTask(taskId, { status: newStatus });
      UI.toast(newStatus === 'completed' ? 'Task marked complete' : 'Task moved back to pending', 'success');
    } catch (e) {
      UI.toast('Failed to update task', 'error');
    }
  }

  // ── NAVBAR ─────────────────────────────────────────────────
  function wireNavbar() {
    document.getElementById('refresh-btn').addEventListener('click', async () => {
      UI.setSyncStatus('syncing', 'Syncing…');
      UI.toast('Manual sync triggered', 'info');
      // Trigger GitHub Actions via repository_dispatch if desired
      // For now just re-subscribe
      setTimeout(() => UI.setSyncStatus('ok', 'Live'), 1500);
    });
  }

  // ── SIDEBAR ────────────────────────────────────────────────
  function wireSidebar() {
    // Search
    const searchInput = document.getElementById('search-input');
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchQuery = searchInput.value.trim();
        render();
      }, 300);
    });

    // Employee filter dropdown
    document.getElementById('employee-filter').addEventListener('change', e => {
      state.employeeFilter = e.target.value;
      render();
    });

    // Add client button → open employee modal as entry point or add client modal
    document.getElementById('add-client-btn').addEventListener('click', () => {
      UI.openAddClientModal();
    });
  }

  // ── FILTER CHIPS ───────────────────────────────────────────
  function wireFilters() {
    document.querySelectorAll('.filter-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.activeFilter = chip.dataset.filter;
        UI.setActiveFilter(state.activeFilter);
        render();
      });
    });
  }

  // ── MODALS ─────────────────────────────────────────────────
  function wireModals() {
    wireTaskModal();
    wireAddTaskModal();
    wireAddClientModal();
  }

  // Task Detail Modal
  function wireTaskModal() {
    document.getElementById('task-modal-close').addEventListener('click',  UI.closeTaskModal);
    document.getElementById('task-modal-cancel').addEventListener('click', UI.closeTaskModal);
    document.getElementById('task-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('task-modal-overlay')) UI.closeTaskModal();
    });

    document.getElementById('task-modal-save').addEventListener('click', async () => {
      const taskId = document.getElementById('task-modal-overlay').dataset.taskId;
      if (!taskId) return;

      const priority   = document.getElementById('modal-priority-select').value;
      const assignedTo = document.getElementById('modal-assign-select').value;
      const status     = document.getElementById('modal-status-toggle').checked ? 'completed' : 'pending';

      try {
        await DB.updateTask(taskId, { priority, assignedTo, status });
        UI.closeTaskModal();
        UI.toast('Task updated', 'success');
      } catch (e) {
        UI.toast('Failed to save changes', 'error');
      }
    });
  }

  // Add Task Modal
  function wireAddTaskModal() {
    document.getElementById('add-task-btn').addEventListener('click', () => {
      UI.openAddTaskModal(state.employees);
    });
    document.getElementById('add-task-modal-close').addEventListener('click',  UI.closeAddTaskModal);
    document.getElementById('add-task-modal-cancel').addEventListener('click', UI.closeAddTaskModal);
    document.getElementById('add-task-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('add-task-modal-overlay')) UI.closeAddTaskModal();
    });

    document.getElementById('add-task-save').addEventListener('click', async () => {
      const clientName = document.getElementById('new-client').value.trim();
      const title      = document.getElementById('new-title').value.trim();
      if (!clientName || !title) {
        UI.toast('Client name and title are required', 'error');
        return;
      }

      const actionablesRaw = document.getElementById('new-actionables').value.trim();
      const actionables    = actionablesRaw ? actionablesRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];

      try {
        // Ensure client exists
        const clientId = await DB.upsertClient(clientName);

        await DB.createTask({
          title,
          clientName,
          clientId,
          summary:     document.getElementById('new-summary').value.trim(),
          actionables,
          responsible: document.getElementById('new-responsible').value.trim(),
          priority:    document.getElementById('new-priority').value,
          assignedTo:  document.getElementById('new-assign').value,
          source:      'manual',
        });

        UI.closeAddTaskModal();
        UI.toast('Task added', 'success');
      } catch (e) {
        console.error(e);
        UI.toast('Failed to add task', 'error');
      }
    });
  }

  // Add Client Modal
  function wireAddClientModal() {
    document.getElementById('add-client-modal-close').addEventListener('click',  UI.closeAddClientModal);
    document.getElementById('add-client-cancel').addEventListener('click', UI.closeAddClientModal);
    document.getElementById('add-client-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('add-client-modal-overlay')) UI.closeAddClientModal();
    });

    document.getElementById('add-client-save').addEventListener('click', async () => {
      const name  = document.getElementById('client-name-input').value.trim();
      const color = document.getElementById('client-color-input').value;
      if (!name) { UI.toast('Enter a client name', 'error'); return; }
      try {
        await DB.upsertClient(name, color);
        UI.closeAddClientModal();
        UI.toast(`Client "${name}" added`, 'success');
      } catch (e) {
        UI.toast('Failed to add client', 'error');
      }
    });

    // Employee management from Add Task modal (manage employees button hidden in nav)
    // Wire manage employees via footer link or accessible from somewhere
    wireEmployeeModal();
  }

  // Employee Modal (triggered from a link in add-task modal or settings)
  function wireEmployeeModal() {
    // Add a "Manage Team" link into the sidebar bottom
    const sidebarSection = document.querySelector('.sidebar');
    const link = document.createElement('div');
    link.style.cssText = 'padding:12px 16px;border-top:1px solid var(--border);margin-top:auto;';
    link.innerHTML = `<button class="btn-ghost" style="width:100%;font-size:.82rem;padding:8px" id="manage-team-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:6px">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      Manage Team
    </button>`;
    sidebarSection.appendChild(link);

    document.getElementById('manage-team-btn').addEventListener('click', () => {
      UI.openEmployeeModal(state.employees, async (empId) => {
        try {
          await DB.deleteEmployee(empId);
          UI.toast('Employee removed', 'info');
          UI.renderEmployeeList(state.employees, async (id) => {
            await DB.deleteEmployee(id);
          });
        } catch (e) {
          UI.toast('Failed to remove employee', 'error');
        }
      });
    });

    document.getElementById('add-employee-modal-close').addEventListener('click', UI.closeEmployeeModal);
    document.getElementById('add-employee-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('add-employee-modal-overlay')) UI.closeEmployeeModal();
    });

    document.getElementById('save-employee-btn').addEventListener('click', async () => {
      const name  = document.getElementById('emp-name').value.trim();
      const email = document.getElementById('emp-email').value.trim();
      if (!name) { UI.toast('Enter employee name', 'error'); return; }
      try {
        await DB.addEmployee(name, email);
        document.getElementById('emp-name').value  = '';
        document.getElementById('emp-email').value = '';
        UI.toast(`${name} added to team`, 'success');
        UI.renderEmployeeList(state.employees, async (id) => {
          await DB.deleteEmployee(id);
          UI.renderEmployeeList(state.employees, () => {});
        });
      } catch (e) {
        UI.toast('Failed to add employee', 'error');
      }
    });
  }

  // ── KICK OFF ───────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', boot);
})();
