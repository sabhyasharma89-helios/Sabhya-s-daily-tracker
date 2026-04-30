/* ═══════════════════════════════════════════════════════════════
   App — Main controller for Sabhya's Daily Tracker
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {

  /* ── State ── */
  let state = {
    tasks:      [],
    clients:    [],
    filter:     'all',
    search:     '',
    collapsed:  {},          // { clientName: bool }
    completedExpanded: false,
    currentDetailId: null,
  };

  const COLLAPSED_KEY = 'sdt_collapsed';
  const AUTO_REFRESH_MS = 10 * 60 * 1000;  // 10 minutes
  let   _autoRefreshTimer = null;

  /* ══════════════════ Init ══════════════════ */
  async function init() {
    state.collapsed = (() => {
      try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}'); } catch { return {}; }
    })();

    UI.setSyncBadge('Loading…');
    await loadData(false);
    scheduleAutoRefresh();
  }

  /* ══════════════════ Data ══════════════════ */
  async function loadData(force = false) {
    UI.setSyncBadge('Syncing…');
    try {
      const data = await DB.load(force);
      state.tasks   = data.tasks;
      state.clients = data.clients;

      /* Refresh assignee datalist in modals */
      refreshAssigneeDatalists();

      renderAll(data);
      UI.setSyncBadge('Live', 'live');
    } catch (err) {
      console.error('[App] loadData error:', err);
      UI.setSyncBadge('Offline', 'error');
      UI.toast('Could not load data — showing cached version', 'error');
    }
  }

  async function refresh() {
    document.getElementById('refresh-btn').classList.add('spinning');
    await loadData(true);
    document.getElementById('refresh-btn').classList.remove('spinning');
    UI.toast('Data refreshed', 'success');
  }

  function scheduleAutoRefresh() {
    clearTimeout(_autoRefreshTimer);
    _autoRefreshTimer = setTimeout(() => {
      loadData(true).then(scheduleAutoRefresh);
    }, AUTO_REFRESH_MS);
  }

  /* ══════════════════ Render ══════════════════ */
  function renderAll(data) {
    UI.setLastUpdated(data.lastUpdated, data.lastEmailDate);
    const filtered = applyFilters(state.tasks);
    renderStats(state.tasks);
    renderClients(filtered);
    renderCompleted(filtered);
    populateClientDatalists();
  }

  function renderStats(tasks) {
    UI.renderStats(DB.computeStats(tasks));
  }

  function renderClients(filteredTasks) {
    const container = document.getElementById('clients-container');
    const emptyEl   = document.getElementById('empty-state');

    const pending   = filteredTasks.filter(t => t.status !== 'completed');

    /* Clients that have at least one matching pending task */
    const activeClients = state.clients.filter(c =>
      pending.some(t => t.clientName === c)
    );

    if (activeClients.length === 0 && pending.length === 0) {
      container.innerHTML = '';
      emptyEl.classList.remove('hidden');
      const desc = document.getElementById('empty-desc');
      if (desc) {
        desc.textContent = state.search
          ? `No tasks match "${state.search}".`
          : state.filter !== 'all'
            ? `No ${state.filter} tasks found.`
            : 'No pending tasks yet. Add one or run the email workflow!';
      }
    } else {
      emptyEl.classList.add('hidden');
      container.innerHTML = activeClients.map(client => {
        const clientTasks = pending.filter(t => t.clientName === client);
        return UI.renderClientSection(client, clientTasks, activeClients, state.collapsed);
      }).join('');
    }
  }

  function renderCompleted(filteredTasks) {
    const completed = filteredTasks.filter(t => t.status === 'completed');
    const listEl    = document.getElementById('completed-tasks-list');
    const countEl   = document.getElementById('s-completed-count');
    const sectionEl = document.getElementById('completed-section');

    if (countEl) countEl.textContent = completed.length;

    if (listEl) {
      listEl.innerHTML = completed.length
        ? completed.map(t => UI.renderTaskCard(t)).join('')
        : '<p style="padding:12px;font-size:.82rem;color:var(--text-muted)">No completed tasks.</p>';

      if (!state.completedExpanded) listEl.classList.add('hidden');
    }

    if (sectionEl) {
      sectionEl.style.display = state.filter === 'pending' ? 'none' : '';
    }
  }

  /* ══════════════════ Filtering ══════════════════ */
  function applyFilters(tasks) {
    const q = state.search.toLowerCase().trim();

    return tasks.filter(t => {
      /* Priority / status filter */
      if (state.filter === 'pending'   && t.status === 'completed') return false;
      if (state.filter === 'completed' && t.status !== 'completed') return false;
      if (state.filter === 'urgent'    && t.priority !== 'urgent')  return false;
      if (state.filter === 'medium'    && t.priority !== 'medium')  return false;
      if (state.filter === 'low'       && t.priority !== 'low')     return false;

      /* Search */
      if (!q) return true;
      return (
        (t.title        || '').toLowerCase().includes(q) ||
        (t.clientName   || '').toLowerCase().includes(q) ||
        (t.assignee     || '').toLowerCase().includes(q) ||
        (t.description  || '').toLowerCase().includes(q) ||
        (t.emailSubject || '').toLowerCase().includes(q)
      );
    });
  }

  function setFilter(chipEl, filter) {
    state.filter = filter;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    if (chipEl) chipEl.classList.add('active');

    const label = document.getElementById('active-filter-label');
    if (label) label.textContent = filter !== 'all' ? 'Filter: ' + filter : '';

    const filtered = applyFilters(state.tasks);
    renderClients(filtered);
    renderCompleted(filtered);
  }

  /* Called by search input oninput */
  function _applyFiltersFromInput() {
    const inp = document.getElementById('search-input');
    const clr = document.getElementById('search-clear');
    state.search = inp ? inp.value : '';
    if (clr) clr.classList.toggle('hidden', !state.search);

    const filtered = applyFilters(state.tasks);
    renderClients(filtered);
    renderCompleted(filtered);
  }

  function clearSearch() {
    state.search = '';
    const inp = document.getElementById('search-input');
    if (inp) inp.value = '';
    document.getElementById('search-clear')?.classList.add('hidden');
    const filtered = applyFilters(state.tasks);
    renderClients(filtered);
    renderCompleted(filtered);
  }

  /* ══════════════════ Client section collapse ══════════════════ */
  function toggleClient(clientName) {
    state.collapsed[clientName] = !state.collapsed[clientName];
    const cid    = 'client-' + clientName.replace(/\W+/g, '_');
    const body   = document.getElementById('tasks-' + cid);
    const icon   = document.getElementById('toggle-' + cid);
    const isOpen = !state.collapsed[clientName];

    if (body) body.classList.toggle('hidden', !isOpen);
    if (icon) icon.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0)';

    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state.collapsed)); } catch {}
  }

  function moveClient(clientName, dir) {
    dir === 'up' ? DB.moveClientUp(clientName) : DB.moveClientDown(clientName);
    loadData(false);
  }

  /* ══════════════════ Completed section ══════════════════ */
  function toggleCompleted() {
    state.completedExpanded = !state.completedExpanded;
    const list = document.getElementById('completed-tasks-list');
    const icon = document.getElementById('completed-toggle-icon');
    list?.classList.toggle('hidden', !state.completedExpanded);
    if (icon) icon.style.transform = state.completedExpanded ? 'rotate(90deg)' : 'rotate(0)';
  }

  /* ══════════════════ Task status toggle ══════════════════ */
  function toggleStatus(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (task.status === 'completed') {
      DB.markPending(taskId);
      task.status      = 'pending';
      task.completedAt = null;
      UI.toast('Task moved back to pending', 'info');
    } else {
      DB.markComplete(taskId);
      task.status      = 'completed';
      task.completedAt = new Date().toISOString();
      UI.toast('Task marked complete ✓', 'success');
    }

    renderStats(state.tasks);
    const filtered = applyFilters(state.tasks);
    renderClients(filtered);
    renderCompleted(filtered);
  }

  /* ══════════════════ Priority update ══════════════════ */
  function updatePriority(taskId, priority) {
    DB.setPriority(taskId, priority);
    const task = state.tasks.find(t => t.id === taskId);
    if (task) task.priority = priority;
    UI.hidePriorityPicker();

    /* Refresh card in-place without full re-render */
    const cardEl = document.getElementById('card-' + taskId);
    if (cardEl) {
      const filtered = applyFilters(state.tasks);
      renderClients(filtered);
      renderCompleted(filtered);
    }
    UI.toast('Priority updated', 'info');

    /* Refresh detail modal if open */
    if (state.currentDetailId === taskId) {
      UI.renderDetailModal(task);
    }
  }

  /* ══════════════════ Assignee update ══════════════════ */
  function updateAssignee(taskId, assignee) {
    DB.setAssignee(taskId, assignee);
    const task = state.tasks.find(t => t.id === taskId);
    if (task) task.assignee = assignee;
    refreshAssigneeDatalists();
    UI.toast('Assignee updated', 'info');

    /* Refresh card */
    const filtered = applyFilters(state.tasks);
    renderClients(filtered);
    renderCompleted(filtered);
  }

  function showPriorityPicker(event, taskId) {
    event.stopPropagation();
    UI.showPriorityPicker(event.currentTarget, taskId);
  }

  /* ══════════════════ Add / Edit Task Modal ══════════════════ */
  function showAddTaskModal() {
    /* Clear form */
    document.getElementById('edit-task-id').value  = '';
    document.getElementById('f-client').value      = '';
    document.getElementById('f-title').value       = '';
    document.getElementById('f-desc').value        = '';
    document.getElementById('f-priority').value    = 'medium';
    document.getElementById('f-assignee').value    = '';
    document.getElementById('task-modal-title').textContent = 'Add New Task';
    openModal('task-modal');
  }

  function openEditModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    closeModal('detail-modal');

    document.getElementById('edit-task-id').value  = task.id;
    document.getElementById('f-client').value      = task.clientName   || '';
    document.getElementById('f-title').value       = task.title        || '';
    document.getElementById('f-desc').value        = task.description  || '';
    document.getElementById('f-priority').value    = task.priority     || 'medium';
    document.getElementById('f-assignee').value    = task.assignee     || '';
    document.getElementById('task-modal-title').textContent = 'Edit Task';
    openModal('task-modal');
  }

  function saveTask() {
    const id       = document.getElementById('edit-task-id').value;
    const client   = document.getElementById('f-client').value.trim();
    const title    = document.getElementById('f-title').value.trim();
    const desc     = document.getElementById('f-desc').value.trim();
    const priority = document.getElementById('f-priority').value;
    const assignee = document.getElementById('f-assignee').value.trim();

    if (!client) { UI.toast('Client name is required', 'error'); return; }
    if (!title)  { UI.toast('Task title is required', 'error'); return; }

    if (id) {
      /* Edit existing */
      DB.updateManualTask(id, { clientName: client, title, description: desc, priority, assignee });
      const task = state.tasks.find(t => t.id === id);
      if (task) Object.assign(task, { clientName: client, title, description: desc, priority, assignee });
      UI.toast('Task updated', 'success');
    } else {
      /* Add new */
      const newTask = DB.addManualTask({ clientName: client, title, description: desc, priority, assignee });
      state.tasks.push(newTask);
      if (!state.clients.includes(client)) state.clients.push(client);
      UI.toast('Task added', 'success');
    }

    closeModal('task-modal');
    renderStats(state.tasks);
    const filtered = applyFilters(state.tasks);
    renderClients(filtered);
    renderCompleted(filtered);
    populateClientDatalists();
  }

  /* ══════════════════ Detail Modal ══════════════════ */
  function openDetail(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    state.currentDetailId = taskId;
    UI.renderDetailModal(task);
    openModal('detail-modal');
  }

  /* ══════════════════ Modal helpers ══════════════════ */
  function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
    document.body.style.overflow = '';
    if (id === 'detail-modal') state.currentDetailId = null;
  }

  /* Close modals on Escape */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal('detail-modal');
      closeModal('task-modal');
      closeModal('confirm-dialog');
      UI.hidePriorityPicker();
    }
  });

  /* ══════════════════ Datalists ══════════════════ */
  function populateClientDatalists() {
    const dl = document.getElementById('client-datalist');
    if (dl) dl.innerHTML = state.clients.map(c => `<option value="${UI.escHtml(c)}">`).join('');
  }

  function refreshAssigneeDatalists() {
    const assignees = DB.getAssignees();
    ['assignee-datalist'].forEach(id => {
      const dl = document.getElementById(id);
      if (dl) dl.innerHTML = assignees.map(a => `<option value="${UI.escHtml(a)}">`).join('');
    });
  }

  /* ══════════════════ Expose public ══════════════════ */
  return {
    init, refresh, loadData,
    applyFilters: _applyFiltersFromInput,
    clearSearch, setFilter,
    toggleClient, moveClient,
    toggleCompleted,
    toggleStatus,
    updatePriority, updateAssignee,
    showPriorityPicker,
    showAddTaskModal, openEditModal, saveTask,
    openDetail, openModal, closeModal,
  };

})();
