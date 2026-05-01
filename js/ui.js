/* UI rendering — DOM manipulation and component building */
const UI = (() => {
  const PRIORITY_LABELS = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
  const STATUS_LABELS = { pending: 'Pending', in_progress: 'In Progress', completed: 'Done' };
  let currentFilters = { clientId: 'all', status: '', priority: '', assigneeId: '', query: '' };
  let employeeMap = {};
  let clientMap = {};

  /* ---------- Screen switching ---------- */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  /* ---------- Toast notifications ---------- */
  function toast(msg, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span class="toast-icon">${{ info: 'ℹ', success: '✓', error: '✕', warning: '⚠' }[type]}</span><span>${msg}</span>`;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, duration);
  }

  /* ---------- Loading overlay ---------- */
  function showLoading(msg = 'Loading…') {
    const el = document.getElementById('loading-overlay');
    if (el) { el.querySelector('#loading-message').textContent = msg; el.classList.add('active'); }
  }
  function hideLoading() {
    document.getElementById('loading-overlay')?.classList.remove('active');
  }
  function setLoadingMsg(msg) {
    const el = document.getElementById('loading-message');
    if (el) el.textContent = msg;
  }
  function setLoadingProgress(current, total) {
    const bar = document.getElementById('loading-progress');
    const label = document.getElementById('loading-progress-label');
    if (bar && total) { bar.value = current; bar.max = total; }
    if (label && total) label.textContent = `${current} / ${total}`;
  }

  /* ---------- Sync status ---------- */
  function updateSyncStatus(state, time) {
    const dot = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    if (!dot || !label) return;
    dot.className = `sync-dot sync-dot--${state}`;
    if (state === 'syncing') label.textContent = 'Syncing…';
    else if (state === 'success' && time) label.textContent = `Synced ${timeAgo(time)}`;
    else if (state === 'error') label.textContent = 'Sync failed';
    else label.textContent = 'Never synced';
  }

  /* ---------- Stats bar ---------- */
  async function refreshStats() {
    const stats = await db.getStats();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-total', stats.total);
    set('stat-pending', stats.pending + stats.inProgress);
    set('stat-urgent', stats.urgent);
    set('stat-completed', stats.completed);
  }

  /* ---------- Client sidebar ---------- */
  async function refreshClients() {
    const clients = (await db.getAll('clients')).sort((a, b) => a.order - b.order);
    clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
    const counts = {};
    const allTasks = await db.getAll('tasks');
    for (const t of allTasks) {
      if (t.status !== 'completed') counts[t.clientId] = (counts[t.clientId] || 0) + 1;
    }

    const container = document.getElementById('client-tabs');
    if (!container) return;

    const allCount = allTasks.filter(t => t.status !== 'completed').length;
    container.innerHTML = `
      <div class="client-tab ${currentFilters.clientId === 'all' ? 'active' : ''}" data-client="all">
        <span class="client-dot" style="background:#6366f1"></span>
        <span class="client-tab-name">All Clients</span>
        <span class="client-count">${allCount}</span>
      </div>
      ${clients.map((c, i) => `
        <div class="client-tab ${currentFilters.clientId === c.id ? 'active' : ''}" data-client="${c.id}">
          <span class="client-dot" style="background:${c.color}"></span>
          <span class="client-tab-name" title="${esc(c.name)}">${esc(c.name)}</span>
          <span class="client-count">${counts[c.id] || 0}</span>
          <div class="client-actions">
            <button class="client-action-btn" data-action="up" data-id="${c.id}" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="client-action-btn" data-action="down" data-id="${c.id}" title="Move down" ${i === clients.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="client-action-btn" data-action="edit" data-id="${c.id}" title="Edit">✎</button>
          </div>
        </div>
      `).join('')}
    `;

    // Events
    container.querySelectorAll('.client-tab').forEach(tab => {
      tab.addEventListener('click', e => {
        if (e.target.closest('.client-actions')) return;
        currentFilters.clientId = tab.dataset.client;
        refreshClients();
        refreshTasks();
      });
    });
    container.querySelectorAll('.client-action-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        if (action === 'up' || action === 'down') {
          await TaskManager.reorderClient(id, action);
          await refreshClients();
        } else if (action === 'edit') {
          openEditClientModal(id);
        }
      });
    });
  }

  /* ---------- Task list ---------- */
  async function refreshTasks() {
    employeeMap = await TaskManager.getEmployeeMap();

    const tasks = await db.getTasksFiltered(currentFilters);

    const sections = {
      urgent: tasks.filter(t => t.priority === 'urgent' && t.status !== 'completed'),
      high: tasks.filter(t => t.priority === 'high' && t.status !== 'completed'),
      medium: tasks.filter(t => t.priority === 'medium' && t.status !== 'completed'),
      low: tasks.filter(t => t.priority === 'low' && t.status !== 'completed'),
      completed: tasks.filter(t => t.status === 'completed')
    };

    for (const [key, list] of Object.entries(sections)) {
      const container = document.getElementById(`tasks-${key}`);
      const count = document.getElementById(`count-${key}`);
      if (!container) continue;
      if (count) count.textContent = list.length;

      if (list.length === 0) {
        container.innerHTML = `<div class="task-empty">No ${key === 'completed' ? 'completed' : key + ' priority'} tasks</div>`;
      } else {
        // Sort by updatedAt desc within each section
        list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        container.innerHTML = list.map(t => buildTaskCard(t)).join('');
        // Bind events
        container.querySelectorAll('.task-card').forEach(card => {
          card.addEventListener('click', e => {
            if (e.target.closest('.task-checkbox') || e.target.closest('.task-quick-btn')) return;
            openTaskDetail(card.dataset.id);
          });
        });
        container.querySelectorAll('.task-checkbox').forEach(cb => {
          cb.addEventListener('change', async () => {
            await TaskManager.toggleComplete(cb.dataset.id);
            await refreshAll();
          });
        });
        container.querySelectorAll('[data-quick="edit"]').forEach(btn => {
          btn.addEventListener('click', e => { e.stopPropagation(); openEditTaskModal(btn.dataset.id); });
        });
      }
    }
  }

  function buildTaskCard(task) {
    const client = clientMap[task.clientId];
    const assignee = task.assigneeId ? employeeMap[task.assigneeId] : null;
    const clientColor = client?.color || '#6366f1';
    const isCompleted = task.status === 'completed';
    const emailCount = task.emailIds?.length || 0;
    const dueLabel = task.dueDate ? `<span class="task-due">📅 ${task.dueDate}</span>` : '';
    const assigneeLabel = assignee
      ? `<span class="task-assignee">${avatar(assignee.name)}${esc(assignee.name)}</span>`
      : '';

    return `
      <div class="task-card ${isCompleted ? 'completed' : ''} priority-${task.priority}" data-id="${task.id}"
           style="--client-color:${clientColor}">
        <div class="task-card-inner">
          <div class="task-card-left">
            <label class="task-checkbox-wrap" onclick="event.stopPropagation()">
              <input type="checkbox" class="task-checkbox" data-id="${task.id}" ${isCompleted ? 'checked' : ''}>
              <span class="custom-checkbox"></span>
            </label>
          </div>
          <div class="task-card-body">
            <div class="task-card-top">
              <span class="priority-badge priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
              ${client ? `<span class="task-client-tag" style="color:${clientColor}">${esc(client.name)}</span>` : ''}
            </div>
            <h4 class="task-title ${isCompleted ? 'strikethrough' : ''}">${esc(task.title)}</h4>
            <div class="task-meta">
              ${assigneeLabel}
              ${dueLabel}
              ${emailCount > 0 ? `<span class="task-emails">✉ ${emailCount} email${emailCount > 1 ? 's' : ''}</span>` : ''}
              <span class="task-age">${timeAgo(task.updatedAt)}</span>
            </div>
          </div>
          <div class="task-card-actions">
            <button class="task-quick-btn" data-quick="edit" data-id="${task.id}" title="Edit">✎</button>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------- Task detail modal ---------- */
  async function openTaskDetail(taskId) {
    const task = await db.get('tasks', taskId);
    if (!task) return;

    const client = clientMap[task.clientId];
    const assignee = task.assigneeId ? employeeMap[task.assigneeId] : null;
    const employees = await db.getAll('employees');
    const clients = (await db.getAll('clients')).sort((a, b) => a.order - b.order);

    // Fetch thread emails
    const threadEmails = task.threadId
      ? (await db.getEmailsByThread(task.threadId)).sort((a, b) => new Date(a.date) - new Date(b.date))
      : [];

    const modal = document.getElementById('modal-task-detail');
    modal.querySelector('.modal-body').innerHTML = `
      <div class="detail-header">
        <div class="detail-badges">
          <span class="priority-badge priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
          <span class="status-badge status-${task.status}">${STATUS_LABELS[task.status]}</span>
          ${client ? `<span class="client-badge" style="border-color:${client.color};color:${client.color}">${esc(client.name)}</span>` : ''}
        </div>
        <h2 class="detail-title">${esc(task.title)}</h2>
      </div>

      <div class="detail-fields">
        <div class="detail-field">
          <label>Priority</label>
          <select id="detail-priority" data-id="${task.id}">
            ${['urgent','high','medium','low'].map(p => `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${PRIORITY_LABELS[p]}</option>`).join('')}
          </select>
        </div>
        <div class="detail-field">
          <label>Status</label>
          <select id="detail-status" data-id="${task.id}">
            <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Done</option>
          </select>
        </div>
        <div class="detail-field">
          <label>Assign to</label>
          <select id="detail-assignee" data-id="${task.id}">
            <option value="">— Unassigned —</option>
            ${employees.map(e => `<option value="${e.id}" ${task.assigneeId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select>
        </div>
        <div class="detail-field">
          <label>Client</label>
          <select id="detail-client" data-id="${task.id}">
            ${clients.map(c => `<option value="${c.id}" ${task.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      ${task.description ? `
        <div class="detail-section">
          <h3>Summary</h3>
          <p class="detail-text">${esc(task.description)}</p>
        </div>` : ''}

      ${task.actionables?.length ? `
        <div class="detail-section">
          <h3>Action Items</h3>
          <ul class="action-list">
            ${task.actionables.map(a => `<li>${esc(a)}</li>`).join('')}
          </ul>
        </div>` : ''}

      ${task.responsiblePerson ? `
        <div class="detail-section">
          <h3>Responsible Person / Next Steps</h3>
          <p class="detail-text responsible-person">${avatar(task.responsiblePerson)} ${esc(task.responsiblePerson)}</p>
        </div>` : ''}

      ${task.dueDate ? `
        <div class="detail-section">
          <h3>Due Date</h3>
          <p class="detail-text">📅 ${esc(task.dueDate)}</p>
        </div>` : ''}

      ${threadEmails.length > 0 ? `
        <div class="detail-section">
          <button class="section-toggle" id="toggle-thread">
            <span>📧 Email Thread (${threadEmails.length})</span>
            <span class="toggle-arrow">▾</span>
          </button>
          <div id="thread-container" class="thread-container" style="display:none">
            ${threadEmails.map(e => buildEmailRow(e)).join('')}
          </div>
        </div>` : ''}

      <div class="detail-actions">
        <button class="btn-secondary" id="detail-close-btn">Close</button>
        <button class="btn-primary" id="detail-save-btn" data-id="${task.id}">Save Changes</button>
      </div>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');

    // Events
    modal.querySelector('.modal-close')?.addEventListener('click', closeTaskDetail);
    modal.querySelector('#detail-close-btn')?.addEventListener('click', closeTaskDetail);
    modal.querySelector('.modal-overlay')?.addEventListener('click', closeTaskDetail);

    modal.querySelector('#toggle-thread')?.addEventListener('click', () => {
      const c = document.getElementById('thread-container');
      const arrow = modal.querySelector('.toggle-arrow');
      if (c.style.display === 'none') { c.style.display = 'block'; arrow.textContent = '▴'; }
      else { c.style.display = 'none'; arrow.textContent = '▾'; }
    });

    modal.querySelector('#detail-save-btn')?.addEventListener('click', async () => {
      const id = task.id;
      const priority = document.getElementById('detail-priority').value;
      const status = document.getElementById('detail-status').value;
      const assigneeId = document.getElementById('detail-assignee').value || null;
      const clientId = document.getElementById('detail-client').value;
      await TaskManager.updateTask(id, { priority, status, assigneeId, clientId });
      closeTaskDetail();
      await refreshAll();
      toast('Task updated', 'success');
    });
  }

  function buildEmailRow(email) {
    const sender = EmailParser.extractDisplayName(email.from);
    const date = new Date(email.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const body = EmailParser.removeQuotedText(email.body || email.snippet || '');
    const preview = body.substring(0, 600);

    return `
      <div class="email-row">
        <div class="email-row-header">
          <span class="email-sender">${avatar(sender)} ${esc(sender)}</span>
          <span class="email-date">${esc(date)}</span>
        </div>
        <div class="email-subject">${esc(email.subject)}</div>
        <div class="email-preview">${esc(preview)}${body.length > 600 ? '…' : ''}</div>
      </div>
    `;
  }

  function closeTaskDetail() {
    document.getElementById('modal-task-detail')?.classList.remove('active');
    document.body.classList.remove('modal-open');
  }

  /* ---------- Edit/Create task modal ---------- */
  async function openEditTaskModal(taskId) {
    const task = taskId ? await db.get('tasks', taskId) : null;
    const clients = (await db.getAll('clients')).sort((a, b) => a.order - b.order);
    const employees = await db.getAll('employees');

    const modal = document.getElementById('modal-task-edit');
    modal.querySelector('.modal-body').innerHTML = `
      <div class="form-group">
        <label>Task Title *</label>
        <input type="text" id="edit-title" placeholder="Describe the task…" value="${esc(task?.title || '')}">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="edit-desc" rows="3" placeholder="More details…">${esc(task?.description || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Client *</label>
          <select id="edit-client">
            <option value="">— Select client —</option>
            ${clients.map(c => `<option value="${c.id}" ${task?.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Priority</label>
          <select id="edit-priority">
            ${['urgent','high','medium','low'].map(p => `<option value="${p}" ${(task?.priority || 'medium') === p ? 'selected' : ''}>${PRIORITY_LABELS[p]}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Assign to</label>
          <select id="edit-assignee">
            <option value="">— Unassigned —</option>
            ${employees.map(e => `<option value="${e.id}" ${task?.assigneeId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Due Date</label>
          <input type="text" id="edit-due" placeholder="e.g. 15 May 2025" value="${esc(task?.dueDate || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>Action Items (one per line)</label>
        <textarea id="edit-actionables" rows="3" placeholder="• Action 1&#10;• Action 2">${esc((task?.actionables || []).join('\n'))}</textarea>
      </div>
      <div class="form-group">
        <label>Responsible Person</label>
        <input type="text" id="edit-responsible" placeholder="Name of person responsible" value="${esc(task?.responsiblePerson || '')}">
      </div>
      <div class="detail-actions">
        <button class="btn-secondary" id="edit-cancel-btn">Cancel</button>
        <button class="btn-primary" id="edit-save-btn">${task ? 'Update Task' : 'Create Task'}</button>
      </div>
    `;

    modal.querySelector('.modal-title').textContent = task ? 'Edit Task' : 'New Task';
    modal.classList.add('active');
    document.body.classList.add('modal-open');

    modal.querySelector('.modal-close')?.addEventListener('click', closeEditTask);
    modal.querySelector('#edit-cancel-btn')?.addEventListener('click', closeEditTask);
    modal.querySelector('.modal-overlay')?.addEventListener('click', closeEditTask);

    modal.querySelector('#edit-save-btn')?.addEventListener('click', async () => {
      const title = document.getElementById('edit-title').value.trim();
      const clientId = document.getElementById('edit-client').value;
      if (!title) { toast('Title is required', 'error'); return; }
      if (!clientId) { toast('Please select a client', 'error'); return; }

      const data = {
        clientId,
        title,
        description: document.getElementById('edit-desc').value.trim(),
        priority: document.getElementById('edit-priority').value,
        assigneeId: document.getElementById('edit-assignee').value || null,
        dueDate: document.getElementById('edit-due').value.trim() || null,
        actionables: document.getElementById('edit-actionables').value.split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean),
        responsiblePerson: document.getElementById('edit-responsible').value.trim()
      };

      if (task) {
        await TaskManager.updateTask(task.id, data);
        toast('Task updated', 'success');
      } else {
        await TaskManager.createTask(data);
        toast('Task created', 'success');
      }
      closeEditTask();
      await refreshAll();
    });
  }

  function closeEditTask() {
    document.getElementById('modal-task-edit')?.classList.remove('active');
    document.body.classList.remove('modal-open');
  }

  /* ---------- Employee modal ---------- */
  async function openEmployeeModal() {
    const employees = await db.getAll('employees');
    const modal = document.getElementById('modal-employees');

    modal.querySelector('#employee-list').innerHTML = employees.length === 0
      ? '<p class="empty-state">No employees added yet.</p>'
      : employees.map(e => `
          <div class="employee-row">
            <span class="emp-avatar">${avatar(e.name)}</span>
            <div class="emp-info">
              <strong>${esc(e.name)}</strong>
              <span>${esc(e.email)}</span>
              ${e.department ? `<span class="emp-dept">${esc(e.department)}</span>` : ''}
            </div>
          </div>`).join('');

    modal.classList.add('active');
    document.body.classList.add('modal-open');

    modal.querySelector('.modal-close')?.addEventListener('click', () => {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
    });
    modal.querySelector('.modal-overlay')?.addEventListener('click', () => {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
    });

    const addBtn = modal.querySelector('#add-employee-btn');
    addBtn?.addEventListener('click', async () => {
      const name = modal.querySelector('#emp-name').value.trim();
      const email = modal.querySelector('#emp-email').value.trim();
      const dept = modal.querySelector('#emp-dept').value.trim();
      if (!name || !email) { toast('Name and email are required', 'error'); return; }
      try {
        await TaskManager.addEmployee(name, email, dept);
        modal.querySelector('#emp-name').value = '';
        modal.querySelector('#emp-email').value = '';
        modal.querySelector('#emp-dept').value = '';
        await openEmployeeModal();
        toast('Employee added', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /* ---------- Client edit modal ---------- */
  async function openEditClientModal(clientId) {
    const client = await db.get('clients', clientId);
    if (!client) return;

    const modal = document.getElementById('modal-client-edit');
    modal.querySelector('#client-edit-name').value = client.name;
    modal.querySelector('#client-edit-color').value = client.color;
    modal.dataset.clientId = clientId;
    modal.classList.add('active');
    document.body.classList.add('modal-open');

    const save = async () => {
      const name = modal.querySelector('#client-edit-name').value.trim();
      const color = modal.querySelector('#client-edit-color').value;
      if (!name) { toast('Client name required', 'error'); return; }
      await TaskManager.updateClient(clientId, { name, color });
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
      await refreshAll();
      toast('Client updated', 'success');
    };

    modal.querySelector('#client-save-btn').onclick = save;
    modal.querySelector('.modal-close').onclick = () => { modal.classList.remove('active'); document.body.classList.remove('modal-open'); };
    modal.querySelector('.modal-overlay').onclick = () => { modal.classList.remove('active'); document.body.classList.remove('modal-open'); };
  }

  /* ---------- Settings modal ---------- */
  async function openSettings() {
    const modal = document.getElementById('modal-settings');
    const clientId = await db.getConfig('google_client_id');
    modal.querySelector('#settings-client-id').value = clientId || '';
    modal.classList.add('active');
    document.body.classList.add('modal-open');

    modal.querySelector('.modal-close').onclick = () => { modal.classList.remove('active'); document.body.classList.remove('modal-open'); };
    modal.querySelector('.modal-overlay').onclick = () => { modal.classList.remove('active'); document.body.classList.remove('modal-open'); };
    modal.querySelector('#settings-save-btn').onclick = async () => {
      const cid = modal.querySelector('#settings-client-id').value.trim();
      if (!cid) { toast('Client ID required', 'error'); return; }
      await db.setConfig('google_client_id', cid);
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
      toast('Settings saved — refreshing…', 'success');
      setTimeout(() => location.reload(), 1000);
    };
    modal.querySelector('#settings-reset-btn').onclick = async () => {
      if (!confirm('This will clear your pattern lock. You will need to set it up again. Continue?')) return;
      await db.setConfig('pattern_hash', null);
      await db.setConfig('setup_complete', false);
      location.reload();
    };
    modal.querySelector('#settings-employees-btn').onclick = () => {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
      openEmployeeModal();
    };
  }

  /* ---------- Filter bar ---------- */
  function initFilters() {
    const search = document.getElementById('search-input');
    const statusSel = document.getElementById('filter-status');
    const prioritySel = document.getElementById('filter-priority');
    const assigneeSel = document.getElementById('filter-assignee');

    const apply = () => {
      currentFilters.query = search?.value || '';
      currentFilters.status = statusSel?.value || '';
      currentFilters.priority = prioritySel?.value || '';
      currentFilters.assigneeId = assigneeSel?.value || '';
      refreshTasks();
    };

    search?.addEventListener('input', debounce(apply, 300));
    statusSel?.addEventListener('change', apply);
    prioritySel?.addEventListener('change', apply);
    assigneeSel?.addEventListener('change', apply);
  }

  async function refreshAssigneeFilter() {
    const sel = document.getElementById('filter-assignee');
    if (!sel) return;
    const employees = await db.getAll('employees');
    const current = sel.value;
    sel.innerHTML = `<option value="">All Assignees</option>` +
      employees.map(e => `<option value="${e.id}" ${current === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  }

  /* ---------- Completed section toggle ---------- */
  function initCompletedToggle() {
    const header = document.querySelector('#section-completed .section-header');
    const list = document.getElementById('tasks-completed');
    header?.addEventListener('click', () => {
      const isHidden = list.style.display === 'none' || list.style.display === '';
      list.style.display = isHidden ? 'block' : 'none';
      const arrow = header.querySelector('.toggle-arrow');
      if (arrow) arrow.textContent = isHidden ? '▴' : '▾';
    });
    // Start collapsed
    if (list) list.style.display = 'none';
  }

  /* ---------- Full refresh ---------- */
  async function refreshAll() {
    employeeMap = await TaskManager.getEmployeeMap();
    clientMap = await TaskManager.getClientMap();
    await Promise.all([refreshStats(), refreshClients(), refreshTasks(), refreshAssigneeFilter()]);
  }

  /* ---------- Helpers ---------- */
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function avatar(name) {
    if (!name) return '<span class="avatar">?</span>';
    const initials = name.split(/\s+/).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('');
    const colors = ['#6366f1','#8b5cf6','#ec4899','#10b981','#f59e0b','#3b82f6'];
    const color = colors[name.charCodeAt(0) % colors.length];
    return `<span class="avatar" style="background:${color}">${initials}</span>`;
  }

  function timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(isoStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  return {
    showScreen,
    toast,
    showLoading,
    hideLoading,
    setLoadingMsg,
    setLoadingProgress,
    updateSyncStatus,
    refreshAll,
    refreshStats,
    refreshClients,
    refreshTasks,
    refreshAssigneeFilter,
    initFilters,
    initCompletedToggle,
    openTaskDetail,
    openEditTaskModal,
    openEmployeeModal,
    openEditClientModal,
    openSettings
  };
})();
