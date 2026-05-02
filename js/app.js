/**
 * Main Dashboard Application
 * Manages state, rendering, and all user interactions.
 */
class TrackerApp {
  constructor() {
    this.state = {
      tasks:     [],
      clients:   [],   // [{ id, name, order }]
      employees: [],
      filters: { status: 'all', priority: 'all', client: 'all', employee: 'all', search: '' },
      ui: {
        expandedClients:  new Set(),
        collapsedGroups:  {},   // clientId → Set of collapsed priorities
        completedOpen:    false,
        currentTaskId:    null,
        editingTaskId:    null,
      },
    };
    this._syncTimer    = null;
    this._toastTimer   = null;
    this._SYNC_MS      = 10 * 60 * 1000;  // 10 minutes
    this._UI_KEY       = 'tracker_ui_state';
  }

  // ── bootstrap ─────────────────────────────────────────────────
  onUnlock() {
    this._loadUiState();
    this._showSetupBannerIfNeeded();
    this._populateFilterEmployees();
    this._populateFilterClients();

    const cached = api.loadCache();
    if (cached) {
      this._applyData(cached);
      this._renderAll();
    }

    if (api.isConfigured()) {
      this._doSync();
      this._startSyncTimer();
    } else {
      this._showEmptyState();
    }
  }

  // ── sync ──────────────────────────────────────────────────────
  _startSyncTimer() {
    clearInterval(this._syncTimer);
    this._syncTimer = setInterval(() => this._doSync(), this._SYNC_MS);
  }

  async _doSync(fullSync = false) {
    if (!api.isConfigured()) return;
    const btn = document.getElementById('sync-btn');
    const ind = document.getElementById('sync-indicator');
    btn.classList.add('spinning');
    ind.classList.add('syncing');
    ind.querySelector('span').textContent = 'Syncing…';

    try {
      if (fullSync) {
        this._showLoader('Syncing emails from the last 30 days. This may take a few minutes…');
        await api.triggerSync(true);
      }
      const data = await api.getAll();
      this._applyData(data);
      this._renderAll();
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      document.getElementById('last-sync-text').textContent = now;
      if (fullSync) this.showToast('Full sync complete!', 'success');
    } catch (err) {
      this.showToast('Sync failed: ' + err.message, 'error');
    } finally {
      btn.classList.remove('spinning');
      ind.classList.remove('syncing');
      this._hideLoader();
    }
  }

  syncNow() { this._doSync(); }
  forceFullSync() {
    if (confirm('This will re-process all emails from the last 30 days and may take several minutes. Continue?')) {
      this._doSync(true);
      this.closeSettings();
    }
  }

  _applyData(data) {
    if (data.tasks)     this.state.tasks     = data.tasks;
    if (data.clients)   this.state.clients   = data.clients;
    if (data.employees) this.state.employees = data.employees;
    this._populateFilterEmployees();
    this._populateFilterClients();
    this._updateDatalistEmployees();
    this._updateDatalistClients();
  }

  // ── rendering ─────────────────────────────────────────────────
  _renderAll() {
    const tasks = this._filteredTasks();
    this._renderStats(tasks);
    this._renderClients(tasks);
    this._renderCompleted(tasks);
    this._toggleEmptyState(tasks);
  }

  _filteredTasks() {
    const { status, priority, client, employee, search } = this.state.filters;
    const q = search.toLowerCase();
    return this.state.tasks.filter(t => {
      if (status   !== 'all' && t.status   !== status)   return false;
      if (priority !== 'all' && t.priority !== priority) return false;
      if (client   !== 'all' && t.clientId !== client)   return false;
      if (employee !== 'all' && t.assignedTo !== employee) return false;
      if (q && !( t.title.toLowerCase().includes(q) ||
                  (t.clientName  || '').toLowerCase().includes(q) ||
                  (t.assignedTo  || '').toLowerCase().includes(q) ||
                  (t.description || '').toLowerCase().includes(q) )) return false;
      return true;
    });
  }

  _renderStats(tasks) {
    const all      = this.state.tasks;
    const pending  = all.filter(t => t.status !== 'completed');
    const done     = all.filter(t => t.status === 'completed');
    const urgent   = pending.filter(t => t.priority === 'urgent');
    const medium   = pending.filter(t => t.priority === 'medium');
    const low      = pending.filter(t => t.priority === 'low');
    document.getElementById('stat-total').textContent   = all.length;
    document.getElementById('stat-pending').textContent = pending.length;
    document.getElementById('stat-done').textContent    = done.length;
    document.getElementById('stat-urgent').textContent  = urgent.length;
    document.getElementById('stat-medium').textContent  = medium.length;
    document.getElementById('stat-low').textContent     = low.length;
  }

  _renderClients(tasks) {
    const container = document.getElementById('clients-container');
    const pending   = tasks.filter(t => t.status !== 'completed');

    // Group by client
    const byClient = {};
    pending.forEach(t => {
      const cid = t.clientId || 'uncategorised';
      if (!byClient[cid]) byClient[cid] = { name: t.clientName || 'Uncategorised', tasks: [] };
      byClient[cid].tasks.push(t);
    });

    // Sort clients by saved order
    const orderedClients = this.state.clients.slice().sort((a, b) => a.order - b.order);

    const ids = new Set(Object.keys(byClient));
    // Add any clients in our order list that have tasks
    const seenIds = new Set();
    const sortedIds = [];
    orderedClients.forEach(c => {
      if (ids.has(c.id)) { sortedIds.push(c.id); seenIds.add(c.id); }
    });
    // Append any new clients not in saved order
    ids.forEach(id => { if (!seenIds.has(id)) sortedIds.push(id); });

    // Remove existing client sections, rebuild
    container.innerHTML = '';
    if (sortedIds.length === 0) { container.innerHTML = ''; return; }

    sortedIds.forEach(cid => {
      const group = byClient[cid];
      const el    = this._buildClientSection(cid, group.name, group.tasks);
      container.appendChild(el);
    });
  }

  _buildClientSection(cid, name, tasks) {
    const ui      = this.state.ui;
    const isOpen  = ui.expandedClients.has(cid);
    const abbr    = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const el = document.createElement('div');
    el.className = 'client-section';
    el.dataset.clientId = cid;
    el.setAttribute('draggable', 'true');

    // Group tasks by priority
    const urgent = tasks.filter(t => t.priority === 'urgent');
    const medium = tasks.filter(t => t.priority === 'medium');
    const low    = tasks.filter(t => t.priority === 'low');
    const other  = tasks.filter(t => !['urgent','medium','low'].includes(t.priority));

    el.innerHTML = `
      <div class="client-hd" onclick="app._toggleClient('${cid}')">
        <div class="client-hd-left">
          <span class="drag-handle" title="Drag to reorder" onclick="event.stopPropagation()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          </span>
          <div class="client-avatar">${abbr}</div>
          <span class="client-name">${this._esc(name)}</span>
        </div>
        <div class="client-hd-right">
          ${urgent.length ? `<span class="count-badge urgent-badge">🔴 ${urgent.length}</span>` : ''}
          <span class="count-badge">${tasks.length} tasks</span>
          <svg class="chevron ${isOpen ? 'open' : ''}" id="chevron-${cid}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="client-body ${isOpen ? '' : 'hidden'}" id="client-body-${cid}">
        ${this._buildPriorityGroup(cid, 'urgent', 'Urgent', urgent)}
        ${this._buildPriorityGroup(cid, 'medium', 'Medium', medium)}
        ${this._buildPriorityGroup(cid, 'low',    'Low',    low)}
        ${other.length ? this._buildPriorityGroup(cid, 'other', 'Other', other) : ''}
      </div>
    `;

    // Drag-and-drop
    el.addEventListener('dragstart', e => this._onDragStart(e, cid));
    el.addEventListener('dragover',  e => this._onDragOver(e));
    el.addEventListener('dragleave', e => el.classList.remove('drag-over'));
    el.addEventListener('drop',      e => this._onDrop(e, cid));
    el.addEventListener('dragend',   e => document.querySelectorAll('.client-section').forEach(s => s.classList.remove('dragging', 'drag-over')));

    return el;
  }

  _buildPriorityGroup(cid, priority, label, tasks) {
    if (tasks.length === 0) return '';
    const key      = `${cid}__${priority}`;
    const collapsed = this.state.ui.collapsedGroups[key];
    return `
      <div class="priority-group">
        <div class="priority-group-hd" onclick="app._togglePriorityGroup('${key}')">
          <span class="priority-label ${priority}">${label}</span>
          <span class="priority-count">${tasks.length}</span>
          <svg class="priority-chevron ${collapsed ? '' : 'open'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="priority-tasks ${collapsed ? 'hidden' : ''}" id="pg-${key}">
          ${tasks.map(t => this._buildTaskItem(t)).join('')}
        </div>
      </div>
    `;
  }

  _buildTaskItem(task) {
    const done    = task.status === 'completed';
    const checked = done ? 'checked' : '';
    const email   = task.emailThreadId ? '<span class="email-badge">📧 email</span>' : '';
    const assignee = task.assignedTo
      ? `<span class="assignee-chip">${this._esc(task.assignedTo)}</span>`
      : '';
    return `
      <div class="task-item ${done ? 'completed-task' : ''}" onclick="app.openTaskDetail('${task.id}')">
        <button class="task-check ${checked}" onclick="event.stopPropagation();app.toggleTaskStatus('${task.id}')" title="${done ? 'Mark pending' : 'Mark complete'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <span class="priority-dot ${task.priority}"></span>
        <div class="task-content">
          <div class="task-title-text">${this._esc(task.title)}</div>
          <div class="task-meta">
            ${assignee}
            ${email}
            <span class="task-meta-tag">${this._formatDate(task.updatedAt || task.createdAt)}</span>
          </div>
        </div>
      </div>
    `;
  }

  _renderCompleted(tasks) {
    const done  = tasks.filter(t => t.status === 'completed');
    const count = document.getElementById('completed-count');
    const list  = document.getElementById('completed-list');

    count.textContent = done.length;
    list.innerHTML = done.length
      ? done.map(t => this._buildTaskItem(t)).join('')
      : '<div style="padding:16px;color:var(--text-dim);font-size:13px;text-align:center">No completed tasks</div>';
  }

  _toggleEmptyState(tasks) {
    const pending = tasks.filter(t => t.status !== 'completed');
    const empty   = document.getElementById('empty-state');
    const clients = document.getElementById('clients-container');
    if (pending.length === 0 && !api.isConfigured()) {
      empty.classList.remove('hidden');
      clients.classList.add('hidden');
    } else {
      empty.classList.add('hidden');
      clients.classList.remove('hidden');
    }
  }

  // ── client toggle & drag ──────────────────────────────────────
  _toggleClient(cid) {
    const ui  = this.state.ui;
    const body = document.getElementById(`client-body-${cid}`);
    const chev = document.getElementById(`chevron-${cid}`);
    if (ui.expandedClients.has(cid)) {
      ui.expandedClients.delete(cid);
      body.classList.add('hidden');
      chev.classList.remove('open');
    } else {
      ui.expandedClients.add(cid);
      body.classList.remove('hidden');
      chev.classList.add('open');
    }
    this._saveUiState();
  }

  _togglePriorityGroup(key) {
    const el = document.getElementById(`pg-${key}`);
    const hd = el.previousElementSibling;
    const chev = hd.querySelector('.priority-chevron');
    if (el.classList.contains('hidden')) {
      el.classList.remove('hidden');
      chev.classList.add('open');
      delete this.state.ui.collapsedGroups[key];
    } else {
      el.classList.add('hidden');
      chev.classList.remove('open');
      this.state.ui.collapsedGroups[key] = true;
    }
    this._saveUiState();
  }

  toggleCompleted() {
    const body = document.getElementById('completed-body');
    const chev = document.getElementById('completed-chevron');
    const open = !body.classList.contains('hidden');
    body.classList.toggle('hidden', open);
    chev.classList.toggle('open', !open);
    this.state.ui.completedOpen = !open;
    this._saveUiState();
  }

  // drag-and-drop reorder
  _onDragStart(e, cid) {
    this._draggingId = cid;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
  _onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  }
  _onDrop(e, targetCid) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (this._draggingId === targetCid) return;

    const container = document.getElementById('clients-container');
    const sections  = [...container.querySelectorAll('.client-section')];
    const fromEl    = container.querySelector(`[data-client-id="${this._draggingId}"]`);
    const toEl      = container.querySelector(`[data-client-id="${targetCid}"]`);
    if (!fromEl || !toEl) return;

    const fromIdx = sections.indexOf(fromEl);
    const toIdx   = sections.indexOf(toEl);

    if (fromIdx < toIdx) toEl.after(fromEl);
    else toEl.before(fromEl);

    // Persist new order
    const newOrder = [...container.querySelectorAll('.client-section')].map((el, i) => ({
      id: el.dataset.clientId, order: i,
    }));
    newOrder.forEach(o => {
      const c = this.state.clients.find(c => c.id === o.id);
      if (c) c.order = o.order;
    });
    this._saveUiState();
    if (api.isConfigured()) {
      api.reorderClients(newOrder.map(o => o.id)).catch(() => {});
    }
  }

  // ── task detail modal ─────────────────────────────────────────
  openTaskDetail(taskId) {
    const task = this._taskById(taskId);
    if (!task) return;
    this.state.ui.currentTaskId = taskId;

    const badge    = document.getElementById('td-priority-badge');
    const title    = document.getElementById('td-title');
    const body     = document.getElementById('td-body');
    const statusBt = document.getElementById('td-status-btn');

    const p = task.priority || 'medium';
    badge.className = `priority-badge ${task.status === 'completed' ? 'done' : p}`;
    badge.textContent = task.status === 'completed' ? 'COMPLETED' : p.toUpperCase();
    title.textContent = task.title;
    statusBt.textContent = task.status === 'completed' ? 'Mark Pending' : 'Mark Complete';

    const actionables = (task.actionables || []);
    const actHtml = actionables.length
      ? actionables.map(a => `<div class="actionable-item"><span class="actionable-bullet"></span><span>${this._esc(a)}</span></div>`).join('')
      : '<div style="color:var(--text-dim);font-size:13px">No action items recorded</div>';

    body.innerHTML = `
      <div class="td-meta-grid">
        <div class="td-meta-item"><span class="td-meta-label">Client</span><span class="td-meta-value">${this._esc(task.clientName || '—')}</span></div>
        <div class="td-meta-item"><span class="td-meta-label">Assigned To</span><span class="td-meta-value">${this._esc(task.assignedTo || 'Unassigned')}</span></div>
        <div class="td-meta-item"><span class="td-meta-label">Created</span><span class="td-meta-value">${this._formatDate(task.createdAt)}</span></div>
        <div class="td-meta-item"><span class="td-meta-label">Updated</span><span class="td-meta-value">${this._formatDate(task.updatedAt)}</span></div>
        ${task.completedAt ? `<div class="td-meta-item"><span class="td-meta-label">Completed</span><span class="td-meta-value">${this._formatDate(task.completedAt)}</span></div>` : ''}
        ${task.nextStepPerson ? `<div class="td-meta-item"><span class="td-meta-label">Next Step By</span><span class="td-meta-value">${this._esc(task.nextStepPerson)}</span></div>` : ''}
      </div>
      ${task.description ? `
      <div class="td-section">
        <div class="td-section-title">Description</div>
        <div class="td-section-body">${this._esc(task.description)}</div>
      </div>` : ''}
      <div class="td-section">
        <div class="td-section-title">Action Items</div>
        <div class="td-section-body">${actHtml}</div>
      </div>
      ${task.emailSummary ? `
      <div class="td-section">
        <div class="td-section-title">Email Summary</div>
        <div class="td-section-body">${this._esc(task.emailSummary)}</div>
      </div>` : ''}
      ${task.threadSummary ? `
      <div class="td-section">
        <div class="td-section-title">Full Thread Summary</div>
        <div class="td-section-body">${this._esc(task.threadSummary)}</div>
      </div>` : ''}
    `;

    document.getElementById('modal-task-detail').classList.remove('hidden');
  }

  closeTaskDetail() {
    document.getElementById('modal-task-detail').classList.add('hidden');
    this.state.ui.currentTaskId = null;
  }

  toggleCurrentTaskStatus() {
    const id = this.state.ui.currentTaskId;
    if (id) {
      this.closeTaskDetail();
      this.toggleTaskStatus(id);
    }
  }

  async toggleTaskStatus(taskId) {
    const task = this._taskById(taskId);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const updates   = { status: newStatus, completedAt: newStatus === 'completed' ? new Date().toISOString() : '' };

    task.status      = newStatus;
    task.completedAt = updates.completedAt;
    task.updatedAt   = new Date().toISOString();
    this._renderAll();
    this.showToast(newStatus === 'completed' ? 'Task marked complete ✓' : 'Task moved back to pending', 'success');

    if (api.isConfigured()) {
      api.updateTask(taskId, updates).catch(e => this.showToast('Sync error: ' + e.message, 'error'));
    } else {
      api._saveCache({ tasks: this.state.tasks, clients: this.state.clients, employees: this.state.employees });
    }
  }

  // ── add/edit task form ────────────────────────────────────────
  openTaskForm(taskId = null) {
    this.state.ui.editingTaskId = taskId;
    const title = document.getElementById('task-form-title');
    title.textContent = taskId ? 'Edit Task' : 'Add New Task';

    if (taskId) {
      const t = this._taskById(taskId);
      if (t) {
        document.getElementById('tf-client').value        = t.clientName || '';
        document.getElementById('tf-title').value         = t.title || '';
        document.getElementById('tf-desc').value          = t.description || '';
        document.getElementById('tf-priority').value      = t.priority || 'medium';
        document.getElementById('tf-assignee').value      = t.assignedTo || '';
        document.getElementById('tf-actionables').value  = (t.actionables || []).join('\n');
        document.getElementById('tf-next-person').value  = t.nextStepPerson || '';
      }
    } else {
      ['tf-client','tf-title','tf-desc','tf-assignee','tf-actionables','tf-next-person'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('tf-priority').value = 'medium';
    }
    document.getElementById('modal-task-form').classList.remove('hidden');
    setTimeout(() => document.getElementById('tf-client').focus(), 100);
  }

  closeTaskForm() { document.getElementById('modal-task-form').classList.add('hidden'); }

  openEditTask() {
    this.closeTaskDetail();
    this.openTaskForm(this.state.ui.currentTaskId);
  }

  async saveTask() {
    const clientName  = document.getElementById('tf-client').value.trim();
    const title       = document.getElementById('tf-title').value.trim();
    const description = document.getElementById('tf-desc').value.trim();
    const priority    = document.getElementById('tf-priority').value;
    const assignedTo  = document.getElementById('tf-assignee').value.trim();
    const actRaw      = document.getElementById('tf-actionables').value.trim();
    const nextPerson  = document.getElementById('tf-next-person').value.trim();

    if (!clientName || !title) {
      this.showToast('Client name and title are required', 'error'); return;
    }

    const actionables = actRaw ? actRaw.split('\n').map(l => l.trim()).filter(Boolean) : [];
    const editId = this.state.ui.editingTaskId;

    const taskData = { clientName, title, description, priority, assignedTo, actionables, nextStepPerson: nextPerson };

    const btn = document.getElementById('tf-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      if (editId) {
        // Update existing
        taskData.updatedAt = new Date().toISOString();
        Object.assign(this._taskById(editId), taskData);
        if (api.isConfigured()) await api.updateTask(editId, taskData);
        this.showToast('Task updated', 'success');
      } else {
        // Create new
        const now  = new Date().toISOString();
        const newT = {
          id: 'local_' + Date.now(),
          clientId: this._clientIdByName(clientName),
          ...taskData,
          status: 'pending', createdAt: now, updatedAt: now,
        };
        if (api.isConfigured()) {
          const res = await api.createTask(newT);
          if (res.task) { Object.assign(newT, res.task); }
        }
        this.state.tasks.push(newT);
        // Add client if new
        if (!this.state.clients.find(c => c.name.toLowerCase() === clientName.toLowerCase())) {
          this.state.clients.push({ id: newT.clientId, name: clientName, order: this.state.clients.length });
        }
        this.showToast('Task created', 'success');
      }
      api._saveCache({ tasks: this.state.tasks, clients: this.state.clients, employees: this.state.employees });
      this._renderAll();
      this.closeTaskForm();
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Task';
    }
  }

  // ── priority modal ────────────────────────────────────────────
  openPriorityModal() { document.getElementById('modal-priority').classList.remove('hidden'); }
  closePriorityModal() { document.getElementById('modal-priority').classList.add('hidden'); }

  async setTaskPriority(priority) {
    const id = this.state.ui.currentTaskId;
    if (!id) return;
    const task = this._taskById(id);
    if (!task) return;
    task.priority   = priority;
    task.updatedAt  = new Date().toISOString();
    this.closePriorityModal();
    this.closeTaskDetail();
    this._renderAll();
    this.showToast('Priority updated', 'success');
    if (api.isConfigured()) {
      api.updateTask(id, { priority, updatedAt: task.updatedAt }).catch(() => {});
    } else {
      api._saveCache({ tasks: this.state.tasks, clients: this.state.clients, employees: this.state.employees });
    }
  }

  // ── assign modal ──────────────────────────────────────────────
  openAssignModal() {
    this._updateDatalistAssign();
    const input = document.getElementById('assign-input');
    const task  = this._taskById(this.state.ui.currentTaskId);
    input.value = task ? (task.assignedTo || '') : '';
    document.getElementById('modal-assign').classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
  }
  closeAssignModal() { document.getElementById('modal-assign').classList.add('hidden'); }

  async saveAssignment() {
    const id  = this.state.ui.currentTaskId;
    const emp = document.getElementById('assign-input').value.trim();
    if (!id) return;
    const task    = this._taskById(id);
    if (!task) return;
    task.assignedTo = emp;
    task.updatedAt  = new Date().toISOString();
    this.closeAssignModal();
    this.closeTaskDetail();
    this._renderAll();
    this.showToast(emp ? `Assigned to ${emp}` : 'Assignment removed', 'success');
    if (api.isConfigured()) {
      api.updateTask(id, { assignedTo: emp, updatedAt: task.updatedAt }).catch(() => {});
    } else {
      api._saveCache({ tasks: this.state.tasks, clients: this.state.clients, employees: this.state.employees });
    }
  }

  // ── settings modal ────────────────────────────────────────────
  showSettings() {
    document.getElementById('s-api-url').value = localStorage.getItem('tracker_api_url') || '';
    document.getElementById('s-api-key').value = localStorage.getItem('tracker_api_key') || '';
    this._renderEmployeeManager();
    document.getElementById('modal-settings').classList.remove('hidden');
  }
  closeSettings() { document.getElementById('modal-settings').classList.add('hidden'); }

  saveSettings() {
    const url = document.getElementById('s-api-url').value.trim();
    const key = document.getElementById('s-api-key').value.trim();
    api.configure(url, key);
    this._showSetupBannerIfNeeded();
    this.closeSettings();
    this.showToast('Settings saved', 'success');
    if (api.isConfigured()) {
      this._doSync();
      this._startSyncTimer();
    }
  }

  async testConnection() {
    const url = document.getElementById('s-api-url').value.trim();
    const key = document.getElementById('s-api-key').value.trim();
    const statusEl = document.getElementById('connection-status');
    statusEl.className = 'connection-status';
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Testing…';

    // Temporarily configure for the test
    const prev = { url: api.url, secret: api.secret };
    api.url = url; api.secret = key;

    try {
      await api.testConnection();
      statusEl.classList.add('ok');
      statusEl.textContent = '✓ Connected successfully';
    } catch (err) {
      statusEl.classList.add('err');
      statusEl.textContent = '✗ ' + err.message;
      api.url = prev.url; api.secret = prev.secret;
    }
  }

  togglePasswordVisibility(inputId) {
    const el = document.getElementById(inputId);
    const btn = el.nextElementSibling;
    if (el.type === 'password') { el.type = 'text'; btn.textContent = 'Hide'; }
    else { el.type = 'password'; btn.textContent = 'Show'; }
  }

  // ── employee management ───────────────────────────────────────
  _renderEmployeeManager() {
    const container = document.getElementById('employee-list-ui');
    if (!this.state.employees.length) {
      container.innerHTML = '<span style="color:var(--text-dim);font-size:13px">No employees added yet</span>';
      return;
    }
    container.innerHTML = this.state.employees.map(e => `
      <div class="employee-chip">
        ${this._esc(e.name)}
        <button class="employee-chip-remove" onclick="app._removeEmployee('${e.id}')" title="Remove">×</button>
      </div>
    `).join('');
  }

  async addEmployee() {
    const input = document.getElementById('s-new-employee');
    const name  = input.value.trim();
    if (!name) return;

    const emp = { id: 'emp_' + Date.now(), name, addedAt: new Date().toISOString() };
    this.state.employees.push(emp);
    input.value = '';

    if (api.isConfigured()) {
      api.addEmployee(name).then(res => {
        if (res.employee) emp.id = res.employee.id;
      }).catch(() => {});
    }
    this._renderEmployeeManager();
    this._updateDatalistEmployees();
    this._populateFilterEmployees();
    this.showToast(`${name} added`, 'success');
  }

  async _removeEmployee(id) {
    this.state.employees = this.state.employees.filter(e => e.id !== id);
    if (api.isConfigured()) api.removeEmployee(id).catch(() => {});
    this._renderEmployeeManager();
    this._updateDatalistEmployees();
    this._populateFilterEmployees();
  }

  // ── filters & search ──────────────────────────────────────────
  setFilter(key, value) {
    this.state.filters[key] = value;
    this._renderAll();
  }

  handleSearch(value) {
    this.state.filters.search = value;
    const clearBtn = document.getElementById('search-clear');
    clearBtn.classList.toggle('hidden', !value);
    this._renderAll();
  }

  clearSearch() {
    document.getElementById('search-input').value = '';
    this.handleSearch('');
  }

  _populateFilterEmployees() {
    const sel = document.getElementById('f-employee');
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All Employees</option>' +
      this.state.employees.map(e => `<option value="${this._esc(e.name)}">${this._esc(e.name)}</option>`).join('');
    sel.value = cur;
  }

  _populateFilterClients() {
    const sel = document.getElementById('f-client');
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All Clients</option>' +
      this.state.clients.map(c => `<option value="${c.id}">${this._esc(c.name)}</option>`).join('');
    sel.value = cur;
  }

  _updateDatalistEmployees() {
    ['datalist-employees','datalist-assign-employees'].forEach(id => {
      const dl = document.getElementById(id);
      if (dl) dl.innerHTML = this.state.employees.map(e => `<option value="${this._esc(e.name)}">`).join('');
    });
  }

  _updateDatalistClients() {
    const dl = document.getElementById('datalist-clients');
    if (dl) dl.innerHTML = this.state.clients.map(c => `<option value="${this._esc(c.name)}">`).join('');
  }

  _updateDatalistAssign() {
    const dl = document.getElementById('datalist-assign-employees');
    if (dl) dl.innerHTML = this.state.employees.map(e => `<option value="${this._esc(e.name)}">`).join('');
  }

  // ── ui state persistence ──────────────────────────────────────
  _saveUiState() {
    const s = {
      expandedClients: [...this.state.ui.expandedClients],
      collapsedGroups: this.state.ui.collapsedGroups,
      completedOpen:   this.state.ui.completedOpen,
    };
    try { localStorage.setItem(this._UI_KEY, JSON.stringify(s)); } catch (_) {}
  }

  _loadUiState() {
    try {
      const raw = localStorage.getItem(this._UI_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.expandedClients) this.state.ui.expandedClients = new Set(s.expandedClients);
      if (s.collapsedGroups) this.state.ui.collapsedGroups = s.collapsedGroups;
      if (s.completedOpen)   this.state.ui.completedOpen   = s.completedOpen;
    } catch (_) {}
  }

  // ── helpers ───────────────────────────────────────────────────
  _taskById(id) { return this.state.tasks.find(t => t.id === id); }

  _clientIdByName(name) {
    const c = this.state.clients.find(c => c.name.toLowerCase() === name.toLowerCase());
    return c ? c.id : 'client_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
  }

  _showSetupBannerIfNeeded() {
    const banner = document.getElementById('setup-banner');
    banner.classList.toggle('hidden', api.isConfigured());
  }

  _showEmptyState() {
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('clients-container').classList.add('hidden');
  }

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  _formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000)   return 'Just now';
      if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
      if (diff < 604800000) return Math.floor(diff/86400000) + 'd ago';
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    } catch (_) { return iso; }
  }

  showToast(msg, type = '') {
    clearTimeout(this._toastTimer);
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.classList.remove('hidden');
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  _showLoader(msg) {
    document.getElementById('loader-text').textContent = msg || 'Loading…';
    document.getElementById('loader').classList.remove('hidden');
  }

  _hideLoader() { document.getElementById('loader').classList.add('hidden'); }
}

// ── init ──────────────────────────────────────────────────────
const app = new TrackerApp();
