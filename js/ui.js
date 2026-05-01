/* ═══════════════════════════════════════
   UI  –  rendering + event wiring
═══════════════════════════════════════ */
const UI = (() => {

  /* ── Toast ───────────────────────────────────────── */
  let _toastEl;
  function _ensureToast() {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.id = 'toastContainer';
      document.body.appendChild(_toastEl);
    }
  }
  function toast(msg, type = 'info', duration = 3000) {
    _ensureToast();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${msg}</span>`;
    _toastEl.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, duration);
  }

  /* ── Screen switching ────────────────────────────── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const s = document.getElementById(id);
    if (s) s.classList.add('active');
  }

  /* ── Modal helpers ───────────────────────────────── */
  window.closeModal = function(id, e) {
    if (e && e.target !== document.getElementById(id)) return;
    document.getElementById(id)?.classList.add('hidden');
  };

  function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }

  /* ── Priority icon ───────────────────────────────── */
  function _priIcon(p) {
    return p === 'urgent' ? '🔴' : p === 'medium' ? '🟡' : '🟢';
  }

  /* ── Stats bar ───────────────────────────────────── */
  async function updateStats() {
    const s = await Tasks.getStats();
    document.getElementById('statTotal').textContent     = s.total;
    document.getElementById('statPending').textContent   = s.pending;
    document.getElementById('statUrgent').textContent    = s.urgent;
    document.getElementById('statMedium').textContent    = s.medium;
    document.getElementById('statLow').textContent       = s.low;
    document.getElementById('statCompleted').textContent = s.completed;
  }

  /* ── Filter dropdowns ────────────────────────────── */
  async function refreshFilterDropdowns() {
    const clients   = await Tasks.getAllClients();
    const assignees = await Tasks.getUniqueAssignees();

    const fc = document.getElementById('filterClient');
    const saved = fc.value;
    fc.innerHTML = '<option value="all">All Clients</option>';
    clients.forEach(c => {
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.name;
      fc.appendChild(o);
    });
    fc.value = saved;

    const fa   = document.getElementById('filterAssignee');
    const savA = fa.value;
    fa.innerHTML = '<option value="all">All Assignees</option>';
    assignees.forEach(a => {
      const o = document.createElement('option'); o.value = a; o.textContent = a;
      fa.appendChild(o);
    });
    fa.value = savA;

    // Datalists for add-task form
    const cdl = document.getElementById('clientsDatalist');
    cdl.innerHTML = '';
    clients.forEach(c => { const o = document.createElement('option'); o.value = c.name; cdl.appendChild(o); });

    const adl = document.getElementById('assigneesDatalist');
    adl.innerHTML = '';
    assignees.forEach(a => { const o = document.createElement('option'); o.value = a; adl.appendChild(o); });
  }

  /* ── Task card HTML ──────────────────────────────── */
  function _taskCard(task, compact = false) {
    const isCompleted = task.status === 'completed';
    const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : '';
    const priorityLabel = isCompleted ? 'done' : task.priority;

    const card = document.createElement('div');
    card.className = `task-card${isCompleted ? ' completed-card' : ''}`;
    card.dataset.id = task.id;

    card.innerHTML = `
      <div class="task-card-header">
        <div class="task-check${isCompleted ? ' checked' : ''}" data-action="toggle" data-id="${task.id}" title="${isCompleted ? 'Mark pending' : 'Mark complete'}"></div>
        <div class="task-card-main">
          <div class="task-title" title="${_esc(task.title)}">${_esc(task.title)}</div>
          <div class="task-meta">
            <span class="priority-badge ${priorityLabel}">${_priIcon(task.priority)} ${task.priority}</span>
            ${task.assignee ? `<span class="task-assignee-chip">👤 ${_esc(task.assignee)}</span>` : ''}
            ${due ? `<span class="task-date-chip">📅 ${due}</span>` : ''}
            ${task.source === 'email' ? `<svg class="task-source-icon" viewBox="0 0 24 24" title="From email"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="1.5" fill="none"/><polyline points="22,6 12,13 2,6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>` : ''}
          </div>
        </div>
      </div>
      <div class="task-card-actions">
        <button class="task-action-btn" data-action="view"   data-id="${task.id}">📋 View Details</button>
        <button class="task-action-btn" data-action="edit"   data-id="${task.id}">✏️ Edit</button>
        <button class="task-action-btn ${task.priority==='urgent'?'':'urgent-btn'}" data-action="priority" data-id="${task.id}" data-priority="${task.priority}">
          ${task.priority === 'urgent' ? '🟡 Set Medium' : task.priority === 'medium' ? '🔴 Set Urgent' : '🟡 Set Medium'}
        </button>
        <button class="task-action-btn" data-action="assign" data-id="${task.id}">👤 Assign</button>
      </div>`;

    card.addEventListener('click', _handleCardClick);
    return card;
  }

  function _handleCardClick(e) {
    const btn   = e.target.closest('[data-action]');
    const card  = e.currentTarget;
    if (!btn) {
      card.classList.toggle('expanded');
      return;
    }
    e.stopPropagation();
    const id     = parseInt(btn.dataset.id, 10);
    const action = btn.dataset.action;
    if (action === 'toggle')   App.toggleTask(id);
    if (action === 'view')     UI.showTaskDetail(id);
    if (action === 'edit')     UI.showEditTask(id);
    if (action === 'priority') App.cyclePriority(id);
    if (action === 'assign')   App.promptAssign(id);
  }

  function _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Main render ─────────────────────────────────── */
  async function renderDashboard(filters = {}) {
    const tasks   = await Tasks.getAllTasks(filters);
    const clients = await Tasks.getAllClients();

    await updateStats();
    await refreshFilterDropdowns();

    const pending   = tasks.filter(t => t.status === 'pending');
    const completed = tasks.filter(t => t.status === 'completed');

    const container   = document.getElementById('clientsContainer');
    const compContainer = document.getElementById('completedContainer');
    const emptyState  = document.getElementById('emptyState');
    const compCount   = document.getElementById('completedCount');

    container.innerHTML   = '';
    compContainer.innerHTML = '';
    compCount.textContent = completed.length;

    if (!pending.length && !completed.length) {
      emptyState.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
    }

    // Group pending tasks by client
    const byClient = {};
    for (const task of pending) {
      if (!byClient[task.clientId]) byClient[task.clientId] = [];
      byClient[task.clientId].push(task);
    }

    const PRIORITY_ORDER = { urgent: 0, medium: 1, low: 2 };

    // Render client sections for pending tasks
    for (const client of clients) {
      const clientTasks = byClient[client.id];
      if (!clientTasks || !clientTasks.length) continue;

      clientTasks.sort((a, b) => (PRIORITY_ORDER[a.priority] || 1) - (PRIORITY_ORDER[b.priority] || 1));

      const section = document.createElement('div');
      section.className = 'client-section expanded';
      section.dataset.clientId = client.id;
      section.innerHTML = `
        <div class="client-header" data-client="${client.id}">
          <div class="client-header-left">
            <div class="client-color-dot" style="background:${client.color}"></div>
            <span class="client-name">${_esc(client.name)}</span>
            <span class="client-task-count">${clientTasks.length}</span>
          </div>
          <div class="client-header-right">
            <svg class="client-expand-icon" viewBox="0 0 24 24" width="16" height="16"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </div>
        </div>
        <div class="client-tasks"></div>`;

      const header     = section.querySelector('.client-header');
      const tasksDiv   = section.querySelector('.client-tasks');

      header.addEventListener('click', () => section.classList.toggle('expanded'));

      clientTasks.forEach(task => tasksDiv.appendChild(_taskCard(task)));
      container.appendChild(section);
    }

    // Completed tasks
    for (const task of completed) {
      compContainer.appendChild(_taskCard(task));
    }
  }

  /* ── Task Detail Modal ───────────────────────────── */
  async function showTaskDetail(id) {
    const task = await DB.get('tasks', id);
    if (!task) return;

    document.getElementById('mdTaskTitle').textContent = task.title;
    const badge = document.getElementById('mdTaskPriorityBadge');
    badge.className = `priority-badge ${task.status === 'completed' ? 'done' : task.priority}`;
    badge.textContent = `${_priIcon(task.priority)} ${task.priority}`;

    let html = '';

    if (task.summary) {
      html += `<div class="task-detail-section">
        <h4>Thread Summary</h4>
        <p class="thread-summary">${_esc(task.summary)}</p>
      </div>`;
    }

    if (task.actionables && task.actionables.length) {
      html += `<div class="task-detail-section">
        <h4>Actionables</h4>
        <ul class="actionables-list">
          ${task.actionables.map(a => `<li>${_esc(a)}</li>`).join('')}
        </ul>
      </div>`;
    }

    html += `<div class="task-detail-section">
      <h4>Details</h4>
      <div class="detail-meta-grid">
        <div class="detail-meta-item"><label>Client</label><span>${_esc(task.clientName || '—')}</span></div>
        <div class="detail-meta-item"><label>Status</label><span>${task.status === 'completed' ? '✅ Completed' : '⏳ Pending'}</span></div>
        <div class="detail-meta-item"><label>Priority</label><span>${_priIcon(task.priority)} ${task.priority}</span></div>
        <div class="detail-meta-item"><label>Assigned To</label><span>${_esc(task.assignee || '—')}</span></div>
        ${task.responsible ? `<div class="detail-meta-item"><label>Responsible</label><span>${_esc(task.responsible)}</span></div>` : ''}
        ${task.dueDate ? `<div class="detail-meta-item"><label>Due</label><span>${new Date(task.dueDate).toLocaleDateString()}</span></div>` : ''}
        <div class="detail-meta-item"><label>Created</label><span>${new Date(task.createdAt).toLocaleDateString()}</span></div>
        <div class="detail-meta-item"><label>Updated</label><span>${new Date(task.updatedAt).toLocaleDateString()}</span></div>
      </div>
    </div>`;

    if (task.description) {
      html += `<div class="task-detail-section">
        <h4>Description</h4>
        <p class="thread-summary">${_esc(task.description)}</p>
      </div>`;
    }

    // Email thread messages
    if (task.threadIds && task.threadIds.length) {
      for (const tid of task.threadIds) {
        const threadData = await DB.get('emailThreads', tid);
        if (threadData && threadData.messages) {
          html += `<div class="task-detail-section">
            <h4>Email Thread</h4>
            ${threadData.messages.map(m => `
              <div class="email-thread-item">
                <div class="from">${_esc(m.from)}</div>
                <div class="date">${_esc(m.date)} — ${_esc(m.subject)}</div>
                <div class="body">${_esc((m.body || m.snippet || '').slice(0, 800))}${(m.body||'').length > 800 ? '…' : ''}</div>
              </div>`).join('')}
          </div>`;
        }
      }
    }

    html += `<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem">
      <button class="btn-secondary" onclick="UI.showEditTask(${id});closeModal('modalTask')">✏️ Edit Task</button>
      <button class="btn-secondary" onclick="App.toggleTask(${id});closeModal('modalTask')">
        ${task.status === 'completed' ? '↩ Mark Pending' : '✅ Mark Complete'}
      </button>
    </div>`;

    document.getElementById('mdTaskBody').innerHTML = html;
    openModal('modalTask');
  }

  /* ── Add/Edit Task Modal ─────────────────────────── */
  async function showAddTask() {
    document.getElementById('editTaskId').value     = '';
    document.getElementById('addTaskTitle').textContent = 'New Task';
    document.getElementById('taskClient').value      = '';
    document.getElementById('taskTitle').value       = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskPriority').value    = 'medium';
    document.getElementById('taskDueDate').value     = '';
    document.getElementById('taskAssignee').value    = '';
    document.getElementById('taskActionables').value = '';
    openModal('modalAddTask');
  }

  async function showEditTask(id) {
    const task = await DB.get('tasks', id);
    if (!task) return;
    document.getElementById('editTaskId').value      = id;
    document.getElementById('addTaskTitle').textContent = 'Edit Task';
    document.getElementById('taskClient').value       = task.clientName || '';
    document.getElementById('taskTitle').value        = task.title      || '';
    document.getElementById('taskDescription').value  = task.description || '';
    document.getElementById('taskPriority').value     = task.priority    || 'medium';
    document.getElementById('taskDueDate').value      = task.dueDate     ? task.dueDate.slice(0,10) : '';
    document.getElementById('taskAssignee').value     = task.assignee    || '';
    document.getElementById('taskActionables').value  = (task.actionables || []).join('\n');
    openModal('modalAddTask');
  }

  /* ── Settings Modal ──────────────────────────────── */
  async function openSettings() {
    const aKey = await DB.getConfig('anthropicKey');
    const gId  = await DB.getConfig('googleClientId');
    const poll = await DB.getConfig('pollIntervalMin');
    document.getElementById('settingsAnthropicKey').value    = aKey || '';
    document.getElementById('settingsGoogleClientId').value  = gId  || '';
    document.getElementById('settingsPollInterval').value    = poll || 10;

    const userInfo = await Auth.getGmailUserInfo();
    const gmailStatus = document.getElementById('gmailStatus');
    if (userInfo) {
      gmailStatus.innerHTML = `<strong>${_esc(userInfo.name || userInfo.email)}</strong><br><small>${_esc(userInfo.email)}</small>`;
    } else {
      gmailStatus.textContent = 'Not connected';
    }
    openModal('modalSettings');
  }

  /* ── Sync indicator ──────────────────────────────── */
  function setSyncState(active, msg, pct) {
    const bar = document.getElementById('syncBar');
    const msgEl = document.getElementById('syncMsg');
    const pctEl = document.getElementById('syncPct');
    const fill  = document.getElementById('syncFill');
    if (active) {
      bar.classList.remove('hidden');
      msgEl.textContent = msg || 'Syncing…';
      pctEl.textContent = pct != null ? `${pct}%` : '';
      if (pct != null) fill.style.width = pct + '%';
    } else {
      bar.classList.add('hidden');
      fill.style.width = '0%';
      const ts = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      document.getElementById('lastSyncLine').textContent = `Last sync: ${ts}`;
    }
  }

  return { showScreen, toast, renderDashboard, showTaskDetail, showAddTask, showEditTask, openSettings, setSyncState, updateStats, refreshFilterDropdowns };
})();
