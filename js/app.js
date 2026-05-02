/**
 * Sabhya's Daily Tracker — Main App
 * Loads JSON data from /data/, renders dashboard, handles all interactions.
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────
  const state = {
    tasks: [],
    clients: [],
    employees: [],
    syncState: {},
    activeView: 'dashboard',
    activeFilter: 'all',
    filterClient: '',
    filterEmployee: '',
    filterPriority: '',
    searchQuery: '',
    openTaskId: null,
    clientOrder: [],   // array of client_ids for draggable ordering
  };

  // ── Data Loading ────────────────────────────────────────────────────────

  const BASE = '.';

  async function fetchJSON(path) {
    const url = `${BASE}/${path}?_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  }

  async function loadData() {
    try {
      const [tasksDB, clientsDB, employeesDB, syncDB] = await Promise.all([
        fetchJSON('data/tasks.json'),
        fetchJSON('data/clients.json'),
        fetchJSON('data/employees.json'),
        fetchJSON('data/sync_state.json'),
      ]);

      state.tasks = tasksDB.tasks || [];
      state.clients = clientsDB.clients || [];
      state.employees = employeesDB.employees || [];
      state.syncState = syncDB;

      // Merge any local-only tasks (created manually) from localStorage
      mergeLocalData();

      // Restore client order from localStorage if available
      const savedOrder = JSON.parse(localStorage.getItem('sdt_client_order') || '[]');
      if (savedOrder.length) {
        state.clientOrder = savedOrder;
      } else {
        state.clientOrder = state.clients.map(c => c.id);
      }

      renderAll();
    } catch (err) {
      console.error('Data load error:', err);
      // Fall back to localStorage-only data
      loadLocalOnly();
      renderAll();
    }
  }

  function mergeLocalData() {
    const localTasks = JSON.parse(localStorage.getItem('sdt_local_tasks') || '[]');
    const localClients = JSON.parse(localStorage.getItem('sdt_local_clients') || '[]');
    const localEmployees = JSON.parse(localStorage.getItem('sdt_local_employees') || '[]');

    const existingTaskIds = new Set(state.tasks.map(t => t.id));
    localTasks.forEach(t => { if (!existingTaskIds.has(t.id)) state.tasks.push(t); });

    const existingClientIds = new Set(state.clients.map(c => c.id));
    localClients.forEach(c => { if (!existingClientIds.has(c.id)) state.clients.push(c); });

    const existingEmpIds = new Set(state.employees.map(e => e.id));
    localEmployees.forEach(e => { if (!existingEmpIds.has(e.id)) state.employees.push(e); });

    // Apply any local manual edits (priority, assignee, status overrides)
    const overrides = JSON.parse(localStorage.getItem('sdt_task_overrides') || '{}');
    state.tasks = state.tasks.map(t => {
      if (overrides[t.id]) return { ...t, ...overrides[t.id] };
      return t;
    });
  }

  function loadLocalOnly() {
    state.tasks = JSON.parse(localStorage.getItem('sdt_local_tasks') || '[]');
    state.clients = JSON.parse(localStorage.getItem('sdt_local_clients') || '[]');
    state.employees = JSON.parse(localStorage.getItem('sdt_local_employees') || '[]');
    state.syncState = { last_sync_time: '', first_run_completed: false };
  }

  function saveLocalData() {
    localStorage.setItem('sdt_local_tasks', JSON.stringify(
      state.tasks.filter(t => t.manually_created)
    ));
    localStorage.setItem('sdt_local_clients', JSON.stringify(
      state.clients.filter(c => c.manually_created)
    ));
    localStorage.setItem('sdt_local_employees', JSON.stringify(
      state.employees.filter(e => e.manually_created)
    ));
  }

  function saveTaskOverride(taskId, overrides) {
    const all = JSON.parse(localStorage.getItem('sdt_task_overrides') || '{}');
    all[taskId] = { ...(all[taskId] || {}), ...overrides };
    localStorage.setItem('sdt_task_overrides', JSON.stringify(all));
  }

  function saveClientOrder() {
    localStorage.setItem('sdt_client_order', JSON.stringify(state.clientOrder));
  }

  // ── Filtering ───────────────────────────────────────────────────────────

  function getFilteredTasks(onlyPending = false) {
    return state.tasks.filter(t => {
      if (onlyPending && t.status === 'completed') return false;
      if (!onlyPending && t.status === 'completed') return false;  // handled separately

      if (state.activeFilter === 'urgent' && t.priority !== 'urgent') return false;
      if (state.activeFilter === 'medium' && t.priority !== 'medium') return false;
      if (state.activeFilter === 'low' && t.priority !== 'low') return false;
      if (state.activeFilter === 'pending' && t.status !== 'pending') return false;

      if (state.filterClient && t.client_id !== state.filterClient) return false;
      if (state.filterEmployee && t.assigned_to !== state.filterEmployee) return false;
      if (state.filterPriority && t.priority !== state.filterPriority) return false;

      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        return (
          (t.title || '').toLowerCase().includes(q) ||
          (t.client_name || '').toLowerCase().includes(q) ||
          (t.assigned_to || '').toLowerCase().includes(q) ||
          (t.responsible_person || '').toLowerCase().includes(q) ||
          (t.thread_summary || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }

  function getPendingTasks() {
    return state.tasks.filter(t => t.status !== 'completed').filter(applyFilters);
  }

  function getCompletedTasks() {
    return state.tasks.filter(t => t.status === 'completed').filter(applyFilters);
  }

  function applyFilters(t) {
    if (state.activeFilter === 'urgent' && t.priority !== 'urgent') return false;
    if (state.activeFilter === 'medium' && t.priority !== 'medium') return false;
    if (state.activeFilter === 'low' && t.priority !== 'low') return false;

    if (state.filterClient && t.client_id !== state.filterClient) return false;
    if (state.filterEmployee && t.assigned_to !== state.filterEmployee) return false;
    if (state.filterPriority && t.priority !== state.filterPriority) return false;

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      return (
        (t.title || '').toLowerCase().includes(q) ||
        (t.client_name || '').toLowerCase().includes(q) ||
        (t.assigned_to || '').toLowerCase().includes(q) ||
        (t.responsible_person || '').toLowerCase().includes(q)
      );
    }
    return true;
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  function computeStats() {
    const all = state.tasks;
    return {
      total: all.length,
      pending: all.filter(t => t.status !== 'completed').length,
      completed: all.filter(t => t.status === 'completed').length,
      urgent: all.filter(t => t.priority === 'urgent' && t.status !== 'completed').length,
      medium: all.filter(t => t.priority === 'medium' && t.status !== 'completed').length,
      low: all.filter(t => t.priority === 'low' && t.status !== 'completed').length,
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function renderAll() {
    renderStats();
    renderSyncStatus();
    renderFilterDropdowns();
    renderDashboard();
    renderAllTasksView();
    renderClientsView();
    renderEmployeesView();
    renderCompletedView();
  }

  function renderStats() {
    const s = computeStats();
    setText('stat-total', s.total);
    setText('stat-pending', s.pending);
    setText('stat-completed', s.completed);
    setText('stat-urgent', s.urgent);
    setText('stat-medium', s.medium);
    setText('stat-low', s.low);
  }

  function renderSyncStatus() {
    const bar = document.getElementById('sync-status-bar');
    const dot = document.getElementById('sync-dot');
    const text = document.getElementById('sync-status-text');
    if (!bar || !dot || !text) return;

    const { last_sync_time, first_run_completed } = state.syncState;

    if (!first_run_completed) {
      dot.className = 'sync-dot';
      text.textContent = 'Not yet synced. Trigger the GitHub Action to start syncing.';
      return;
    }

    if (last_sync_time) {
      const t = new Date(last_sync_time);
      const mins = Math.round((Date.now() - t.getTime()) / 60000);
      dot.className = 'sync-dot synced';
      text.textContent = `Last synced: ${t.toLocaleString()} (${mins} min ago)`;
    }
  }

  function renderFilterDropdowns() {
    populateSelect('filter-client', state.clients, 'All Clients');
    populateSelect('filter-employee', state.employees, 'All Employees');
    populateSelect('new-task-client', state.clients, 'Select client…');
    populateSelect('new-task-assignee', state.employees, 'Unassigned');
    populateSelect('detail-assigned-to', state.employees, 'Unassigned');
  }

  function populateSelect(id, items, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      el.appendChild(opt);
    });
    el.value = current;
  }

  // ── Dashboard ───────────────────────────────────────────────────────────

  function renderDashboard() {
    const container = document.getElementById('dashboard-clients');
    if (!container) return;

    const pendingTasks = getPendingTasks();
    if (pendingTasks.length === 0 && state.tasks.length === 0) {
      container.innerHTML = emptyState('No tasks yet. Your email sync will populate this automatically.', 'inbox');
      return;
    }

    // Group pending tasks by client, respecting clientOrder
    const tasksByClient = {};
    pendingTasks.forEach(t => {
      const cid = t.client_id || 'unknown';
      (tasksByClient[cid] = tasksByClient[cid] || []).push(t);
    });

    // Build ordered list of client IDs that have tasks
    const orderedClientIds = getOrderedClientIds(Object.keys(tasksByClient));

    container.innerHTML = '';

    if (orderedClientIds.length === 0) {
      container.innerHTML = emptyState('All tasks are completed!', 'check');
      return;
    }

    orderedClientIds.forEach((cid, sectionIdx) => {
      const client = state.clients.find(c => c.id === cid) || { id: cid, name: cid, order: 0 };
      const tasks = tasksByClient[cid] || [];

      // Sort tasks: urgent first, then medium, then low
      tasks.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

      const section = buildClientSection(client, tasks, sectionIdx);
      container.appendChild(section);
    });

    initDragDrop(container);
  }

  function getOrderedClientIds(clientIds) {
    const inOrder = state.clientOrder.filter(id => clientIds.includes(id));
    const notInOrder = clientIds.filter(id => !state.clientOrder.includes(id));
    return [...inOrder, ...notInOrder];
  }

  function priorityOrder(p) {
    return p === 'urgent' ? 0 : p === 'medium' ? 1 : 2;
  }

  function buildClientSection(client, tasks, idx) {
    const urgent = tasks.filter(t => t.priority === 'urgent').length;
    const medium = tasks.filter(t => t.priority === 'medium').length;
    const low = tasks.filter(t => t.priority === 'low').length;

    const section = document.createElement('div');
    section.className = 'client-section expanded';
    section.dataset.clientId = client.id;
    section.draggable = true;

    section.innerHTML = `
      <div class="client-section-header" role="button" tabindex="0" aria-expanded="true">
        <div class="client-avatar avatar-${idx % 10}">${initials(client.name)}</div>
        <span class="client-name">${escHtml(client.name)}</span>
        <div class="client-counts">
          ${urgent ? `<span class="count-badge urgent">${urgent} urgent</span>` : ''}
          ${medium ? `<span class="count-badge medium">${medium} medium</span>` : ''}
          ${low ? `<span class="count-badge low">${low} low</span>` : ''}
        </div>
        <svg class="client-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6,9 12,15 18,9"/>
        </svg>
      </div>
      <div class="client-tasks">
        ${tasks.map(t => buildTaskCardHTML(t)).join('')}
      </div>
    `;

    // Toggle expand/collapse
    const header = section.querySelector('.client-section-header');
    header.addEventListener('click', () => toggleSection(section));
    header.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggleSection(section); });

    // Task card events
    section.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.task-check')) return; // handled separately
        openTaskDetail(card.dataset.taskId);
      });
    });

    section.querySelectorAll('.task-check').forEach(check => {
      check.addEventListener('click', e => {
        e.stopPropagation();
        toggleTaskComplete(check.dataset.taskId);
      });
    });

    return section;
  }

  function buildTaskCardHTML(task) {
    const checked = task.status === 'completed';
    const employee = state.employees.find(e => e.id === task.assigned_to);
    return `
      <div class="task-card${checked ? ' completed' : ''}" data-task-id="${task.id}" role="button" tabindex="0">
        <div class="task-check${checked ? ' checked' : ''}" data-task-id="${task.id}" role="checkbox" aria-checked="${checked}" title="Toggle complete"></div>
        <div class="task-body">
          <div class="task-title" title="${escHtml(task.title)}">${escHtml(task.title)}</div>
          <div class="task-meta">
            <span class="priority-badge ${task.priority}">${task.priority}</span>
            ${employee ? `<span class="task-assignee">${escHtml(employee.name)}</span>` : ''}
            ${task.responsible_person ? `<span class="task-responsible">→ ${escHtml(task.responsible_person)}</span>` : ''}
          </div>
        </div>
        <span class="task-date">${formatDate(task.updated_at || task.created_at)}</span>
      </div>
    `;
  }

  function toggleSection(section) {
    section.classList.toggle('expanded');
    const header = section.querySelector('.client-section-header');
    header.setAttribute('aria-expanded', section.classList.contains('expanded'));
  }

  // ── All Tasks View ──────────────────────────────────────────────────────

  function renderAllTasksView() {
    const container = document.getElementById('all-tasks-list');
    if (!container) return;

    const pending = getPendingTasks();
    if (pending.length === 0) {
      container.innerHTML = emptyState('No pending tasks match the current filters.');
      return;
    }

    pending.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
    container.innerHTML = pending.map(t => buildTaskCardHTML(t)).join('');

    container.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.task-check')) return;
        openTaskDetail(card.dataset.taskId);
      });
    });
    container.querySelectorAll('.task-check').forEach(check => {
      check.addEventListener('click', e => {
        e.stopPropagation();
        toggleTaskComplete(check.dataset.taskId);
      });
    });
  }

  // ── Clients View ────────────────────────────────────────────────────────

  function renderClientsView() {
    const container = document.getElementById('clients-grid');
    if (!container) return;

    if (state.clients.length === 0) {
      container.innerHTML = emptyState('No clients yet. They appear automatically from email sync.');
      return;
    }

    container.innerHTML = state.clients.map((c, i) => {
      const tasks = state.tasks.filter(t => t.client_id === c.id);
      const pending = tasks.filter(t => t.status !== 'completed').length;
      return `
        <div class="client-card" data-client-id="${c.id}" role="button" tabindex="0">
          <div class="client-card-avatar avatar-${i % 10}">${initials(c.name)}</div>
          <div class="client-card-name">${escHtml(c.name)}</div>
          <div class="client-card-stats">${tasks.length} task${tasks.length !== 1 ? 's' : ''} &bull; ${pending} pending</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.client-card').forEach(card => {
      card.addEventListener('click', () => {
        state.filterClient = card.dataset.clientId;
        document.getElementById('filter-client').value = card.dataset.clientId;
        switchView('dashboard');
        renderAll();
      });
    });
  }

  // ── Employees View ──────────────────────────────────────────────────────

  function renderEmployeesView() {
    const container = document.getElementById('employees-grid');
    if (!container) return;

    if (state.employees.length === 0) {
      container.innerHTML = emptyState('No team members yet. Add employees to assign tasks.');
      return;
    }

    container.innerHTML = state.employees.map(e => {
      const assigned = state.tasks.filter(t => t.assigned_to === e.id && t.status !== 'completed').length;
      return `
        <div class="employee-card">
          <div class="employee-avatar">${initials(e.name)}</div>
          <div class="employee-name">${escHtml(e.name)}</div>
          <div class="employee-role">${escHtml(e.role || '')}</div>
          <div class="employee-stats">${assigned} pending task${assigned !== 1 ? 's' : ''}</div>
        </div>
      `;
    }).join('');
  }

  // ── Completed View ──────────────────────────────────────────────────────

  function renderCompletedView() {
    const container = document.getElementById('completed-list');
    const countEl = document.getElementById('completed-count');
    if (!container) return;

    const completed = getCompletedTasks();
    if (countEl) countEl.textContent = completed.length;

    if (completed.length === 0) {
      container.innerHTML = emptyState('No completed tasks yet.');
      return;
    }

    // Group by client
    const byClient = {};
    completed.forEach(t => {
      (byClient[t.client_id || 'unknown'] = byClient[t.client_id || 'unknown'] || []).push(t);
    });

    container.innerHTML = Object.entries(byClient).map(([cid, tasks]) => {
      const client = state.clients.find(c => c.id === cid) || { name: cid };
      return `
        <div class="completed-client-section">
          <div class="completed-section-title">${escHtml(client.name)}</div>
          ${tasks.map(t => buildTaskCardHTML(t)).join('')}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.task-check')) return;
        openTaskDetail(card.dataset.taskId);
      });
    });
    container.querySelectorAll('.task-check').forEach(check => {
      check.addEventListener('click', e => {
        e.stopPropagation();
        toggleTaskComplete(check.dataset.taskId);
      });
    });
  }

  // ── Task Detail Modal ───────────────────────────────────────────────────

  function openTaskDetail(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    state.openTaskId = taskId;

    // Populate employee select
    populateSelect('detail-assigned-to', state.employees, 'Unassigned');

    setText('detail-title', task.title);
    setText('detail-client', task.client_name || '');
    setText('detail-responsible', task.responsible_person || '—');
    setText('detail-status', task.status === 'completed' ? '✅ Completed' : '⏳ Pending');
    setText('detail-due', task.due_date_hint || '—');

    const badge = document.getElementById('detail-priority-badge');
    if (badge) { badge.className = `priority-badge ${task.priority}`; badge.textContent = task.priority; }

    const priSel = document.getElementById('detail-priority-select');
    if (priSel) priSel.value = task.priority;

    const assignSel = document.getElementById('detail-assigned-to');
    if (assignSel) assignSel.value = task.assigned_to || '';

    setText('detail-summary', task.thread_summary || 'No summary available.');

    const actionablesList = document.getElementById('detail-actionables');
    if (actionablesList) {
      const items = task.actionables || [];
      actionablesList.innerHTML = items.length
        ? items.map(a => `<li>${escHtml(a)}</li>`).join('')
        : '<li>No actionables recorded.</li>';
    }

    const threadContainer = document.getElementById('detail-thread');
    if (threadContainer) {
      const msgs = task.thread_messages || [];
      threadContainer.innerHTML = msgs.length
        ? msgs.map(m => `
            <div class="thread-msg">
              <div class="thread-msg-header">
                <span class="thread-msg-from">${escHtml(m.from || '')}</span>
                <span class="thread-msg-date">${escHtml(m.date || '')}</span>
              </div>
              <div class="thread-msg-body">${escHtml(m.snippet || '')}</div>
            </div>
          `).join('')
        : '<p style="color:var(--text-muted);font-size:.85rem">No email thread stored.</p>';
    }

    // Show/hide complete vs reopen buttons
    const btnComplete = document.getElementById('detail-btn-complete');
    const btnReopen = document.getElementById('detail-btn-reopen');
    if (btnComplete) btnComplete.style.display = task.status !== 'completed' ? 'inline-flex' : 'none';
    if (btnReopen) btnReopen.style.display = task.status === 'completed' ? 'inline-flex' : 'none';

    openModal('modal-task-detail');
  }

  // ── Task CRUD ───────────────────────────────────────────────────────────

  function toggleTaskComplete(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = task.status === 'completed' ? 'pending' : 'completed';
    task.completed_at = task.status === 'completed' ? new Date().toISOString() : null;
    task.updated_at = new Date().toISOString();
    task.manually_edited = true;
    saveTaskOverride(taskId, { status: task.status, completed_at: task.completed_at });
    renderAll();
    showToast(task.status === 'completed' ? 'Task marked complete' : 'Task reopened', 'success');
  }

  function addTask(title, clientId, priority, assigneeId, responsible, notes) {
    const client = state.clients.find(c => c.id === clientId);
    const id = 'manual_' + Date.now();
    const task = {
      id,
      title,
      priority,
      status: 'pending',
      client_id: clientId,
      client_name: client ? client.name : '',
      responsible_person: responsible,
      assigned_to: assigneeId,
      thread_summary: notes,
      actionables: notes ? [notes] : [],
      due_date_hint: null,
      email_refs: [],
      thread_messages: [],
      thread_subject: '',
      thread_id: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      manually_created: true,
      manually_edited: true,
    };
    state.tasks.push(task);
    saveLocalData();
    if (!state.clientOrder.includes(clientId)) {
      state.clientOrder.push(clientId);
      saveClientOrder();
    }
    renderAll();
    showToast('Task created', 'success');
  }

  function addEmployee(name, role, email) {
    const id = 'emp_' + Date.now();
    const emp = { id, name, role, email, created_at: new Date().toISOString(), manually_created: true };
    state.employees.push(emp);
    saveLocalData();
    renderAll();
    showToast('Team member added', 'success');
  }

  function addClient(name) {
    const id = 'client_manual_' + Date.now();
    const client = { id, name, created_at: new Date().toISOString(), order: state.clients.length, manually_created: true };
    state.clients.push(client);
    state.clientOrder.push(id);
    saveLocalData();
    saveClientOrder();
    renderAll();
    showToast('Client added', 'success');
  }

  // ── Drag and Drop (client sections reordering) ──────────────────────────

  function initDragDrop(container) {
    let dragSrc = null;

    container.querySelectorAll('.client-section').forEach(section => {
      section.addEventListener('dragstart', e => {
        dragSrc = section;
        section.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      section.addEventListener('dragend', () => {
        section.classList.remove('dragging');
        container.querySelectorAll('.client-section').forEach(s => s.classList.remove('drag-over'));
      });
      section.addEventListener('dragover', e => {
        e.preventDefault();
        if (section !== dragSrc) {
          container.querySelectorAll('.client-section').forEach(s => s.classList.remove('drag-over'));
          section.classList.add('drag-over');
        }
      });
      section.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragSrc || dragSrc === section) return;
        section.classList.remove('drag-over');
        // Reorder in DOM
        const sections = [...container.querySelectorAll('.client-section')];
        const srcIdx = sections.indexOf(dragSrc);
        const dstIdx = sections.indexOf(section);
        if (srcIdx < dstIdx) {
          section.after(dragSrc);
        } else {
          section.before(dragSrc);
        }
        // Persist new order
        const newOrder = [...container.querySelectorAll('.client-section')].map(s => s.dataset.clientId);
        state.clientOrder = newOrder;
        saveClientOrder();
      });
    });
  }

  // ── View switching ──────────────────────────────────────────────────────

  function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(`view-${viewName}`);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
    closeSidebar();
  }

  // ── Modal ───────────────────────────────────────────────────────────────

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // ── Sidebar ─────────────────────────────────────────────────────────────

  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initials(name) {
    return (name || '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  function emptyState(msg, icon = 'inbox') {
    const icons = {
      inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
      check: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/>',
    };
    return `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icons[icon] || icons.inbox}</svg>
        <p>${escHtml(msg)}</p>
      </div>
    `;
  }

  function showToast(msg, type = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── Event wiring ────────────────────────────────────────────────────────

  function wireEvents() {
    // Sidebar toggle
    document.getElementById('btn-menu')?.addEventListener('click', openSidebar);
    document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

    // Nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        switchView(item.dataset.view);
        renderAll();
      });
    });

    // Filter chips
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeFilter = chip.dataset.filter || 'all';
        renderAll();
      });
    });

    // Filter dropdowns
    document.getElementById('filter-client')?.addEventListener('change', e => {
      state.filterClient = e.target.value;
      renderAll();
    });
    document.getElementById('filter-employee')?.addEventListener('change', e => {
      state.filterEmployee = e.target.value;
      renderAll();
    });
    document.getElementById('filter-priority')?.addEventListener('change', e => {
      state.filterPriority = e.target.value;
      renderAll();
    });

    // Search
    let searchTimer;
    document.getElementById('search-input')?.addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchQuery = e.target.value.trim();
        renderAll();
      }, 250);
    });

    // Add task button
    document.getElementById('btn-add-task')?.addEventListener('click', () => openModal('modal-add-task'));

    // Save new task
    document.getElementById('btn-save-new-task')?.addEventListener('click', () => {
      const title = document.getElementById('new-task-title').value.trim();
      const clientId = document.getElementById('new-task-client').value;
      const priority = document.getElementById('new-task-priority').value;
      const assigneeId = document.getElementById('new-task-assignee').value;
      const responsible = document.getElementById('new-task-responsible').value.trim();
      const notes = document.getElementById('new-task-notes').value.trim();

      if (!title) { showToast('Please enter a task title', 'error'); return; }
      if (!clientId) { showToast('Please select a client', 'error'); return; }

      addTask(title, clientId, priority, assigneeId, responsible, notes);
      closeModal('modal-add-task');
      // Reset form
      ['new-task-title', 'new-task-client', 'new-task-assignee', 'new-task-responsible', 'new-task-notes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = el.tagName === 'SELECT' ? '' : '';
      });
    });

    // Add employee
    ['btn-add-employee', 'btn-add-employee-2'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => openModal('modal-add-employee'));
    });

    document.getElementById('btn-save-employee')?.addEventListener('click', () => {
      const name = document.getElementById('new-employee-name').value.trim();
      const role = document.getElementById('new-employee-role').value.trim();
      const email = document.getElementById('new-employee-email').value.trim();
      if (!name) { showToast('Please enter a name', 'error'); return; }
      addEmployee(name, role, email);
      closeModal('modal-add-employee');
      ['new-employee-name', 'new-employee-role', 'new-employee-email'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    });

    // Add client
    document.getElementById('btn-add-client')?.addEventListener('click', () => openModal('modal-add-client'));
    document.getElementById('btn-save-client')?.addEventListener('click', () => {
      const name = document.getElementById('new-client-name').value.trim();
      if (!name) { showToast('Please enter a client name', 'error'); return; }
      addClient(name);
      closeModal('modal-add-client');
      document.getElementById('new-client-name').value = '';
    });

    // Task detail — save changes
    document.getElementById('detail-btn-save')?.addEventListener('click', () => {
      if (!state.openTaskId) return;
      const task = state.tasks.find(t => t.id === state.openTaskId);
      if (!task) return;
      const priority = document.getElementById('detail-priority-select').value;
      const assignedTo = document.getElementById('detail-assigned-to').value;
      task.priority = priority;
      task.assigned_to = assignedTo;
      task.manually_edited = true;
      task.updated_at = new Date().toISOString();
      saveTaskOverride(state.openTaskId, { priority, assigned_to: assignedTo });
      renderAll();
      closeModal('modal-task-detail');
      showToast('Task updated', 'success');
    });

    // Task detail — mark complete
    document.getElementById('detail-btn-complete')?.addEventListener('click', () => {
      if (!state.openTaskId) return;
      toggleTaskComplete(state.openTaskId);
      closeModal('modal-task-detail');
    });

    // Task detail — reopen
    document.getElementById('detail-btn-reopen')?.addEventListener('click', () => {
      if (!state.openTaskId) return;
      toggleTaskComplete(state.openTaskId);
      closeModal('modal-task-detail');
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal || btn.closest('.modal')?.id;
        if (modalId) closeModal(modalId);
      });
    });

    // Close modal on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) closeModal(backdrop.id);
      });
    });

    // Lock screen
    document.getElementById('btn-lock')?.addEventListener('click', () => {
      if (window.AuthModule) window.AuthModule.enterSetMode();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop').forEach(m => {
          if (m.style.display !== 'none') closeModal(m.id);
        });
      }
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────────

  function boot() {
    wireEvents();
    loadData();

    // Auto-refresh every 5 minutes to pick up new data committed by GitHub Actions
    setInterval(loadData, 5 * 60 * 1000);
  }

  // Called by auth.js when pattern is verified
  window.onAppUnlocked = boot;

  // If no pattern is set yet, auth.js will call onAppUnlocked after first set
  // For freshly set pattern, auth module calls unlockApp which triggers onAppUnlocked
})();
