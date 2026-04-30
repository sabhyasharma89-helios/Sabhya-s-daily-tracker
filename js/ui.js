/**
 * UI — pure rendering and DOM helpers.
 * All state reads come from App.state; writes go through App.* methods.
 */
const UI = (() => {

  /* ============================================================
     TOAST NOTIFICATIONS
     ============================================================ */

  function toast(message, type = 'info', duration = 3500) {
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-text">${message}</span>`;
    const container = document.getElementById('toast-container');
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = '0.3s';
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  /* ============================================================
     MODAL HELPERS
     ============================================================ */

  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const firstInput = m.querySelector('input, select, textarea');
    setTimeout(() => firstInput && firstInput.focus(), 300);
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => {
      m.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = '';
  }

  /* ============================================================
     SCREEN SWITCHING
     ============================================================ */

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const s = document.getElementById(id);
    if (s) s.classList.add('active');
  }

  /* ============================================================
     STATS BAR
     ============================================================ */

  function updateStats(data, filters) {
    const all = TaskDB.getAllTasks(data);
    const pending = all.filter(t => t.status === 'pending');
    const completed = all.filter(t => t.status === 'completed');

    document.getElementById('stat-total-val').textContent = all.length;
    document.getElementById('stat-pending-val').textContent = pending.length;
    document.getElementById('stat-completed-val').textContent = completed.length;
    document.getElementById('stat-urgent-val').textContent = pending.filter(t => t.priority === 'high').length;
    document.getElementById('stat-medium-val').textContent = pending.filter(t => t.priority === 'medium').length;
    document.getElementById('stat-low-val').textContent = pending.filter(t => t.priority === 'low').length;

    // Active filter highlight
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
    if (filters.stat) {
      document.getElementById('stat-' + {
        all: 'all', pending: 'pend', completed: 'comp', high: 'urg', medium: 'med', low: 'lo'
      }[filters.stat])?.classList.add('active');
    }
  }

  /* ============================================================
     CLIENT TABS
     ============================================================ */

  function renderTabs(data, activeClient, onSelect, onReorder) {
    const wrapper = document.getElementById('client-tabs');
    const sorted = Object.values(data.clients).sort((a, b) => a.order - b.order);

    wrapper.innerHTML = '';

    // "All Clients" tab
    const allTab = _makeTab('All Clients', '__all__', activeClient === '__all__');
    const allCount = TaskDB.getAllTasks(data).filter(t => t.status === 'pending').length;
    allTab.querySelector('.tab-count').textContent = allCount;
    allTab.addEventListener('click', () => onSelect('__all__'));
    wrapper.appendChild(allTab);

    // Per-client tabs
    sorted.forEach((client, i) => {
      const pendingCount = client.tasks.filter(t => t.status === 'pending').length;
      const tab = _makeTab(client.name, client.name, activeClient === client.name);
      tab.querySelector('.tab-count').textContent = pendingCount;
      tab.addEventListener('click', () => onSelect(client.name));

      // Drag-to-reorder
      tab.draggable = true;
      tab.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', client.name);
        tab.classList.add('dragging');
      });
      tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
      tab.addEventListener('dragover', e => { e.preventDefault(); tab.classList.add('drag-over'); });
      tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));
      tab.addEventListener('drop', e => {
        e.preventDefault();
        tab.classList.remove('drag-over');
        const from = e.dataTransfer.getData('text/plain');
        if (from !== client.name) onReorder(from, client.name);
      });

      wrapper.appendChild(tab);
    });
  }

  function _makeTab(label, key, active) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (active ? ' active' : '');
    btn.dataset.client = key;
    btn.innerHTML = `${_esc(label)}<span class="tab-count">0</span>`;
    return btn;
  }

  /* ============================================================
     TASK LIST
     ============================================================ */

  function renderTasks(data, filters, onAction) {
    const allTasks = TaskDB.getAllTasks(data);

    // Filter
    let tasks = allTasks.filter(t => {
      if (filters.client && filters.client !== '__all__' && t.clientName !== filters.client) return false;
      if (filters.status && filters.status !== 'all' && t.status !== filters.status) return false;
      if (filters.priority && filters.priority !== 'all' && t.priority !== filters.priority) return false;
      if (filters.employee && filters.employee !== 'all' && t.assignedTo !== filters.employee) return false;
      if (filters.stat) {
        if (filters.stat === 'pending' && t.status !== 'pending') return false;
        if (filters.stat === 'completed' && t.status !== 'completed') return false;
        if (['high', 'medium', 'low'].includes(filters.stat) && (t.priority !== filters.stat || t.status !== 'pending')) return false;
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) &&
            !t.clientName.toLowerCase().includes(q) &&
            !(t.assignedTo || '').toLowerCase().includes(q) &&
            !(t.description || '').toLowerCase().includes(q) &&
            !(t.summary || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const pending = tasks.filter(t => t.status === 'pending');
    const completed = tasks.filter(t => t.status === 'completed');

    // Sort pending: high → medium → low, then by date desc
    const priorityRank = { high: 0, medium: 1, low: 2 };
    pending.sort((a, b) => {
      const pDiff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
      if (pDiff !== 0) return pDiff;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    // Active list
    const activeEl = document.getElementById('active-tasks-list');
    const emptyEl = document.getElementById('empty-state');

    if (pending.length === 0) {
      activeEl.innerHTML = '';
      emptyEl?.classList.remove('hidden');
    } else {
      emptyEl?.classList.add('hidden');

      if (filters.client === '__all__') {
        // Group by client
        const groups = {};
        pending.forEach(t => {
          if (!groups[t.clientName]) groups[t.clientName] = [];
          groups[t.clientName].push(t);
        });
        activeEl.innerHTML = Object.entries(groups).map(([cname, ctasks]) =>
          `<div class="client-group">
             <div class="client-group-header">
               <span>${_esc(cname)}</span>
               <span class="client-group-count">${ctasks.length}</span>
             </div>
             ${ctasks.map(t => _taskCardHTML(t)).join('')}
           </div>`
        ).join('');
      } else {
        activeEl.innerHTML = pending.map(t => _taskCardHTML(t)).join('');
      }

      // Bind card events
      _bindCardEvents(activeEl, onAction);
    }

    // Completed list
    const completedEl = document.getElementById('completed-tasks-list');
    const badge = document.getElementById('completed-count-badge');
    badge.textContent = completed.length;

    if (completed.length === 0) {
      completedEl.innerHTML = '<div style="padding:12px;text-align:center;font-size:0.85rem;color:var(--text-3)">No completed tasks</div>';
      document.getElementById('completed-section').style.display = 'none';
    } else {
      document.getElementById('completed-section').style.display = '';
      const sortedCompleted = completed.sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt));
      completedEl.innerHTML = sortedCompleted.map(t => _taskCardHTML(t)).join('');
      _bindCardEvents(completedEl, onAction);
    }
  }

  function _taskCardHTML(task) {
    const isCompleted = task.status === 'completed';
    const priorityLabel = { high: '🔴 Urgent', medium: '🟡 Medium', low: '🟢 Low' };
    const sourceLabel = task.source === 'email' ? '📧 Email' : '✍️ Manual';
    const dateStr = _formatDate(task.updatedAt);

    return `
    <div class="task-card${isCompleted ? ' completed' : ''}" data-id="${task.id}" data-priority="${task.priority}">
      <div class="task-card-header">
        <div class="task-checkbox" data-action="toggle" data-id="${task.id}" title="${isCompleted ? 'Reopen' : 'Complete'}">
          ${isCompleted ? '✓' : ''}
        </div>
        <div class="task-card-content">
          <div class="task-card-top">
            <span class="priority-badge ${task.priority}">${priorityLabel[task.priority] || task.priority}</span>
            <span class="task-source-badge">${sourceLabel}</span>
          </div>
          <div class="task-title">${_esc(task.title)}</div>
          <div class="task-meta">
            ${task.assignedTo ? `<span class="task-meta-item"><span class="meta-icon">👤</span>${_esc(task.assignedTo)}</span>` : ''}
            ${task.clientName ? `<span class="task-meta-item"><span class="meta-icon">🏢</span>${_esc(task.clientName)}</span>` : ''}
            <span class="task-meta-item"><span class="meta-icon">🕐</span>${dateStr}</span>
          </div>
        </div>
        <button class="task-expand-btn" data-action="expand" data-id="${task.id}" aria-label="Expand">›</button>
      </div>
      <div class="task-body" id="task-body-${task.id}">
        ${_taskBodyHTML(task)}
      </div>
    </div>`;
  }

  function _taskBodyHTML(task) {
    return `
      ${task.summary ? `
        <div class="task-body-section">
          <h4>Summary</h4>
          <div class="task-summary">${_esc(task.summary)}</div>
        </div>` : ''}
      ${task.description && !task.summary ? `
        <div class="task-body-section">
          <h4>Description</h4>
          <div class="task-summary">${_esc(task.description)}</div>
        </div>` : ''}
      ${task.actionables && task.actionables.length ? `
        <div class="task-body-section">
          <h4>Action Items</h4>
          <ul class="actionables-list">
            ${task.actionables.map(a => `<li>${_esc(a)}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${task.responsibleParty ? `
        <div class="task-body-section">
          <h4>Responsible Party</h4>
          <span class="task-meta-item"><span class="meta-icon">👤</span>${_esc(task.responsibleParty)}</span>
        </div>` : ''}
      ${task.emailHistory && task.emailHistory.length ? `
        <div class="task-body-section">
          <h4>Email Thread (${task.emailHistory.length} messages)</h4>
          <div class="email-history">
            ${task.emailHistory.map(e => `
              <div class="email-item">
                <div style="display:flex;justify-content:space-between">
                  <span class="email-item-from">${_esc(e.from || 'Unknown')}</span>
                  <span class="email-item-date">${_formatDate(e.date)}</span>
                </div>
                <div class="email-item-snippet">${_esc(e.snippet || '')}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
      <div class="task-actions">
        <button class="task-action-btn" data-action="edit" data-id="${task.id}">✏️ Edit</button>
        <button class="task-action-btn" data-action="priority" data-id="${task.id}">🔼 Priority</button>
        <button class="task-action-btn" data-action="assign" data-id="${task.id}">👤 Assign</button>
        ${task.status === 'completed'
          ? `<button class="task-action-btn" data-action="reopen" data-id="${task.id}">↩ Reopen</button>`
          : `<button class="task-action-btn" data-action="complete" data-id="${task.id}">✓ Complete</button>`}
        <button class="task-action-btn danger" data-action="delete" data-id="${task.id}">🗑 Delete</button>
      </div>`;
  }

  function _bindCardEvents(container, onAction) {
    container.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        onAction(el.dataset.action, el.dataset.id, el);
      });
    });

    // Also handle header click → expand
    container.querySelectorAll('.task-card-header').forEach(h => {
      h.addEventListener('click', () => {
        const card = h.closest('.task-card');
        const id = card?.dataset.id;
        if (id) onAction('expand', id);
      });
    });
  }

  /* ============================================================
     TASK FORM MODAL
     ============================================================ */

  function openTaskForm(data, task = null) {
    const isEdit = !!task;
    document.getElementById('task-form-title').textContent = isEdit ? 'Edit Task' : 'Add Task';
    document.getElementById('edit-task-id').value = task?.id || '';
    document.getElementById('edit-task-client-original').value = task?.clientName || '';
    document.getElementById('form-task-title').value = task?.title || '';
    document.getElementById('form-task-client').value = task?.clientName || '';
    document.getElementById('form-task-priority').value = task?.priority || 'medium';
    document.getElementById('form-task-assigned').value = task?.assignedTo || '';
    document.getElementById('form-task-description').value = task?.description || '';

    // Populate datalists
    const clientDL = document.getElementById('form-client-datalist');
    clientDL.innerHTML = Object.keys(data.clients).map(n => `<option value="${_esc(n)}">`).join('');

    const empDL = document.getElementById('form-employee-datalist');
    empDL.innerHTML = (data.employees || []).map(e => `<option value="${_esc(e)}">`).join('');

    openModal('task-form-modal');
  }

  /* ============================================================
     DETAIL MODAL
     ============================================================ */

  function openDetailModal(task, data, onAction) {
    const priorityLabel = { high: '🔴 Urgent', medium: '🟡 Medium', low: '🟢 Low' };

    document.getElementById('detail-title').textContent = task.title;
    const pb = document.getElementById('detail-priority-badge');
    pb.textContent = priorityLabel[task.priority] || task.priority;
    pb.className = `priority-badge ${task.priority}`;

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-grid">
        <div class="detail-field">
          <label>Client</label>
          <div class="detail-value">🏢 ${_esc(task.clientName)}</div>
        </div>
        <div class="detail-field">
          <label>Status</label>
          <div class="detail-value">${task.status === 'completed' ? '✅ Completed' : '⏳ Pending'}</div>
        </div>
        <div class="detail-field">
          <label>Assigned To</label>
          <div class="detail-value">${task.assignedTo ? '👤 ' + _esc(task.assignedTo) : '— Unassigned'}</div>
        </div>
        <div class="detail-field">
          <label>Source</label>
          <div class="detail-value">${task.source === 'email' ? '📧 Email' : '✍️ Manual'}</div>
        </div>
        <div class="detail-field">
          <label>Created</label>
          <div class="detail-value">${_formatDate(task.createdAt, true)}</div>
        </div>
        <div class="detail-field">
          <label>Last Updated</label>
          <div class="detail-value">${_formatDate(task.updatedAt, true)}</div>
        </div>
      </div>
      ${task.emailSubject ? `<div class="detail-field"><label>Email Subject</label><div class="detail-value">📧 ${_esc(task.emailSubject)}</div></div>` : ''}
      ${task.participants && task.participants.length ? `<div class="detail-field"><label>Participants</label><div class="detail-value">${task.participants.map(_esc).join(', ')}</div></div>` : ''}
      ${_taskBodyHTML(task)}
    `;

    document.getElementById('detail-footer').innerHTML = `
      <button class="btn-primary" data-action="edit" data-id="${task.id}">✏️ Edit Task</button>
      ${task.status === 'completed'
        ? `<button class="btn-secondary" data-action="reopen" data-id="${task.id}">↩ Reopen</button>`
        : `<button class="btn-secondary" data-action="complete" data-id="${task.id}">✓ Mark Complete</button>`}
      <button class="btn-secondary" data-action="assign" data-id="${task.id}">👤 Assign</button>
    `;

    document.getElementById('detail-body').querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); onAction(el.dataset.action, el.dataset.id); });
    });
    document.getElementById('detail-footer').querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); onAction(el.dataset.action, el.dataset.id); });
    });

    openModal('detail-modal');
  }

  /* ============================================================
     SETTINGS MODAL
     ============================================================ */

  function openSettings(data) {
    const cfg = TaskDB.getConfig() || {};
    document.getElementById('cfg-owner').value = cfg.owner || '';
    document.getElementById('cfg-repo').value = cfg.repo || '';
    document.getElementById('cfg-token').value = cfg.token || '';
    document.getElementById('cfg-branch').value = cfg.branch || 'main';

    _renderEmployeeList(data);

    const meta = data.metadata || {};
    document.getElementById('last-sync-info').textContent =
      meta.lastProcessed ? `Last email sync: ${_formatDate(meta.lastProcessed, true)}` : 'No email sync yet';

    openModal('settings-modal');
  }

  function _renderEmployeeList(data) {
    const el = document.getElementById('employees-list');
    const emps = data.employees || [];
    if (emps.length === 0) {
      el.innerHTML = '<li style="font-size:0.85rem;color:var(--text-3);padding:8px">No employees added yet</li>';
      return;
    }
    el.innerHTML = emps.map(e => `
      <li class="employee-item">
        <span>👤 ${_esc(e)}</span>
        <button class="employee-remove" data-employee="${_esc(e)}" title="Remove">✕</button>
      </li>`).join('');
  }

  function refreshEmployeeList(data) {
    _renderEmployeeList(data);
    // Update filter dropdown
    const sel = document.getElementById('filter-employee');
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All Employees</option>' +
      (data.employees || []).map(e => `<option value="${_esc(e)}"${cur === e ? ' selected' : ''}>${_esc(e)}</option>`).join('');
  }

  /* ============================================================
     UTILS
     ============================================================ */

  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _formatDate(iso, full = false) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (full) return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  function setSyncStatus(status, text) {
    const el = document.getElementById('sync-status');
    const textEl = document.getElementById('sync-text');
    el.className = 'sync-status ' + status;
    textEl.textContent = text;
  }

  function updateFilterEmployeeDropdown(data) {
    const sel = document.getElementById('filter-employee');
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All Employees</option>' +
      (data.employees || []).map(e => `<option value="${_esc(e)}"${cur === e ? ' selected' : ''}>${_esc(e)}</option>`).join('');
  }

  return {
    toast, openModal, closeModal, closeAllModals, showScreen,
    updateStats, renderTabs, renderTasks,
    openTaskForm, openDetailModal, openSettings, refreshEmployeeList,
    setSyncStatus, updateFilterEmployeeDropdown
  };
})();
