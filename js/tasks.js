/**
 * Task rendering and management logic.
 */
const Tasks = {
  _allTasks: [],
  _allClients: [],
  _activeClientId: 'all',
  _filterStatus: 'all',
  _filterPriority: 'all',
  _filterAssignee: 'all',
  _searchQuery: '',
  _expandedTaskId: null,

  async load() {
    this._allTasks = await DB.getAllTasks();
    this._allClients = await DB.getAllClients();
  },

  getStats() {
    const tasks = this._allTasks;
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      urgent: tasks.filter(t => t.priority === 'urgent' && t.status === 'pending').length,
      medium: tasks.filter(t => t.priority === 'medium' && t.status === 'pending').length,
      low: tasks.filter(t => t.priority === 'low' && t.status === 'pending').length,
    };
  },

  getFilteredTasks() {
    let tasks = [...this._allTasks];

    if (this._activeClientId !== 'all') {
      const client = this._allClients.find(c => c.id === this._activeClientId);
      if (client) tasks = tasks.filter(t => t.clientName?.toLowerCase() === client.name.toLowerCase());
    }
    if (this._filterStatus !== 'all') {
      tasks = tasks.filter(t => t.status === this._filterStatus);
    }
    if (this._filterPriority !== 'all') {
      tasks = tasks.filter(t => t.priority === this._filterPriority);
    }
    if (this._filterAssignee !== 'all') {
      tasks = tasks.filter(t => (t.assignee || '').toLowerCase() === this._filterAssignee.toLowerCase());
    }
    if (this._searchQuery) {
      const q = this._searchQuery.toLowerCase();
      tasks = tasks.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.clientName?.toLowerCase().includes(q) ||
        t.assignee?.toLowerCase().includes(q)
      );
    }
    return tasks;
  },

  getClientsWithCounts() {
    const counts = {};
    for (const t of this._allTasks) {
      const name = t.clientName || 'Unknown';
      if (!counts[name]) counts[name] = { pending: 0, total: 0 };
      counts[name].total++;
      if (t.status === 'pending') counts[name].pending++;
    }
    return this._allClients.map(c => ({ ...c, ...counts[c.name] }));
  },

  getAssignees() {
    const set = new Set();
    for (const t of this._allTasks) if (t.assignee) set.add(t.assignee);
    return [...set].sort();
  },

  // ── Actions ────────────────────────────────────────────

  async updateTask(id, changes) {
    const task = await DB.getTask(id);
    if (!task) return;
    const manual = { ...task.manualFields };
    if ('priority' in changes) manual.priority = true;
    if ('assignee' in changes) manual.assignee = true;
    if ('status' in changes) manual.status = true;
    const updated = {
      ...task,
      ...changes,
      manualFields: manual,
      updatedAt: new Date().toISOString(),
    };
    if (changes.status === 'completed' && task.status !== 'completed') {
      updated.completedAt = new Date().toISOString();
    }
    if (changes.status === 'pending') {
      updated.completedAt = null;
    }
    await DB.putTask(updated);
    await DB.queueSync({ type: 'updateTask', taskId: id });
    await this.load();
    return updated;
  },

  async addTask(taskData) {
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      clientName: taskData.clientName || 'Unknown',
      title: taskData.title || 'New Task',
      description: taskData.description || '',
      priority: taskData.priority || 'medium',
      status: 'pending',
      assignee: taskData.assignee || null,
      threadSummaries: [],
      actionables: taskData.actionables || [],
      nextResponsible: taskData.nextResponsible || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      manualFields: { priority: true, status: true },
      sourceThreadId: null,
    };
    await DB.putTask(task);
    await DB.queueSync({ type: 'addTask', taskId: task.id });

    // Ensure client exists
    if (task.clientName && task.clientName !== 'Unknown') {
      const exists = this._allClients.find(c => c.name.toLowerCase() === task.clientName.toLowerCase());
      if (!exists) {
        const colors = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
        const client = {
          id: crypto.randomUUID(),
          name: task.clientName,
          color: colors[this._allClients.length % colors.length],
          order: this._allClients.length,
          createdAt: now,
        };
        await DB.putClient(client);
      }
    }
    await this.load();
    return task;
  },

  async reorderClients(newOrder) {
    for (let i = 0; i < newOrder.length; i++) {
      const client = this._allClients.find(c => c.id === newOrder[i]);
      if (client) {
        client.order = i;
        await DB.putClient(client);
      }
    }
    await this.load();
  },

  // ── Rendering ──────────────────────────────────────────

  renderStats(container) {
    const s = this.getStats();
    container.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Total</span>
        <span class="stat-val">${s.total}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Pending</span>
        <span class="stat-val text-yellow">${s.pending}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Done</span>
        <span class="stat-val text-green">${s.completed}</span>
      </div>
      <div class="stat-card urgent">
        <span class="stat-label">🔴 Urgent</span>
        <span class="stat-val">${s.urgent}</span>
      </div>
      <div class="stat-card medium">
        <span class="stat-label">🟡 Medium</span>
        <span class="stat-val">${s.medium}</span>
      </div>
      <div class="stat-card low">
        <span class="stat-label">🟢 Low</span>
        <span class="stat-val">${s.low}</span>
      </div>
    `;
  },

  renderClientSidebar(container) {
    const clients = this.getClientsWithCounts();
    const totalPending = this._allTasks.filter(t => t.status === 'pending').length;
    const items = [{ id: 'all', name: 'All Clients', pending: totalPending, color: '#6366f1' }, ...clients];
    container.innerHTML = items.map(c => `
      <div class="client-item ${this._activeClientId === c.id ? 'active' : ''}"
           data-client-id="${c.id}" draggable="${c.id !== 'all'}">
        <span class="client-dot" style="background:${c.color || '#6366f1'}"></span>
        <span class="client-name">${this._esc(c.name)}</span>
        ${c.pending > 0 ? `<span class="client-badge">${c.pending}</span>` : ''}
      </div>
    `).join('');

    container.querySelectorAll('.client-item').forEach(el => {
      el.addEventListener('click', () => {
        this._activeClientId = el.dataset.clientId;
        this.renderAll();
      });
    });
    this._initDragSort(container);
  },

  _initDragSort(container) {
    let dragging = null;
    container.querySelectorAll('[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', () => { dragging = el; el.classList.add('dragging'); });
      el.addEventListener('dragend', async () => {
        el.classList.remove('dragging');
        dragging = null;
        const newOrder = [...container.querySelectorAll('.client-item[draggable="true"]')]
          .map(e => e.dataset.clientId);
        await this.reorderClients(newOrder);
      });
      el.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragging || dragging === el) return;
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) container.insertBefore(dragging, el);
        else container.insertBefore(dragging, el.nextSibling);
      });
    });
  },

  renderFilters(container) {
    const assignees = this.getAssignees();
    container.innerHTML = `
      <div class="filters-row">
        <div class="search-wrap">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input type="text" id="searchInput" placeholder="Search tasks, clients…" value="${this._esc(this._searchQuery)}">
        </div>
        <select id="filterStatus">
          <option value="all" ${this._filterStatus === 'all' ? 'selected' : ''}>All Status</option>
          <option value="pending" ${this._filterStatus === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="completed" ${this._filterStatus === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
        <select id="filterPriority">
          <option value="all" ${this._filterPriority === 'all' ? 'selected' : ''}>All Priority</option>
          <option value="urgent" ${this._filterPriority === 'urgent' ? 'selected' : ''}>🔴 Urgent</option>
          <option value="medium" ${this._filterPriority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
          <option value="low" ${this._filterPriority === 'low' ? 'selected' : ''}>🟢 Low</option>
        </select>
        <select id="filterAssignee">
          <option value="all">All Assignees</option>
          ${assignees.map(a => `<option value="${this._esc(a)}" ${this._filterAssignee === a ? 'selected' : ''}>${this._esc(a)}</option>`).join('')}
        </select>
        <button id="addTaskBtn" class="btn-primary btn-sm">+ New Task</button>
      </div>
    `;

    document.getElementById('searchInput').addEventListener('input', e => {
      this._searchQuery = e.target.value;
      this.renderTaskList(document.getElementById('taskList'));
    });
    document.getElementById('filterStatus').addEventListener('change', e => {
      this._filterStatus = e.target.value;
      this.renderTaskList(document.getElementById('taskList'));
    });
    document.getElementById('filterPriority').addEventListener('change', e => {
      this._filterPriority = e.target.value;
      this.renderTaskList(document.getElementById('taskList'));
    });
    document.getElementById('filterAssignee').addEventListener('change', e => {
      this._filterAssignee = e.target.value;
      this.renderTaskList(document.getElementById('taskList'));
    });
    document.getElementById('addTaskBtn').addEventListener('click', () => {
      this._showAddTaskModal();
    });
  },

  renderTaskList(container) {
    const tasks = this.getFilteredTasks();
    const pending = tasks.filter(t => t.status === 'pending');
    const completed = tasks.filter(t => t.status === 'completed');

    const priorityOrder = { urgent: 0, medium: 1, low: 2 };
    pending.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
    completed.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

    if (tasks.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
        <p>No tasks found</p>
      </div>`;
      return;
    }

    let html = '';
    if (pending.length > 0) {
      // Group by priority
      const urgentTasks = pending.filter(t => t.priority === 'urgent');
      const mediumTasks = pending.filter(t => t.priority === 'medium');
      const lowTasks = pending.filter(t => t.priority === 'low');

      if (urgentTasks.length) html += this._renderGroup('🔴 Urgent', urgentTasks, 'urgent');
      if (mediumTasks.length) html += this._renderGroup('🟡 Medium', mediumTasks, 'medium');
      if (lowTasks.length) html += this._renderGroup('🟢 Low', lowTasks, 'low');
    }

    if (completed.length > 0) {
      html += `<div class="task-group completed-group">
        <button class="group-header collapsed-header" onclick="this.parentElement.classList.toggle('open')">
          <span class="group-title">✅ Completed (${completed.length})</span>
          <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="group-body">
          ${completed.map(t => this._renderTaskCard(t)).join('')}
        </div>
      </div>`;
    }

    container.innerHTML = html;
    this._bindTaskCardEvents(container);
  },

  _renderGroup(label, tasks, priority) {
    return `<div class="task-group ${priority}-group open">
      <button class="group-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="group-title">${label}</span>
        <span class="group-count">${tasks.length}</span>
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="group-body">
        ${tasks.map(t => this._renderTaskCard(t)).join('')}
      </div>
    </div>`;
  },

  _renderTaskCard(task) {
    const isExpanded = this._expandedTaskId === task.id;
    const age = this._timeAgo(task.updatedAt);
    const priorityColors = { urgent: '#ef4444', medium: '#f97316', low: '#22c55e' };
    const color = priorityColors[task.priority] || '#6366f1';

    return `
    <div class="task-card ${isExpanded ? 'expanded' : ''} ${task.status === 'completed' ? 'completed' : ''}"
         data-task-id="${task.id}" style="--p-color:${color}">
      <div class="task-card-header" data-expand="${task.id}">
        <div class="task-check-wrap">
          <input type="checkbox" class="task-check" data-task-id="${task.id}"
                 ${task.status === 'completed' ? 'checked' : ''}
                 title="${task.status === 'completed' ? 'Mark as pending' : 'Mark as complete'}">
        </div>
        <div class="task-card-main">
          <div class="task-title">${this._esc(task.title)}</div>
          <div class="task-meta">
            <span class="task-client">${this._esc(task.clientName || 'Unknown')}</span>
            ${task.assignee ? `<span class="task-assignee">👤 ${this._esc(task.assignee)}</span>` : ''}
            <span class="task-age">${age}</span>
            ${task.threadSummaries?.length ? `<span class="task-threads">📧 ${task.threadSummaries.length}</span>` : ''}
          </div>
        </div>
        <div class="task-card-actions">
          <span class="priority-badge priority-${task.priority}">${task.priority}</span>
          <svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      ${isExpanded ? this._renderTaskDetail(task) : ''}
    </div>`;
  },

  _renderTaskDetail(task) {
    const assignees = this.getAssignees();
    const summaries = task.threadSummaries || [];

    return `<div class="task-detail">
      <div class="task-detail-grid">
        <div class="detail-section">
          <h4>Description</h4>
          <p>${this._esc(task.description || 'No description')}</p>
        </div>

        ${task.actionables?.length ? `
        <div class="detail-section">
          <h4>Action Items</h4>
          <ul class="actionables-list">
            ${task.actionables.map(a => `<li>${this._esc(a)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${task.nextResponsible ? `
        <div class="detail-section">
          <h4>Next Responsible</h4>
          <p class="next-responsible">👤 ${this._esc(task.nextResponsible)}</p>
        </div>` : ''}

        ${summaries.length ? `
        <div class="detail-section full-width">
          <h4>Email Thread${summaries.length > 1 ? 's' : ''} (${summaries.length})</h4>
          ${summaries.map(s => `
            <div class="thread-card">
              <div class="thread-subject">${this._esc(s.subject || 'No subject')}</div>
              <div class="thread-summary">${this._esc(s.summary || '')}</div>
              <div class="thread-meta">
                ${s.messageCount ? `${s.messageCount} messages` : ''}
                ${s.lastMessageDate ? ` · ${this._timeAgo(s.lastMessageDate)}` : ''}
              </div>
            </div>
          `).join('')}
        </div>` : ''}
      </div>

      <div class="task-detail-footer">
        <div class="detail-controls">
          <label>Priority
            <select class="ctrl-priority" data-task-id="${task.id}">
              <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>🔴 Urgent</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>🟢 Low</option>
            </select>
          </label>
          <label>Assignee
            <input type="text" class="ctrl-assignee" data-task-id="${task.id}"
                   value="${this._esc(task.assignee || '')}"
                   placeholder="Type name…"
                   list="assignee-list-${task.id}">
            <datalist id="assignee-list-${task.id}">
              ${assignees.map(a => `<option value="${this._esc(a)}">`).join('')}
            </datalist>
          </label>
        </div>
        <div class="detail-actions">
          ${task.status === 'pending'
            ? `<button class="btn-success btn-sm" data-complete="${task.id}">✓ Mark Complete</button>`
            : `<button class="btn-outline btn-sm" data-uncomplete="${task.id}">↩ Mark Pending</button>`}
        </div>
      </div>
    </div>`;
  },

  _bindTaskCardEvents(container) {
    // Expand/collapse
    container.querySelectorAll('[data-expand]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.task-check') || e.target.closest('.ctrl-priority') ||
            e.target.closest('.ctrl-assignee') || e.target.closest('[data-complete]') ||
            e.target.closest('[data-uncomplete]')) return;
        const id = el.dataset.expand;
        this._expandedTaskId = this._expandedTaskId === id ? null : id;
        this.renderAll();
      });
    });

    // Checkboxes
    container.querySelectorAll('.task-check').forEach(cb => {
      cb.addEventListener('change', async e => {
        e.stopPropagation();
        const id = cb.dataset.taskId;
        const newStatus = cb.checked ? 'completed' : 'pending';
        await this.updateTask(id, { status: newStatus });
        this.renderAll();
      });
    });

    // Priority change
    container.querySelectorAll('.ctrl-priority').forEach(sel => {
      sel.addEventListener('change', async e => {
        await this.updateTask(sel.dataset.taskId, { priority: sel.value });
        this.renderAll();
      });
    });

    // Assignee change
    container.querySelectorAll('.ctrl-assignee').forEach(inp => {
      inp.addEventListener('change', async e => {
        await this.updateTask(inp.dataset.taskId, { assignee: inp.value.trim() || null });
        this.renderAll();
      });
    });

    // Complete / uncomplete buttons
    container.querySelectorAll('[data-complete]').forEach(btn => {
      btn.addEventListener('click', async e => {
        await this.updateTask(btn.dataset.complete, { status: 'completed' });
        this.renderAll();
      });
    });
    container.querySelectorAll('[data-uncomplete]').forEach(btn => {
      btn.addEventListener('click', async e => {
        await this.updateTask(btn.dataset.uncomplete, { status: 'pending' });
        this.renderAll();
      });
    });
  },

  renderAll() {
    this.renderStats(document.getElementById('statsBar'));
    this.renderClientSidebar(document.getElementById('clientSidebar'));
    this.renderFilters(document.getElementById('filtersBar'));
    this.renderTaskList(document.getElementById('taskList'));
  },

  _showAddTaskModal() {
    const clients = this._allClients;
    const modal = document.getElementById('modal');
    modal.innerHTML = `
      <div class="modal-box">
        <h3>New Task</h3>
        <form id="addTaskForm">
          <label>Title *
            <input name="title" required placeholder="Task title" maxlength="120">
          </label>
          <label>Client *
            <input name="clientName" required placeholder="Client name" list="client-opts"
                   value="${this._activeClientId !== 'all' ? this._esc(this._allClients.find(c=>c.id===this._activeClientId)?.name||'') : ''}">
            <datalist id="client-opts">
              ${clients.map(c => `<option value="${this._esc(c.name)}">`).join('')}
            </datalist>
          </label>
          <label>Description
            <textarea name="description" rows="3" placeholder="Details…"></textarea>
          </label>
          <label>Priority
            <select name="priority">
              <option value="urgent">🔴 Urgent</option>
              <option value="medium" selected>🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </label>
          <label>Assignee
            <input name="assignee" placeholder="Employee name" list="assignee-opts">
            <datalist id="assignee-opts">
              ${this.getAssignees().map(a => `<option value="${this._esc(a)}">`).join('')}
            </datalist>
          </label>
          <div class="modal-footer">
            <button type="button" class="btn-ghost" id="cancelAdd">Cancel</button>
            <button type="submit" class="btn-primary">Create Task</button>
          </div>
        </form>
      </div>
    `;
    modal.classList.add('open');
    document.getElementById('cancelAdd').addEventListener('click', () => modal.classList.remove('open'));
    document.getElementById('addTaskForm').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      await this.addTask(data);
      modal.classList.remove('open');
      this.renderAll();
    });
  },

  _timeAgo(isoStr) {
    if (!isoStr) return '';
    try {
      const diff = Date.now() - new Date(isoStr).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      const d = Math.floor(h / 24);
      if (d < 30) return `${d}d ago`;
      return new Date(isoStr).toLocaleDateString();
    } catch { return ''; }
  },

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
};
