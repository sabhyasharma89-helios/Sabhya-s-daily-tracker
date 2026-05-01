/* ═══════════════════════════════════════════════════════════
   UI MODULE — Rendering, Modals, Toast, Drag-drop
═══════════════════════════════════════════════════════════ */

const UI = (() => {

  // ── TOAST ──────────────────────────────────────────────────
  function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  // ── SYNC STATUS ────────────────────────────────────────────
  function setSyncStatus(state, label) {
    const dot = document.querySelector('.sync-dot');
    const lbl = document.getElementById('sync-label');
    dot.className = 'sync-dot' + (state !== 'ok' ? ` ${state}` : '');
    if (lbl) lbl.textContent = label || (state === 'syncing' ? 'Syncing…' : state === 'error' ? 'Sync error' : 'Live');
  }

  // ── STATS BAR ──────────────────────────────────────────────
  function updateStats(stats) {
    document.getElementById('stat-total').textContent     = stats.total;
    document.getElementById('stat-urgent').textContent    = stats.urgent;
    document.getElementById('stat-medium').textContent    = stats.medium;
    document.getElementById('stat-low').textContent       = stats.low;
    document.getElementById('stat-pending').textContent   = stats.pending;
    document.getElementById('stat-completed').textContent = stats.completed;
  }

  // ── CLIENT SIDEBAR ─────────────────────────────────────────
  function renderClientList(clients, tasks, activeClientId, onSelect) {
    const list = document.getElementById('client-list');
    // Preserve "All" item
    list.innerHTML = `
      <li class="client-item ${activeClientId === 'all' ? 'active' : ''}" data-client="all">
        <span class="client-dot" style="background:#6366f1"></span>
        <span class="client-name">All Clients</span>
        <span class="client-count" id="count-all">${tasks.filter(t => t.status === 'pending').length}</span>
      </li>`;

    // Build count map
    const pendingByClient = {};
    tasks.filter(t => t.status === 'pending').forEach(t => {
      pendingByClient[t.clientId] = (pendingByClient[t.clientId] || 0) + 1;
    });

    clients.forEach(client => {
      const li = document.createElement('li');
      li.className = `client-item ${activeClientId === client.id ? 'active' : ''}`;
      li.dataset.client = client.id;
      li.draggable = true;
      li.innerHTML = `
        <span class="drag-handle" title="Drag to reorder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6"  x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6"  x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </span>
        <span class="client-dot" style="background:${client.color || '#6366f1'}"></span>
        <span class="client-name">${escHtml(client.name)}</span>
        <span class="client-count">${pendingByClient[client.id] || 0}</span>`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.drag-handle')) return;
        onSelect(client.id, client.name);
      });
      list.appendChild(li);
    });

    // Highlight active
    list.querySelectorAll('.client-item').forEach(item => {
      item.classList.toggle('active', item.dataset.client === activeClientId);
    });

    // Drag-to-reorder
    setupClientDrag(list, clients, onReorder => {
      DB.updateClientOrder(onReorder);
    });

    // All-clients click
    list.querySelector('[data-client="all"]').addEventListener('click', () => {
      onSelect('all', 'All Clients');
    });

    // Update datalist for task forms
    const dl = document.getElementById('client-datalist');
    if (dl) {
      dl.innerHTML = clients.map(c => `<option value="${escHtml(c.name)}">`).join('');
    }
  }

  // ── DRAG-TO-REORDER CLIENTS ────────────────────────────────
  function setupClientDrag(list, clients, onDrop) {
    let dragging = null;
    list.querySelectorAll('.client-item[draggable]').forEach(item => {
      item.addEventListener('dragstart', e => {
        dragging = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        dragging = null;
        item.classList.remove('dragging');
        list.querySelectorAll('.client-item').forEach(i => i.classList.remove('drag-over'));
        // Compute new order
        const newOrder = [...list.querySelectorAll('.client-item[draggable]')]
          .map(i => i.dataset.client);
        onDrop(newOrder);
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        if (item !== dragging) {
          list.querySelectorAll('.client-item').forEach(i => i.classList.remove('drag-over'));
          item.classList.add('drag-over');
          const rect = item.getBoundingClientRect();
          const after = e.clientY > rect.top + rect.height / 2;
          if (after) item.after(dragging);
          else item.before(dragging);
        }
      });
    });
  }

  // ── EMPLOYEE SELECTS ───────────────────────────────────────
  function populateEmployeeSelects(employees) {
    const selects = ['employee-filter', 'modal-assign-select', 'new-assign'];
    selects.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const val = sel.value;
      const firstOpt = id === 'employee-filter' ? '<option value="">All Employees</option>' : '<option value="">Unassigned</option>';
      sel.innerHTML = firstOpt + employees.map(e =>
        `<option value="${escHtml(e.name)}">${escHtml(e.name)}</option>`
      ).join('');
      sel.value = val; // restore
    });
  }

  function renderEmployeeList(employees, onDelete) {
    const ul = document.getElementById('employee-list-ui');
    if (!ul) return;
    if (employees.length === 0) {
      ul.innerHTML = '<li style="color:var(--text-muted);font-size:.85rem">No employees added yet.</li>';
      return;
    }
    ul.innerHTML = employees.map(e => `
      <li>
        <div>
          <strong>${escHtml(e.name)}</strong>
          ${e.email ? `<br><small style="color:var(--text-muted)">${escHtml(e.email)}</small>` : ''}
        </div>
        <button class="emp-remove" data-id="${e.id}" title="Remove">Remove</button>
      </li>`).join('');
    ul.querySelectorAll('.emp-remove').forEach(btn => {
      btn.addEventListener('click', () => onDelete(btn.dataset.id));
    });
  }

  // ── MAIN TASK RENDER ───────────────────────────────────────
  function renderTasks(tasks, clients, activeClientId, activeFilter, searchQuery, employeeFilter, onTaskClick, onToggleComplete) {
    const sections  = document.getElementById('task-sections');
    const completed = document.getElementById('completed-list');
    const emptyEl   = document.getElementById('empty-state');
    const cCount    = document.getElementById('completed-count');

    // Apply filters
    let filtered = [...tasks];

    if (activeClientId !== 'all') {
      filtered = filtered.filter(t => t.clientId === activeClientId);
    }
    if (activeFilter === 'urgent') filtered = filtered.filter(t => t.priority === 'urgent' && t.status === 'pending');
    if (activeFilter === 'medium') filtered = filtered.filter(t => t.priority === 'medium' && t.status === 'pending');
    if (activeFilter === 'low')    filtered = filtered.filter(t => t.priority === 'low'    && t.status === 'pending');
    if (activeFilter === 'mine')   filtered = filtered.filter(t => t.assignedTo && t.status === 'pending');
    if (employeeFilter)            filtered = filtered.filter(t => t.assignedTo === employeeFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.clientName?.toLowerCase().includes(q) ||
        t.summary?.toLowerCase().includes(q) ||
        t.assignedTo?.toLowerCase().includes(q)
      );
    }

    const pendingTasks   = filtered.filter(t => t.status === 'pending');
    const completedTasks = filtered.filter(t => t.status === 'completed');

    // ── Render pending tasks grouped by client ──
    sections.innerHTML = '';

    if (pendingTasks.length === 0 && completedTasks.length === 0) {
      sections.appendChild(emptyEl || createEmptyState());
      emptyEl && (emptyEl.style.display = 'flex');
    } else {
      emptyEl && (emptyEl.style.display = 'none');

      // Group by client
      const grouped = {};
      pendingTasks.forEach(t => {
        if (!grouped[t.clientId]) grouped[t.clientId] = { name: t.clientName, tasks: [] };
        grouped[t.clientId].tasks.push(t);
      });

      // Determine client color
      const clientColorMap = {};
      clients.forEach(c => { clientColorMap[c.id] = c.color || '#6366f1'; });

      Object.entries(grouped).forEach(([clientId, { name, tasks: clientTasks }]) => {
        const color   = clientColorMap[clientId] || '#6366f1';
        const section = buildClientSection(clientId, name, color, clientTasks, onTaskClick, onToggleComplete);
        sections.appendChild(section);
      });
    }

    // ── Render completed tasks ──
    cCount.textContent = completedTasks.length;
    completed.innerHTML = '';
    completedTasks.forEach(task => {
      completed.appendChild(buildTaskCard(task, onTaskClick, onToggleComplete));
    });
  }

  function buildClientSection(clientId, clientName, color, tasks, onTaskClick, onToggleComplete) {
    const section = document.createElement('div');
    section.className = 'client-section';
    section.dataset.clientId = clientId;

    section.innerHTML = `
      <div class="client-section-header">
        <span class="client-section-dot" style="background:${color}"></span>
        <span class="client-section-name">${escHtml(clientName)}</span>
        <span class="client-section-count">${tasks.length}</span>
        <svg class="client-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="client-section-tasks"></div>`;

    const header    = section.querySelector('.client-section-header');
    const tasksDiv  = section.querySelector('.client-section-tasks');

    header.addEventListener('click', () => section.classList.toggle('collapsed'));

    tasks.forEach(task => tasksDiv.appendChild(buildTaskCard(task, onTaskClick, onToggleComplete)));

    return section;
  }

  function buildTaskCard(task, onTaskClick, onToggleComplete) {
    const card = document.createElement('div');
    card.className = `task-card ${task.status === 'completed' ? 'completed' : ''}`;
    card.dataset.taskId   = task.id;
    card.dataset.priority = task.priority || 'medium';

    const dateStr = task.updatedAt?.seconds
      ? new Date(task.updatedAt.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : '';

    const assignedHtml = task.assignedTo ? `
      <span class="task-assignee">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        ${escHtml(task.assignedTo)}
      </span>` : '';

    card.innerHTML = `
      <div class="task-checkbox" title="${task.status === 'completed' ? 'Mark pending' : 'Mark complete'}"></div>
      <div class="task-body">
        <div class="task-title">${escHtml(task.title)}</div>
        <div class="task-meta">
          <span class="badge badge-${task.priority || 'medium'}">${task.priority || 'medium'}</span>
          ${assignedHtml}
          ${dateStr ? `<span class="task-date">${dateStr}</span>` : ''}
          ${task.source === 'email' ? '<span class="badge badge-assigned">Email</span>' : ''}
        </div>
      </div>`;

    card.querySelector('.task-checkbox').addEventListener('click', e => {
      e.stopPropagation();
      onToggleComplete(task.id, task.status);
    });

    card.addEventListener('click', () => onTaskClick(task));

    return card;
  }

  function createEmptyState() {
    const el = document.createElement('div');
    el.id = 'empty-state';
    el.className = 'empty-state';
    el.innerHTML = `
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#f1f5f9"/>
        <path d="M25 35 Q40 20 55 35 Q40 50 25 35Z" fill="#cbd5e1"/>
        <rect x="30" y="42" width="20" height="3" rx="1.5" fill="#94a3b8"/>
        <rect x="33" y="49" width="14" height="3" rx="1.5" fill="#94a3b8"/>
      </svg>
      <p>No tasks yet. Tasks will appear after your first email sync.</p>
      <small>First sync processes last 30 days of emails.</small>`;
    return el;
  }

  // ── TASK DETAIL MODAL ──────────────────────────────────────
  function openTaskModal(task, employees) {
    const overlay = document.getElementById('task-modal-overlay');

    // Priority badge
    const pb = document.getElementById('modal-priority-badge');
    pb.textContent = task.priority || 'medium';
    pb.className = `badge badge-${task.priority || 'medium'}`;

    // Client badge
    document.getElementById('modal-client-badge').textContent = task.clientName || '';

    document.getElementById('modal-title').textContent       = task.title || '';
    document.getElementById('modal-summary').textContent     = task.summary || 'No summary available.';
    document.getElementById('modal-responsible').textContent = task.responsible || 'Not specified.';
    document.getElementById('modal-thread').textContent      = task.threadSummary || 'No thread summary available.';

    // Actionables
    const actList = document.getElementById('modal-actionables');
    actList.innerHTML = '';
    const acts = Array.isArray(task.actionables) ? task.actionables : [];
    if (acts.length === 0) {
      actList.innerHTML = '<li>No specific actionables extracted.</li>';
    } else {
      acts.forEach(a => {
        const li = document.createElement('li');
        li.textContent = a;
        actList.appendChild(li);
      });
    }

    // Priority select
    document.getElementById('modal-priority-select').value = task.priority || 'medium';

    // Assign select
    const assignSel = document.getElementById('modal-assign-select');
    assignSel.innerHTML = '<option value="">Unassigned</option>' +
      employees.map(e => `<option value="${escHtml(e.name)}">${escHtml(e.name)}</option>`).join('');
    assignSel.value = task.assignedTo || '';

    // Status toggle
    document.getElementById('modal-status-toggle').checked = task.status === 'completed';

    overlay.dataset.taskId = task.id;
    overlay.classList.remove('hidden');
  }

  function closeTaskModal() {
    document.getElementById('task-modal-overlay').classList.add('hidden');
  }

  // ── ADD TASK MODAL ─────────────────────────────────────────
  function openAddTaskModal(employees) {
    populateEmployeeSelects(employees);
    document.getElementById('new-client').value      = '';
    document.getElementById('new-title').value       = '';
    document.getElementById('new-summary').value     = '';
    document.getElementById('new-actionables').value = '';
    document.getElementById('new-priority').value    = 'medium';
    document.getElementById('new-assign').value      = '';
    document.getElementById('new-responsible').value = '';
    document.getElementById('add-task-modal-overlay').classList.remove('hidden');
  }

  function closeAddTaskModal() {
    document.getElementById('add-task-modal-overlay').classList.add('hidden');
  }

  // ── EMPLOYEE MODAL ─────────────────────────────────────────
  function openEmployeeModal(employees, onDelete) {
    renderEmployeeList(employees, onDelete);
    document.getElementById('emp-name').value  = '';
    document.getElementById('emp-email').value = '';
    document.getElementById('add-employee-modal-overlay').classList.remove('hidden');
  }

  function closeEmployeeModal() {
    document.getElementById('add-employee-modal-overlay').classList.add('hidden');
  }

  // ── ADD CLIENT MODAL ───────────────────────────────────────
  function openAddClientModal() {
    document.getElementById('client-name-input').value = '';
    document.getElementById('client-color-input').value = '#6366f1';
    document.getElementById('add-client-modal-overlay').classList.remove('hidden');
  }

  function closeAddClientModal() {
    document.getElementById('add-client-modal-overlay').classList.add('hidden');
  }

  // ── MOBILE SIDEBAR ─────────────────────────────────────────
  function setupMobileSidebar() {
    const toggle  = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);

    function open() {
      sidebar.classList.add('open');
      backdrop.classList.add('open');
    }
    function close() {
      sidebar.classList.remove('open');
      backdrop.classList.remove('open');
    }

    toggle.addEventListener('click', () => sidebar.classList.contains('open') ? close() : open());
    backdrop.addEventListener('click', close);

    return close;
  }

  // ── CONTENT TITLE ──────────────────────────────────────────
  function setContentTitle(title) {
    const el = document.getElementById('content-title');
    if (el) el.textContent = title;
  }

  // ── FILTER CHIPS ───────────────────────────────────────────
  function setActiveFilter(filter) {
    document.querySelectorAll('.filter-chips .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === filter);
    });
  }

  // ── UTILITY ────────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    toast, setSyncStatus, updateStats,
    renderClientList, renderTasks, populateEmployeeSelects, renderEmployeeList,
    openTaskModal, closeTaskModal,
    openAddTaskModal, closeAddTaskModal,
    openEmployeeModal, closeEmployeeModal,
    openAddClientModal, closeAddClientModal,
    setupMobileSidebar, setContentTitle, setActiveFilter,
    escHtml,
  };
})();

window.UI = UI;
