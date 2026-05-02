/* ═══════════════════════════════════════════════════════
   UI — DASHBOARD RENDERING & INTERACTIONS
═══════════════════════════════════════════════════════ */

const UI = {
  db: null,
  activeTaskId: null,
  searchQuery: '',
  filters: { status: '', priority: '', employee: '', client: '' },
  filterPanelOpen: false,
  clientOrder: {}, // clientId -> collapsed state

  async init(db) {
    this.db = db;
    await this.render();
  },

  // ─── Full dashboard re-render ────────────────────────────
  async render() {
    await this.renderStats();
    await this.renderClients();
    await this.renderCompleted();
    await this.populateFilterDropdowns();
  },

  // ─── Stats bar ──────────────────────────────────────────
  async renderStats() {
    const stats = await this.db.getStats();
    document.getElementById('stat-total').textContent     = stats.total;
    document.getElementById('stat-pending').textContent   = stats.pending;
    document.getElementById('stat-urgent').textContent    = stats.urgent;
    document.getElementById('stat-medium').textContent    = stats.medium;
    document.getElementById('stat-low').textContent       = stats.low;
    document.getElementById('stat-completed').textContent = stats.completed;

    // Stat card click = quick filter
    document.querySelectorAll('.stat-card').forEach(card => {
      card.onclick = () => {
        const f = card.dataset.filter;
        const fp = card.dataset.filterPriority;
        document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
        if (f !== undefined) {
          if (this.filters.status === f) {
            this.filters.status = '';
          } else {
            this.filters.status = f;
            this.filters.priority = '';
            card.classList.add('active');
          }
        }
        if (fp !== undefined) {
          if (this.filters.priority === fp) {
            this.filters.priority = '';
          } else {
            this.filters.priority = fp;
            this.filters.status = '';
            card.classList.add('active');
          }
        }
        this.renderClients();
      };
    });
  },

  // ─── Client tabs ────────────────────────────────────────
  async renderClients() {
    const container = document.getElementById('clients-container');
    const clients   = await this.db.getAllClients();
    const allTasks  = await this.db.getAllTasks();

    const filteredTasks = allTasks.filter(t => {
      if (t.status === 'completed') return false; // handled separately
      if (this.filters.status === 'pending' && t.status !== 'pending') return false;
      if (this.filters.priority && t.priority !== this.filters.priority) return false;
      if (this.filters.employee && t.assignedTo !== this.filters.employee) return false;
      if (this.filters.client && t.clientId !== this.filters.client) return false;
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        const match = t.title.toLowerCase().includes(q) ||
          (t.clientName || '').toLowerCase().includes(q) ||
          (t.assignedTo || '').toLowerCase().includes(q) ||
          (t.summary || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    // Group by client
    const byClient = {};
    filteredTasks.forEach(t => {
      const cid = t.clientId || '__none__';
      if (!byClient[cid]) byClient[cid] = [];
      byClient[cid].push(t);
    });

    container.innerHTML = '';

    if (!clients.length && !filteredTasks.length) {
      container.innerHTML = `<div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        <p>No tasks yet. Sync your emails or add a task manually.</p>
      </div>`;
      return;
    }

    // Render client with tasks, or tasks with no client
    const renderedClients = new Set();

    for (const client of clients) {
      const tasks = byClient[client.id] || [];
      if (!tasks.length && this.searchQuery) continue; // hide empty clients during search
      renderedClients.add(client.id);
      container.appendChild(this._buildClientTab(client, tasks));
    }

    // Tasks with unrecognised clientId
    const miscTasks = filteredTasks.filter(t => !renderedClients.has(t.clientId));
    if (miscTasks.length) {
      const fakeClient = { id: '__none__', name: 'Uncategorised', color: '#64748b' };
      container.appendChild(this._buildClientTab(fakeClient, miscTasks));
    }
  },

  _buildClientTab(client, tasks) {
    const isOpen = this.clientOrder[client.id] !== false; // default open
    const urgentCount = tasks.filter(t => t.priority === 'urgent').length;
    const mediumCount = tasks.filter(t => t.priority === 'medium').length;
    const lowCount    = tasks.filter(t => t.priority === 'low').length;

    const tab = document.createElement('div');
    tab.className = 'client-tab';
    tab.dataset.clientId = client.id;

    const countBadges = [
      urgentCount ? `<span class="count-badge count-urgent">${urgentCount} urgent</span>` : '',
      mediumCount ? `<span class="count-badge count-medium">${mediumCount} medium</span>` : '',
      lowCount    ? `<span class="count-badge count-low">${lowCount} low</span>` : '',
    ].join('');

    tab.innerHTML = `
      <div class="client-header" onclick="UI.toggleClient('${client.id}')">
        <div class="client-color-dot" style="background:${client.color}"></div>
        <span class="client-name">${this._escHtml(client.name)}</span>
        <div class="client-task-counts">${countBadges}</div>
        <svg class="chevron ${isOpen ? 'open' : ''}" style="margin-left:4px;flex-shrink:0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="client-body ${isOpen ? 'open' : ''}" id="client-body-${client.id}">
        ${this._buildTasksHtml(tasks)}
      </div>`;

    return tab;
  },

  _buildTasksHtml(tasks) {
    if (!tasks.length) {
      return '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">No pending tasks.</p>';
    }

    const priorities = ['urgent', 'medium', 'low'];
    let html = '';

    for (const priority of priorities) {
      const pTasks = tasks.filter(t => t.priority === priority);
      if (!pTasks.length) continue;
      const labels = { urgent: 'Urgent', medium: 'Medium', low: 'Low' };
      html += `<div class="priority-section priority-${priority}">
        <div class="priority-label">${labels[priority]}</div>
        ${pTasks.map(t => this._buildTaskCardHtml(t)).join('')}
      </div>`;
    }
    return html;
  },

  _buildTaskCardHtml(task) {
    const checked = task.status === 'completed';
    const assigned = task.assignedTo ? `<span class="task-assigned">${this._escHtml(task.assignedTo)}</span>` : '';
    const date = task.updatedAt ? new Date(task.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

    return `<div class="task-card priority-${task.priority} ${checked ? 'completed-task' : ''}" onclick="UI.openTask('${task.id}')">
      <div class="task-card-top">
        <div class="task-checkbox ${checked ? 'checked' : ''}" onclick="event.stopPropagation();UI.quickToggle('${task.id}', this)"></div>
        <span class="task-title">${this._escHtml(task.title)}</span>
      </div>
      <div class="task-meta">
        ${date ? `<span class="task-date">${date}</span>` : ''}
        ${assigned}
        ${task.emailSubject ? `<span class="task-date" title="${this._escHtml(task.emailSubject)}">📧 ${this._escHtml(task.emailSubject.substring(0, 30))}${task.emailSubject.length > 30 ? '…' : ''}</span>` : ''}
      </div>
    </div>`;
  },

  // ─── Completed section ───────────────────────────────────
  async renderCompleted() {
    const allTasks = await this.db.getAllTasks();
    let completed = allTasks.filter(t => t.status === 'completed');

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      completed = completed.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.clientName || '').toLowerCase().includes(q) ||
        (t.assignedTo || '').toLowerCase().includes(q)
      );
    }
    if (this.filters.client) completed = completed.filter(t => t.clientId === this.filters.client);
    if (this.filters.employee) completed = completed.filter(t => t.assignedTo === this.filters.employee);

    document.getElementById('completed-count').textContent = completed.length;

    const container = document.getElementById('completed-tasks-container');
    if (!completed.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No completed tasks yet.</p>';
      return;
    }
    container.innerHTML = completed
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .map(t => this._buildTaskCardHtml(t))
      .join('');
  },

  // ─── Toggle client tab ───────────────────────────────────
  toggleClient(clientId) {
    const body    = document.getElementById(`client-body-${clientId}`);
    const header  = body.previousElementSibling;
    const chevron = header.querySelector('.chevron');
    const isOpen  = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    chevron.classList.toggle('open', !isOpen);
    this.clientOrder[clientId] = !isOpen;
  },

  // ─── Toggle completed section ────────────────────────────
  toggleCompleted() {
    const c = document.getElementById('completed-tasks-container');
    const ch = document.getElementById('completed-chevron');
    c.classList.toggle('hidden');
    ch.classList.toggle('open');
  },

  // ─── Quick toggle task status from card checkbox ────────
  async quickToggle(taskId, checkboxEl) {
    const task = await this.db.getTask(taskId);
    if (!task) return;
    if (task.status === 'pending') {
      await this.db.markComplete(taskId);
      checkboxEl.classList.add('checked');
      checkboxEl.closest('.task-card').classList.add('completed-task');
      checkboxEl.closest('.task-card').querySelector('.task-title').style.textDecoration = 'line-through';
    } else {
      await this.db.markPending(taskId);
      checkboxEl.classList.remove('checked');
      checkboxEl.closest('.task-card').classList.remove('completed-task');
      checkboxEl.closest('.task-card').querySelector('.task-title').style.textDecoration = '';
    }
    await this.render();
  },

  // ─── Open task detail modal ─────────────────────────────
  async openTask(taskId) {
    this.activeTaskId = taskId;
    const task    = await this.db.getTask(taskId);
    if (!task) return;
    const thread  = task.threadId ? await this.db.getThread(task.threadId) : null;
    const employees = await this.db.getAllEmployees();

    // Header badges
    document.getElementById('modal-priority-badge').textContent = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
    document.getElementById('modal-priority-badge').className = `priority-badge badge-${task.priority}`;
    document.getElementById('modal-client-badge').textContent = task.clientName || '';

    // Title
    document.getElementById('modal-title').textContent = task.title;

    // Summary
    document.getElementById('modal-summary').textContent = task.summary || 'No summary available.';

    // Actionables
    const actionablesList = document.getElementById('modal-actionables');
    actionablesList.innerHTML = (task.actionables || []).length
      ? (task.actionables).map(a => `<li>${this._escHtml(a)}</li>`).join('')
      : '<li>No actionables listed.</li>';

    // Next steps
    document.getElementById('modal-next-steps').textContent = task.nextStepsPerson
      ? `Next steps with: ${task.nextStepsPerson}`
      : 'Not specified';

    // Email thread
    const threadContainer = document.getElementById('modal-email-thread');
    if (thread && thread.messages?.length) {
      threadContainer.innerHTML = thread.messages.map(m => `
        <div class="email-message">
          <div class="email-message-header">
            <span class="email-from">${this._escHtml(m.from || '')}</span>
            <span class="email-date">${this._escHtml(m.date || '')}</span>
          </div>
          <div class="email-body">${this._escHtml((m.body || '').substring(0, 600))}${(m.body || '').length > 600 ? '\n…' : ''}</div>
        </div>`).join('');
    } else {
      threadContainer.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No email thread available (manually created task).</p>';
    }

    // Priority select
    document.getElementById('modal-priority-select').value = task.priority;

    // Employee assign
    const assignSelect = document.getElementById('modal-assign-select');
    assignSelect.innerHTML = '<option value="">Unassigned</option>' +
      employees.map(e => `<option value="${this._escHtml(e.name)}" ${task.assignedTo === e.name ? 'selected' : ''}>${this._escHtml(e.name)}</option>`).join('');

    // Complete button
    const completeBtn = document.getElementById('modal-complete-btn');
    completeBtn.textContent = task.status === 'completed' ? '↺ Mark as Pending' : '✓ Mark as Complete';
    completeBtn.className = task.status === 'completed' ? 'btn-ghost' : 'btn-secondary';

    document.getElementById('task-modal').classList.remove('hidden');
  },

  async updateTaskPriority(priority) {
    if (!this.activeTaskId) return;
    const task = await this.db.getTask(this.activeTaskId);
    if (!task) return;
    task.priority = priority;
    await this.db.saveTask(task);
    document.getElementById('modal-priority-badge').textContent = priority.charAt(0).toUpperCase() + priority.slice(1);
    document.getElementById('modal-priority-badge').className = `priority-badge badge-${priority}`;
    await this.render();
  },

  async updateTaskAssignment(employeeName) {
    if (!this.activeTaskId) return;
    const task = await this.db.getTask(this.activeTaskId);
    if (!task) return;
    task.assignedTo = employeeName;
    await this.db.saveTask(task);
    await this.renderClients();
  },

  async toggleTaskComplete() {
    if (!this.activeTaskId) return;
    const task = await this.db.getTask(this.activeTaskId);
    if (!task) return;
    if (task.status === 'pending') {
      await this.db.markComplete(this.activeTaskId);
    } else {
      await this.db.markPending(this.activeTaskId);
    }
    await this.openTask(this.activeTaskId); // refresh modal
    await this.render();
  },

  // ─── Add task modal ─────────────────────────────────────
  async showAddTaskModal() {
    const clients   = await this.db.getAllClients();
    const employees = await this.db.getAllEmployees();

    const clientSelect = document.getElementById('add-task-client');
    clientSelect.innerHTML = '<option value="">Select client…</option>' +
      clients.map(c => `<option value="${c.id}">${this._escHtml(c.name)}</option>`).join('');

    const assignSelect = document.getElementById('add-task-assign');
    assignSelect.innerHTML = '<option value="">Unassigned</option>' +
      employees.map(e => `<option value="${this._escHtml(e.name)}">${this._escHtml(e.name)}</option>`).join('');

    document.getElementById('add-task-title').value = '';
    document.getElementById('add-task-new-client').value = '';
    document.getElementById('add-task-notes').value = '';
    document.getElementById('add-task-modal').classList.remove('hidden');
  },

  async saveNewTask() {
    const title = document.getElementById('add-task-title').value.trim();
    if (!title) { this.toast('Task title is required', 'error'); return; }

    let clientId, clientName;
    const newClientName = document.getElementById('add-task-new-client').value.trim();
    const selectedClientId = document.getElementById('add-task-client').value;

    if (newClientName) {
      const client = await this.db.findOrCreateClient(newClientName);
      clientId = client.id;
      clientName = client.name;
    } else if (selectedClientId) {
      const client = await this.db.get('clients', selectedClientId);
      clientId = client.id;
      clientName = client.name;
    } else {
      this.toast('Please select or enter a client', 'error');
      return;
    }

    await this.db.saveTask({
      id: crypto.randomUUID(),
      threadId: null,
      clientId,
      clientName,
      title,
      priority:        document.getElementById('add-task-priority').value,
      status:          'pending',
      summary:         document.getElementById('add-task-notes').value.trim(),
      actionables:     [],
      nextStepsPerson: '',
      assignedTo:      document.getElementById('add-task-assign').value,
      emailSubject:    '',
      createdAt:       Date.now(),
      updatedAt:       Date.now(),
      completedAt:     null,
    });

    this.closeModal('add-task-modal');
    await this.render();
    this.toast('Task added!', 'success');
  },

  // ─── Settings modal ──────────────────────────────────────
  async showSettings() {
    const cid = await this.db.getSetting('googleClientId') || '';
    const ck  = await this.db.getSetting('claudeApiKey')   || '';
    document.getElementById('settings-client-id').value  = cid;
    document.getElementById('settings-claude-key').value = ck;
    await this._renderSettingsEmployees();
    document.getElementById('settings-modal').classList.remove('hidden');
  },

  async _renderSettingsEmployees() {
    const employees = await this.db.getAllEmployees();
    const list = document.getElementById('settings-employee-list');
    list.innerHTML = employees.map(e => `
      <div class="employee-chip">
        <span>${this._escHtml(e.name)}</span>
        <button onclick="UI.removeEmployee('${e.id}')">×</button>
      </div>`).join('');
  },

  async removeEmployee(id) {
    await this.db.deleteEmployee(id);
    await this._renderSettingsEmployees();
    await this.populateFilterDropdowns();
  },

  // ─── Filter panel ────────────────────────────────────────
  toggleFilterPanel() {
    this.filterPanelOpen = !this.filterPanelOpen;
    const panel = document.getElementById('filter-panel');
    panel.classList.toggle('hidden', !this.filterPanelOpen);
  },

  applyFilters() {
    this.filters.status   = document.getElementById('filter-status').value;
    this.filters.priority = document.getElementById('filter-priority').value;
    this.filters.employee = document.getElementById('filter-employee').value;
    this.filters.client   = document.getElementById('filter-client').value;
    this.renderClients();
    this.renderCompleted();
  },

  clearFilters() {
    this.filters = { status: '', priority: '', employee: '', client: '' };
    document.getElementById('filter-status').value   = '';
    document.getElementById('filter-priority').value = '';
    document.getElementById('filter-employee').value = '';
    document.getElementById('filter-client').value   = '';
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
    this.renderClients();
    this.renderCompleted();
  },

  handleSearch(query) {
    this.searchQuery = query.trim();
    this.renderClients();
    this.renderCompleted();
  },

  async populateFilterDropdowns() {
    const employees = await this.db.getAllEmployees();
    const clients   = await this.db.getAllClients();

    const empSel = document.getElementById('filter-employee');
    const curEmp = empSel.value;
    empSel.innerHTML = '<option value="">All</option>' +
      employees.map(e => `<option value="${this._escHtml(e.name)}" ${curEmp === e.name ? 'selected' : ''}>${this._escHtml(e.name)}</option>`).join('');

    const clientSel = document.getElementById('filter-client');
    const curCli = clientSel.value;
    clientSel.innerHTML = '<option value="">All</option>' +
      clients.map(c => `<option value="${c.id}" ${curCli === c.id ? 'selected' : ''}>${this._escHtml(c.name)}</option>`).join('');
  },

  // ─── Modal helpers ───────────────────────────────────────
  closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    if (id === 'task-modal') this.activeTaskId = null;
  },

  closeTaskModal(e) {
    if (e.target.classList.contains('modal-overlay')) {
      this.closeModal(e.target.id);
    }
  },

  // ─── Sync UI helpers ─────────────────────────────────────
  showSyncBar(text = 'Syncing emails…') {
    const bar = document.getElementById('sync-bar');
    document.getElementById('sync-bar-text').textContent = text;
    bar.classList.remove('hidden');
    document.getElementById('sync-btn').querySelector('svg').classList.add('spin');
  },

  hideSyncBar() {
    document.getElementById('sync-bar').classList.add('hidden');
    document.getElementById('sync-btn').querySelector('svg').classList.remove('spin');
  },

  updateSyncTime(lastMs, nextMs) {
    const fmt = ms => ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'never';
    document.getElementById('last-sync-text').textContent = `Last sync: ${fmt(lastMs)}`;
    document.getElementById('next-sync-text').textContent = nextMs ? `Next: ${fmt(nextMs)}` : '';
  },

  // ─── Toast notifications ─────────────────────────────────
  toast(msg, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  },

  // ─── Helpers ─────────────────────────────────────────────
  _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
};
