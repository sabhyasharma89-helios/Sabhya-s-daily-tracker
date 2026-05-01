/**
 * Main Application — Sabhya's Daily Tracker
 * Handles all UI rendering, state management, and user interactions.
 */

const App = (() => {
  // ── State ──────────────────────────────────────────────────
  let state = {
    tasks: [],
    clients: [],
    employees: [],
    metadata: {},
    overrides: null,
    filters: { priority: 'all', status: 'all', employee: 'all', client: 'all', search: '' },
    expandedTasks: new Set(),
    expandedClients: new Set(),
    completedExpanded: false,
    dragSrc: null,
    loading: false,
  };

  // ── Utility ───────────────────────────────────────────────

  function genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3100);
  }

  // ── Data loading ──────────────────────────────────────────

  async function loadData() {
    state.loading = true;
    updateSyncBar('loading');
    try {
      const [emailData, overrides] = await Promise.all([
        DataManager.loadEmailData(),
        DataManager.loadOverrides(),
      ]);
      state.overrides = overrides;
      const merged = DataManager.mergeData(emailData, overrides);
      state.tasks     = merged.tasks;
      state.clients   = merged.clients;
      state.employees = merged.employees;
      state.metadata  = merged.metadata;

      // Default-expand all clients
      state.clients.forEach(c => state.expandedClients.add(c.id));

      updateSyncBar('ok');
      render();
    } catch (err) {
      console.error('Load error:', err);
      updateSyncBar('error', err.message);
      // Still render with empty/cached state
      render();
    }
    state.loading = false;
  }

  async function persistOverrides() {
    if (!state.overrides) return;
    const saved = await DataManager.saveOverrides(state.overrides);
    if (!saved && GithubAPI.hasToken()) {
      showToast('Saved locally (GitHub sync failed)', 'error');
    }
  }

  // ── Sync status bar ───────────────────────────────────────

  function updateSyncBar(status, msg) {
    const bar = document.getElementById('sync-status-bar');
    const text = document.getElementById('sync-status-text');
    const dot = document.getElementById('sync-dot');
    if (!bar) return;

    if (status === 'loading') {
      bar.className = 'sync-status-bar';
      bar.classList.remove('hidden');
      text.textContent = 'Syncing data…';
      dot.className = 'sync-indicator syncing';
      return;
    }
    if (status === 'ok') {
      const t = state.metadata?.lastSyncTime;
      text.textContent = t
        ? `Last email sync: ${formatDate(t)} · ${state.tasks.filter(t => t.status !== 'completed').length} pending tasks`
        : 'No email sync yet — add secrets and run the workflow';
      dot.className = 'sync-indicator';
      bar.className = 'sync-status-bar';
      return;
    }
    if (status === 'error') {
      bar.className = 'sync-status-bar error';
      text.textContent = `Data load error: ${msg || 'unknown'}`;
      dot.className = 'sync-indicator error';
    }
  }

  // ── Statistics ────────────────────────────────────────────

  function calcStats() {
    const pending   = state.tasks.filter(t => t.status === 'pending');
    const completed = state.tasks.filter(t => t.status === 'completed');
    return {
      total:     state.tasks.length,
      pending:   pending.length,
      completed: completed.length,
      high:      pending.filter(t => t.priority === 'high').length,
      medium:    pending.filter(t => t.priority === 'medium').length,
      low:       pending.filter(t => t.priority === 'low').length,
    };
  }

  function renderStats() {
    const s = calcStats();
    document.getElementById('stats-bar').innerHTML = `
      <div class="stat-chip"><span>Total</span><span class="stat-count">${s.total}</span></div>
      <div class="stat-chip"><span>Pending</span><span class="stat-count">${s.pending}</span></div>
      <div class="stat-chip completed"><span>Done</span><span class="stat-count">${s.completed}</span></div>
      <div class="stat-chip high"><span>Urgent</span><span class="stat-count">${s.high}</span></div>
      <div class="stat-chip medium"><span>Medium</span><span class="stat-count">${s.medium}</span></div>
      <div class="stat-chip low"><span>Low</span><span class="stat-count">${s.low}</span></div>
    `;
  }

  // ── Filter / search ───────────────────────────────────────

  function filterTasks(tasks) {
    const { priority, status, employee, client, search } = state.filters;
    const q = search.toLowerCase();
    return tasks.filter(t => {
      if (priority !== 'all' && t.priority !== priority) return false;
      if (status !== 'all' && t.status !== status) return false;
      if (employee !== 'all' && t.assignedTo !== employee) return false;
      if (client !== 'all' && t.clientId !== client) return false;
      if (q) {
        const hay = [t.title, t.clientName, t.emailSummary, t.assignedTo, t.nextStepResponsible]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function updateEmployeeFilter() {
    const sel = document.getElementById('filter-employee');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="all">All Employees</option>
      ${state.employees.map(e => `<option value="${esc(e.email)}">${esc(e.name)}</option>`).join('')}`;
    sel.value = cur;
  }

  function updateClientFilter() {
    const sel = document.getElementById('filter-client');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="all">All Clients</option>
      ${state.clients.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}`;
    sel.value = cur;
  }

  // ── Task rendering ────────────────────────────────────────

  function taskHtml(task) {
    const expanded = state.expandedTasks.has(task.id);
    const isCompleted = task.status === 'completed';
    const assignee = task.assignedTo
      ? (state.employees.find(e => e.email === task.assignedTo)?.name || task.assignedTo)
      : null;

    const emailsHtml = (task.emails || []).slice(0, 5).map(e => `
      <div class="email-item">
        <span class="email-from">${esc(e.from?.replace(/<.*>/, '').trim() || 'Unknown')}</span>
        <span class="email-snippet">${esc(e.snippet || '')}</span>
        <span class="email-date">${formatDate(e.date)}</span>
      </div>`).join('');

    const actionablesHtml = (task.actionables || []).map(a => `<li>${esc(a)}</li>`).join('');

    const employeeOptions = state.employees
      .map(e => `<option value="${esc(e.email)}" ${task.assignedTo === e.email ? 'selected' : ''}>${esc(e.name)}</option>`)
      .join('');

    return `
    <div class="task-item ${isCompleted ? 'completed' : ''} ${expanded ? 'expanded' : ''}" data-id="${esc(task.id)}">
      <div class="task-summary">
        <button class="task-status-btn" title="${isCompleted ? 'Mark pending' : 'Mark complete'}" data-action="toggle-status" data-id="${esc(task.id)}"></button>
        <div class="task-content" data-action="toggle-expand" data-id="${esc(task.id)}" style="cursor:pointer">
          <div class="task-title">${esc(task.title)}</div>
          <div class="task-meta">
            <span class="priority-tag ${task.priority}">${task.priority}</span>
            ${assignee ? `<span class="task-assign-chip">👤 ${esc(assignee)}</span>` : ''}
            ${task.latestEmailDate ? `<span class="task-date-chip">${formatDate(task.latestEmailDate)}</span>` : ''}
            ${task.manuallyAdded ? `<span class="task-assign-chip" style="background:#fef9c3;color:#92400e">Manual</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="task-action-btn" title="Edit" data-action="edit-task" data-id="${esc(task.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          ${task.manuallyAdded ? `<button class="task-action-btn" title="Delete" data-action="delete-task" data-id="${esc(task.id)}" style="color:var(--high)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>` : ''}
        </div>
      </div>
      <div class="task-detail">
        ${task.emailSummary ? `
        <div class="detail-section">
          <div class="detail-label">Thread Summary</div>
          <div class="detail-text">${esc(task.emailSummary)}</div>
        </div>` : ''}
        ${task.actionables?.length ? `
        <div class="detail-section">
          <div class="detail-label">Action Items</div>
          <ul class="actionable-list">${actionablesHtml}</ul>
        </div>` : ''}
        ${task.nextStepResponsible ? `
        <div class="detail-section">
          <div class="detail-label">Next Step → Responsible</div>
          <div class="detail-text">📌 ${esc(task.nextStepResponsible)}</div>
        </div>` : ''}
        <div class="detail-section">
          <div class="detail-label">Priority</div>
          <div class="priority-change-row">
            <button class="priority-btn high ${task.priority === 'high' ? 'active' : ''}" data-action="set-priority" data-id="${esc(task.id)}" data-priority="high">🔴 High</button>
            <button class="priority-btn medium ${task.priority === 'medium' ? 'active' : ''}" data-action="set-priority" data-id="${esc(task.id)}" data-priority="medium">🟡 Medium</button>
            <button class="priority-btn low ${task.priority === 'low' ? 'active' : ''}" data-action="set-priority" data-id="${esc(task.id)}" data-priority="low">🟢 Low</button>
          </div>
        </div>
        ${state.employees.length ? `
        <div class="detail-section">
          <div class="detail-label">Assigned To</div>
          <div class="detail-assign-row">
            <select class="detail-assign-select" data-id="${esc(task.id)}">
              <option value="">Unassigned</option>${employeeOptions}
            </select>
            <button class="btn-save-assign" data-action="save-assign" data-id="${esc(task.id)}">Save</button>
          </div>
        </div>` : ''}
        ${emailsHtml ? `
        <div class="detail-section">
          <div class="detail-label">Email Thread (${(task.emails || []).length} messages)</div>
          <div class="email-list">${emailsHtml}</div>
        </div>` : ''}
      </div>
    </div>`;
  }

  // ── Client card rendering ─────────────────────────────────

  function clientCardHtml(client, tasks) {
    const collapsed = !state.expandedClients.has(client.id);
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const highCount   = pendingTasks.filter(t => t.priority === 'high').length;
    const medCount    = pendingTasks.filter(t => t.priority === 'medium').length;
    const lowCount    = pendingTasks.filter(t => t.priority === 'low').length;

    const sortedTasks = [...pendingTasks].sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return (rank[a.priority] || 2) - (rank[b.priority] || 2);
    });

    const tasksHtml = sortedTasks.length
      ? sortedTasks.map(taskHtml).join('')
      : `<div style="padding:20px;text-align:center;color:var(--text-light);font-size:13px">No pending tasks</div>`;

    const initial = client.name.charAt(0).toUpperCase();

    return `
    <div class="client-card ${collapsed ? 'collapsed' : ''}" data-client-id="${esc(client.id)}" draggable="true">
      <div class="client-color-bar" style="background:${esc(client.color)}"></div>
      <div class="client-header">
        <div class="client-drag-handle" title="Drag to reorder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1.5" fill="currentColor"/><circle cx="15" cy="5" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="19" r="1.5" fill="currentColor"/><circle cx="15" cy="19" r="1.5" fill="currentColor"/></svg>
        </div>
        <div class="client-avatar" style="background:${esc(client.color)}">${initial}</div>
        <div class="client-info">
          <div class="client-name">${esc(client.name)}</div>
          <div class="client-meta">${pendingTasks.length} pending task${pendingTasks.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="client-badges">
          ${highCount ? `<span class="badge high">${highCount}</span>` : ''}
          ${medCount  ? `<span class="badge medium">${medCount}</span>` : ''}
          ${lowCount  ? `<span class="badge low">${lowCount}</span>` : ''}
        </div>
        <svg class="client-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="client-tasks">${tasksHtml}</div>
    </div>`;
  }

  // ── Completed section ─────────────────────────────────────

  function renderCompleted(completedTasks) {
    const section = document.getElementById('completed-section');
    if (!completedTasks.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');

    const countBadge = document.getElementById('completed-count');
    if (countBadge) countBadge.textContent = completedTasks.length;

    const body = document.getElementById('completed-body');
    if (!state.completedExpanded) { body.innerHTML = ''; return; }

    // Group by client
    const byClient = {};
    completedTasks.forEach(t => {
      if (!byClient[t.clientId]) byClient[t.clientId] = { name: t.clientName, tasks: [] };
      byClient[t.clientId].tasks.push(t);
    });

    body.innerHTML = Object.values(byClient).map(group => `
      <div class="completed-by-client">
        <div class="completed-client-name">${esc(group.name)}</div>
        ${group.tasks.map(taskHtml).join('')}
      </div>
    `).join('');
  }

  // ── Main render ───────────────────────────────────────────

  function render() {
    renderStats();
    updateEmployeeFilter();
    updateClientFilter();

    const filteredTasks = filterTasks(state.tasks);
    const pendingFiltered   = filteredTasks.filter(t => t.status === 'pending');
    const completedFiltered = filteredTasks.filter(t => t.status === 'completed');

    // Group pending tasks by client
    const tasksByClient = {};
    pendingFiltered.forEach(t => {
      if (!tasksByClient[t.clientId]) tasksByClient[t.clientId] = [];
      tasksByClient[t.clientId].push(t);
    });

    const grid = document.getElementById('clients-grid');
    const hasFilters = Object.values(state.filters).some(v => v !== 'all' && v !== '');

    const visibleClients = state.clients.filter(c => {
      if (!hasFilters) return true;
      return tasksByClient[c.id]?.length > 0;
    });

    if (!visibleClients.length && !pendingFiltered.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/></svg>
          <h3>No tasks found</h3>
          <p>${hasFilters ? 'No tasks match your current filters.' : 'Tasks will appear here after the first email sync.'}</p>
        </div>`;
    } else {
      grid.innerHTML = visibleClients
        .map(c => clientCardHtml(c, tasksByClient[c.id] || []))
        .join('');
      attachDragHandlers();
    }

    renderCompleted(completedFiltered);
    renderCompleted(completedFiltered);
  }

  // ── Drag & Drop client reordering ─────────────────────────

  function attachDragHandlers() {
    document.querySelectorAll('.client-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        state.dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.client-card').forEach(c => c.classList.remove('drag-over'));
      });
      card.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (card !== state.dragSrc) card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!state.dragSrc || state.dragSrc === card) return;

        const grid = document.getElementById('clients-grid');
        const cards = [...grid.querySelectorAll('.client-card')];
        const srcIdx  = cards.indexOf(state.dragSrc);
        const destIdx = cards.indexOf(card);

        // Reorder in state
        const newOrder = state.clients.map(c => c.id);
        const [moved] = newOrder.splice(srcIdx, 1);
        newOrder.splice(destIdx, 0, moved);

        state.clients = newOrder
          .map(id => state.clients.find(c => c.id === id))
          .filter(Boolean);

        // Persist new order
        if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();
        state.overrides.clientOrder = newOrder;
        persistOverrides();

        render();
      });
    });
  }

  // ── Event delegation ──────────────────────────────────────

  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'toggle-expand') {
      if (state.expandedTasks.has(id)) state.expandedTasks.delete(id);
      else state.expandedTasks.add(id);
      render();
      return;
    }

    if (action === 'toggle-status') {
      toggleTaskStatus(id);
      return;
    }

    if (action === 'set-priority') {
      setTaskPriority(id, btn.dataset.priority);
      return;
    }

    if (action === 'save-assign') {
      const sel = document.querySelector(`.detail-assign-select[data-id="${CSS.escape(id)}"]`);
      if (sel) assignTask(id, sel.value || null);
      return;
    }

    if (action === 'edit-task') {
      openEditTaskModal(id);
      return;
    }

    if (action === 'delete-task') {
      deleteManualTask(id);
      return;
    }

    // Client header toggle
    const clientCard = e.target.closest('.client-header');
    if (clientCard) {
      const card = clientCard.closest('.client-card');
      const clientId = card?.dataset.clientId;
      if (clientId) {
        if (state.expandedClients.has(clientId)) state.expandedClients.delete(clientId);
        else state.expandedClients.add(clientId);
        card.classList.toggle('collapsed');
        return;
      }
    }
  }

  // ── Task mutations ────────────────────────────────────────

  async function toggleTaskStatus(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const completedAt = newStatus === 'completed' ? new Date().toISOString() : null;

    task.status = newStatus;
    task.completedAt = completedAt;

    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();

    if (task.manuallyAdded) {
      DataManager.updateManualTask(state.overrides, taskId, { status: newStatus, completedAt, updatedAt: new Date().toISOString() });
    } else {
      DataManager.applyTaskOverride(state.overrides, taskId, { status: newStatus, completedAt });
    }

    render();
    await persistOverrides();
    showToast(newStatus === 'completed' ? 'Task marked complete ✓' : 'Task moved back to pending', 'success');
  }

  async function setTaskPriority(taskId, priority) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || task.priority === priority) return;
    task.priority = priority;

    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();

    if (task.manuallyAdded) {
      DataManager.updateManualTask(state.overrides, taskId, { priority, updatedAt: new Date().toISOString() });
    } else {
      DataManager.applyTaskOverride(state.overrides, taskId, { priority });
    }

    render();
    await persistOverrides();
    showToast(`Priority set to ${priority}`, 'success');
  }

  async function assignTask(taskId, employeeEmail) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.assignedTo = employeeEmail || null;

    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();

    if (task.manuallyAdded) {
      DataManager.updateManualTask(state.overrides, taskId, { assignedTo: task.assignedTo, updatedAt: new Date().toISOString() });
    } else {
      DataManager.applyTaskOverride(state.overrides, taskId, { assignedTo: task.assignedTo });
    }

    render();
    await persistOverrides();
    const emp = state.employees.find(e => e.email === employeeEmail);
    showToast(emp ? `Assigned to ${emp.name}` : 'Assignment removed', 'success');
  }

  async function deleteManualTask(taskId) {
    if (!confirm('Delete this task?')) return;
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();
    DataManager.removeManualTask(state.overrides, taskId);
    render();
    await persistOverrides();
    showToast('Task deleted', 'info');
  }

  // ── Add Task Modal ────────────────────────────────────────

  function openAddTaskModal() {
    const clientOptions = state.clients
      .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
      .join('');
    const employeeOptions = state.employees
      .map(e => `<option value="${esc(e.email)}">${esc(e.name)}</option>`)
      .join('');

    document.getElementById('modal-title').textContent = 'Add New Task';
    document.getElementById('modal-body').innerHTML = `
      <div class="modal-form-group">
        <label>Client *</label>
        <select class="modal-select" id="task-client" required>
          <option value="">Select client…</option>${clientOptions}
          <option value="__new__">+ New client…</option>
        </select>
      </div>
      <div class="modal-form-group" id="new-client-group" style="display:none">
        <label>New Client Name *</label>
        <input type="text" class="modal-input" id="task-new-client" placeholder="Client name">
      </div>
      <div class="modal-form-group">
        <label>Task Title *</label>
        <input type="text" class="modal-input" id="task-title" placeholder="Describe the action item" maxlength="120">
      </div>
      <div class="modal-form-group">
        <label>Description / Notes</label>
        <textarea class="modal-textarea" id="task-description" placeholder="Additional context…" rows="3"></textarea>
      </div>
      <div class="modal-form-group">
        <label>Priority *</label>
        <select class="modal-select" id="task-priority">
          <option value="high">High — Urgent</option>
          <option value="medium" selected>Medium — Important</option>
          <option value="low">Low — Can wait</option>
        </select>
      </div>
      <div class="modal-form-group">
        <label>Assign To</label>
        <select class="modal-select" id="task-employee">
          <option value="">Unassigned</option>${employeeOptions}
        </select>
      </div>
    `;

    document.getElementById('modal-submit').textContent = 'Add Task';
    document.getElementById('modal-submit').onclick = submitAddTask;

    // Show new client input when selected
    document.getElementById('task-client').addEventListener('change', function () {
      document.getElementById('new-client-group').style.display =
        this.value === '__new__' ? 'block' : 'none';
    });

    showModal();
  }

  async function submitAddTask() {
    const clientSel = document.getElementById('task-client').value;
    const title     = document.getElementById('task-title').value.trim();
    const desc      = document.getElementById('task-description').value.trim();
    const priority  = document.getElementById('task-priority').value;
    const assignee  = document.getElementById('task-employee').value || null;

    if (!title) { showToast('Task title is required', 'error'); return; }

    let clientId, clientName;
    if (clientSel === '__new__') {
      const newName = document.getElementById('task-new-client').value.trim();
      if (!newName) { showToast('Client name is required', 'error'); return; }
      clientId = genId('client');
      clientName = newName;
      const color = ['#4A90E2','#7B68EE','#50C878','#FF6B6B','#FFA500'][state.clients.length % 5];
      state.clients.push({ id: clientId, name: clientName, color, order: state.clients.length });
    } else if (clientSel) {
      const c = state.clients.find(c => c.id === clientSel);
      clientId = c?.id;
      clientName = c?.name;
    } else {
      showToast('Please select a client', 'error'); return;
    }

    const newTask = {
      id: genId('task'),
      clientId,
      clientName,
      title,
      description: desc,
      priority,
      status: 'pending',
      assignedTo: assignee,
      emailThreadId: null,
      emailSubject: '',
      emailSummary: '',
      actionables: [],
      nextStepResponsible: '',
      participants: [],
      latestEmailDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      emails: [],
      manuallyAdded: true,
    };

    state.tasks.push(newTask);
    state.expandedClients.add(clientId);

    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();
    DataManager.addManualTask(state.overrides, newTask);

    hideModal();
    render();
    await persistOverrides();
    showToast('Task added!', 'success');
  }

  // ── Edit Task Modal ───────────────────────────────────────

  function openEditTaskModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const employeeOptions = state.employees
      .map(e => `<option value="${esc(e.email)}" ${task.assignedTo === e.email ? 'selected' : ''}>${esc(e.name)}</option>`)
      .join('');

    document.getElementById('modal-title').textContent = 'Edit Task';
    document.getElementById('modal-body').innerHTML = `
      <div class="modal-form-group">
        <label>Task Title</label>
        <input type="text" class="modal-input" id="task-title" value="${esc(task.title)}" maxlength="120">
      </div>
      <div class="modal-form-group">
        <label>Description / Notes</label>
        <textarea class="modal-textarea" id="task-description" rows="3">${esc(task.description || '')}</textarea>
      </div>
      <div class="modal-form-group">
        <label>Priority</label>
        <select class="modal-select" id="task-priority">
          <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High — Urgent</option>
          <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium — Important</option>
          <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low — Can wait</option>
        </select>
      </div>
      <div class="modal-form-group">
        <label>Assign To</label>
        <select class="modal-select" id="task-employee">
          <option value="">Unassigned</option>${employeeOptions}
        </select>
      </div>
    `;

    document.getElementById('modal-submit').textContent = 'Save Changes';
    document.getElementById('modal-submit').onclick = () => submitEditTask(taskId);
    showModal();
  }

  async function submitEditTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const title    = document.getElementById('task-title').value.trim();
    const desc     = document.getElementById('task-description').value.trim();
    const priority = document.getElementById('task-priority').value;
    const assignee = document.getElementById('task-employee').value || null;

    if (!title) { showToast('Title is required', 'error'); return; }

    const changes = { title, description: desc, priority, assignedTo: assignee, updatedAt: new Date().toISOString() };
    Object.assign(task, changes);

    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();

    if (task.manuallyAdded) {
      DataManager.updateManualTask(state.overrides, taskId, changes);
    } else {
      DataManager.applyTaskOverride(state.overrides, taskId, { priority, assignedTo: assignee });
    }

    hideModal();
    render();
    await persistOverrides();
    showToast('Task updated', 'success');
  }

  // ── Employee Manager ──────────────────────────────────────

  function openEmployeeModal() {
    renderEmployeeModal();
    document.getElementById('modal-submit').style.display = 'none';
    showModal();
  }

  function renderEmployeeModal() {
    document.getElementById('modal-title').textContent = 'Manage Employees';
    document.getElementById('modal-body').innerHTML = `
      <div class="employee-list" id="employee-list">
        ${state.employees.length ? state.employees.map(e => `
          <div class="employee-item">
            <div class="employee-avatar">${e.name.charAt(0).toUpperCase()}</div>
            <div class="employee-info">
              <div class="employee-name">${esc(e.name)}</div>
              <div class="employee-email">${esc(e.email)}</div>
            </div>
            <button class="btn-remove-employee" data-emp-email="${esc(e.email)}" title="Remove">×</button>
          </div>
        `).join('') : '<div style="color:var(--text-light);font-size:13px;padding:8px 0">No employees added yet.</div>'}
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0">
      <div class="modal-form-group">
        <label>Add Employee</label>
        <input type="text" class="modal-input" id="emp-name" placeholder="Full name" style="margin-bottom:8px">
        <input type="email" class="modal-input" id="emp-email" placeholder="Email address">
      </div>
      <button class="btn-submit" id="btn-add-emp" style="width:100%">Add Employee</button>
    `;

    document.getElementById('btn-add-emp').onclick = addEmployee;
    document.getElementById('employee-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-emp-email]');
      if (btn) removeEmployee(btn.dataset.empEmail);
    });
  }

  async function addEmployee() {
    const name  = document.getElementById('emp-name').value.trim();
    const email = document.getElementById('emp-email').value.trim().toLowerCase();
    if (!name || !email) { showToast('Name and email are required', 'error'); return; }
    if (!email.includes('@')) { showToast('Enter a valid email', 'error'); return; }
    if (state.employees.find(e => e.email === email)) { showToast('Employee already exists', 'error'); return; }

    const emp = { id: genId('emp'), name, email };
    state.employees.push(emp);
    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();
    state.overrides.employees = state.employees;
    await persistOverrides();
    renderEmployeeModal();
    showToast(`${name} added`, 'success');
  }

  async function removeEmployee(email) {
    if (!confirm(`Remove ${email} from team?`)) return;
    state.employees = state.employees.filter(e => e.email !== email);
    if (!state.overrides) state.overrides = GithubAPI.defaultOverrides();
    state.overrides.employees = state.employees;
    await persistOverrides();
    renderEmployeeModal();
    showToast('Employee removed', 'info');
  }

  // ── Modal helpers ─────────────────────────────────────────

  function showModal() { document.getElementById('task-modal').classList.remove('hidden'); }
  function hideModal()  { document.getElementById('task-modal').classList.add('hidden'); }

  // ── GitHub Token Setup ────────────────────────────────────

  function showTokenScreen() {
    document.getElementById('token-screen').classList.remove('hidden');
  }

  function hideTokenScreen() {
    document.getElementById('token-screen').classList.add('hidden');
  }

  function setupTokenScreen() {
    document.getElementById('btn-save-token').onclick = async () => {
      const token = document.getElementById('gh-token-input').value.trim();
      const repo  = document.getElementById('gh-repo-input').value.trim();
      if (!token) { showToast('Token is required', 'error'); return; }
      GithubAPI.setToken(token);
      if (repo) GithubAPI.setRepo(repo);
      hideTokenScreen();
      await loadData();
    };
    document.getElementById('btn-skip-token').onclick = () => {
      hideTokenScreen();
      loadData();
    };
    // Pre-fill repo
    document.getElementById('gh-repo-input').value = GithubAPI.getRepo();
  }

  // ── Init ──────────────────────────────────────────────────

  function init() {
    // Set up auth screen
    const canvas = document.getElementById('pattern-canvas');
    Auth.init(canvas);

    const onUnlocked = () => {
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');

      if (!GithubAPI.hasToken()) {
        showTokenScreen();
        setupTokenScreen();
      } else {
        loadData();
      }
    };

    if (Auth.isPatternSet()) {
      document.getElementById('auth-title').textContent = 'Welcome Back';
      document.getElementById('auth-subtitle').textContent = 'Draw your pattern to unlock';
      Auth.startVerify(onUnlocked);
    } else {
      document.getElementById('auth-title').textContent = 'Set Your Pattern';
      document.getElementById('auth-subtitle').textContent = 'Draw a pattern to secure your tracker';
      document.getElementById('auth-actions').style.display = 'none';
      Auth.startSetup(onUnlocked);
    }

    document.getElementById('btn-reset-pattern').addEventListener('click', () => {
      if (confirm('Reset your unlock pattern?')) {
        Auth.clearPattern();
        location.reload();
      }
    });

    // Filter events
    document.getElementById('search-input').addEventListener('input', e => {
      state.filters.search = e.target.value;
      render();
    });
    document.getElementById('filter-priority').addEventListener('change', e => {
      state.filters.priority = e.target.value;
      render();
    });
    document.getElementById('filter-status').addEventListener('change', e => {
      state.filters.status = e.target.value;
      render();
    });
    document.getElementById('filter-employee').addEventListener('change', e => {
      state.filters.employee = e.target.value;
      render();
    });
    document.getElementById('filter-client').addEventListener('change', e => {
      state.filters.client = e.target.value;
      render();
    });

    // Add task button
    document.getElementById('btn-add-task').addEventListener('click', openAddTaskModal);

    // Employees button
    document.getElementById('btn-employees').addEventListener('click', openEmployeeModal);

    // Refresh button
    document.getElementById('btn-refresh').addEventListener('click', loadData);

    // Modal close
    document.getElementById('modal-close').addEventListener('click', hideModal);
    document.getElementById('modal-cancel').addEventListener('click', hideModal);
    document.getElementById('task-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('task-modal')) hideModal();
    });

    // Completed section toggle
    document.getElementById('completed-header').addEventListener('click', () => {
      state.completedExpanded = !state.completedExpanded;
      document.getElementById('completed-section').classList.toggle('expanded', state.completedExpanded);
      render();
    });

    // Event delegation for task actions
    document.getElementById('clients-grid').addEventListener('click', handleClick);
    document.getElementById('completed-body').addEventListener('click', handleClick);

    // Lock screen button
    document.getElementById('btn-lock').addEventListener('click', () => {
      document.getElementById('app').classList.add('hidden');
      document.getElementById('auth-screen').classList.remove('hidden');
      document.getElementById('auth-title').textContent = 'Welcome Back';
      document.getElementById('auth-subtitle').textContent = 'Draw your pattern to unlock';
      Auth.startVerify(() => {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
      });
    });

    // Auto-refresh every 10 minutes
    setInterval(loadData, 10 * 60 * 1000);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
