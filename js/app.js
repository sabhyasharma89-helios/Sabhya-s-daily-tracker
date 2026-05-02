/* ══════════════════════════════════════════════════════════════════
   app.js — Main Application
   Orchestrates auth, DB, sync, and all UI interactions.
   ══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─ Utility helpers ─ */

function $(id) { return document.getElementById(id); }

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let _toastTimer = null;
function showToast(msg, type = '', duration = 3000) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.style.display = 'block';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
}

function confirm_(title, message) {
  return new Promise(resolve => {
    const overlay = $('confirmDialog');
    $('confirmTitle').textContent   = title;
    $('confirmMessage').textContent = message;
    overlay.style.display = 'flex';

    const ok  = $('confirmOk');
    const cancel = $('confirmCancel');

    function cleanup(val) {
      overlay.style.display = 'none';
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
      resolve(val);
    }

    $('confirmOk').addEventListener('click',     () => cleanup(true));
    $('confirmCancel').addEventListener('click',  () => cleanup(false));
  });
}

/* ═══════════════════════════════════════════ STATE ═══ */

const State = {
  tasks:     [],
  clients:   [],
  employees: [],
  filters: { search: '', priority: '', employee: '', status: 'pending' },
  clientOrder: [],   // ordered list of client IDs
  openClients: new Set(),  // expanded client sections
  activeTaskId: null,
  editingTask: null,
};

/* ═══════════════════════════════════════════ LOAD DATA ═══ */

async function loadData() {
  State.tasks     = await DB.getAllTasks();
  State.clients   = await DB.getAllClients();
  State.employees = await DB.getAllEmployees();

  // Build client order from stored order or alphabetical
  const storedOrder = JSON.parse(localStorage.getItem('sdt_client_order') || '[]');
  const clientIds   = State.clients.map(c => c.id);

  State.clientOrder = [
    ...storedOrder.filter(id => clientIds.includes(id)),
    ...clientIds.filter(id => !storedOrder.includes(id))
  ];
}

function saveClientOrder() {
  localStorage.setItem('sdt_client_order', JSON.stringify(State.clientOrder));
}

/* ═══════════════════════════════════════════ STATS ═══ */

function updateStats() {
  const tasks = State.tasks;
  const pending   = tasks.filter(t => t.status !== 'completed');
  const completed = tasks.filter(t => t.status === 'completed');

  $('statTotal').textContent     = tasks.length;
  $('statPending').textContent   = pending.length;
  $('statCompleted').textContent = completed.length;
  $('statUrgent').textContent    = pending.filter(t => t.priority === 'urgent').length;
  $('statMedium').textContent    = pending.filter(t => t.priority === 'medium').length;
  $('statLow').textContent       = pending.filter(t => t.priority === 'low').length;
}

/* ═══════════════════════════════════════════ FILTERS ═══ */

function filteredTasks(includeCompleted = false) {
  const { search, priority, employee, status } = State.filters;
  const sq = search.toLowerCase();

  return State.tasks.filter(t => {
    if (!includeCompleted && t.status === 'completed') return false;
    if (includeCompleted && t.status !== 'completed')  return false;
    if (status === 'pending'   && t.status === 'completed') return false;
    if (status === 'completed' && t.status !== 'completed') return false;

    if (priority && t.priority !== priority) return false;
    if (employee && t.assignedTo !== employee) return false;

    if (sq) {
      const haystack = [t.title, t.clientName, t.assignedTo, t.summary, t.description]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(sq)) return false;
    }
    return true;
  });
}

/* ═══════════════════════════════════════════ RENDER ═══ */

function render() {
  updateStats();
  renderClientList();
  renderCompletedSection();
  updateEmployeeFilters();
  updateClientSuggestions();
  updateEmployeeSuggestions();
  updateSettingsEmployeeList();
}

function renderClientList() {
  const container = $('clientList');
  container.innerHTML = '';

  const pending = filteredTasks(false);

  // Group by client
  const byClient = new Map();
  for (const task of pending) {
    const key = task.clientId || task.clientName || 'Unknown';
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(task);
  }

  // If filters are active, show filtered clients in order
  // otherwise respect clientOrder
  const orderedClients = State.clientOrder
    .map(id => State.clients.find(c => c.id === id))
    .filter(Boolean);

  // Also include clients from unfiltered tasks that might not be in clientOrder yet
  const extraClientNames = [...byClient.keys()].filter(k =>
    !orderedClients.some(c => c.id === k || c.name === k)
  );

  // Build all client sections
  let hasAny = false;

  for (const client of orderedClients) {
    const clientKey = client.id;
    const tasks = byClient.get(clientKey) || byClient.get(client.name) || [];
    if (tasks.length === 0 && State.filters.search) continue;
    if (tasks.length === 0 && !State.filters.search) {
      // Still show empty client if no filter
    }
    const el = buildClientSection(client.name, client.id, tasks, false);
    container.appendChild(el);
    if (tasks.length > 0) hasAny = true;
  }

  // Extra clients from tasks that aren't in the client registry
  for (const key of extraClientNames) {
    const tasks = byClient.get(key) || [];
    const el = buildClientSection(key, key, tasks, false);
    container.appendChild(el);
    if (tasks.length > 0) hasAny = true;
  }

  $('emptyState').style.display = (!hasAny && State.tasks.filter(t=>t.status!=='completed').length === 0) ? 'flex' : 'none';
}

function buildClientSection(name, clientId, tasks, isCompleted) {
  const isOpen = State.openClients.has(clientId);

  const section = document.createElement('div');
  section.className = 'client-section';
  section.dataset.clientId = clientId;
  section.draggable = !isCompleted;

  // Sort tasks: urgent → medium → low, then by date
  tasks.sort((a, b) => {
    const pOrder = { urgent: 0, medium: 1, low: 2 };
    const pa = pOrder[a.priority] ?? 3;
    const pb = pOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });

  const urgentCount = tasks.filter(t => t.priority === 'urgent').length;
  const badgeClass  = urgentCount > 0 ? 'badge-urgent' : '';

  section.innerHTML = `
    <div class="client-header">
      <div class="client-header-left">
        ${!isCompleted ? '<span class="client-drag-handle" title="Drag to reorder">⠿</span>' : ''}
        <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        <span class="client-name">${escHtml(name)}</span>
        <span class="task-count ${badgeClass}">${tasks.length}</span>
      </div>
      <div class="client-header-right">
        ${!isCompleted ? `<button class="btn-ghost btn-sm add-to-client-btn" data-client="${escHtml(name)}" data-clientid="${escHtml(clientId)}">+ Task</button>` : ''}
      </div>
    </div>
    <div class="client-tasks ${isOpen ? '' : 'collapsed'}">
      ${tasks.map(t => buildTaskCard(t)).join('')}
    </div>
  `;

  const header  = section.querySelector('.client-header');
  const chevron = section.querySelector('.chevron');
  const body    = section.querySelector('.client-tasks');

  header.addEventListener('click', (e) => {
    if (e.target.closest('.add-to-client-btn') || e.target.closest('.client-drag-handle')) return;
    const open = body.classList.toggle('collapsed');
    chevron.classList.toggle('open', !body.classList.contains('collapsed'));
    if (body.classList.contains('collapsed')) {
      State.openClients.delete(clientId);
    } else {
      State.openClients.add(clientId);
    }
  });

  const addBtn = section.querySelector('.add-to-client-btn');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddTaskModal(null, addBtn.dataset.client);
    });
  }

  // Task card clicks
  section.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('task-checkbox')) return;
      openTaskModal(card.dataset.taskId);
    });
    const cb = card.querySelector('.task-checkbox');
    if (cb) {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleTaskComplete(card.dataset.taskId, cb.checked);
      });
    }
  });

  // Drag-and-drop for client reordering
  if (!isCompleted) setupClientDrag(section);

  return section;
}

function buildTaskCard(task) {
  const isCompleted = task.status === 'completed';
  return `
    <div class="task-card ${isCompleted ? 'is-completed' : ''}" data-task-id="${escHtml(task.id)}">
      <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''}>
      <div class="task-body">
        <div class="task-title">${escHtml(task.title)}</div>
        <div class="task-meta">
          <span class="priority-badge ${escHtml(task.priority)}">${escHtml(task.priority)}</span>
          ${task.assignedTo ? `<span class="task-assignee">👤 ${escHtml(task.assignedTo)}</span>` : ''}
          <span class="task-date">${timeAgo(task.updatedAt)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderCompletedSection() {
  const completedTasks = filteredTasks(true);

  // Override: when status filter is 'pending', show nothing in completed section
  // when status filter is 'completed', show in client sections instead of here
  const header  = $('completedHeader');
  const body    = $('completedTasks');
  const count   = $('completedCount');
  const chevron = $('completedChevron');

  count.textContent = completedTasks.length;

  body.innerHTML = completedTasks.map(t => buildTaskCard(t)).join('');

  body.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('task-checkbox')) return;
      openTaskModal(card.dataset.taskId);
    });
    const cb = card.querySelector('.task-checkbox');
    if (cb) {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleTaskComplete(card.dataset.taskId, cb.checked);
      });
    }
  });

  if (!header._bound) {
    header._bound = true;
    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      chevron.classList.toggle('open', !collapsed);
    });
  }
}

/* ═══════════════════════════════════════════ TASK MODAL ═══ */

async function openTaskModal(taskId) {
  const task = await DB.getTask(taskId);
  if (!task) return;
  State.activeTaskId = taskId;

  const modal  = $('taskModal');
  const badge  = $('modalPriorityBadge');

  badge.textContent = task.priority?.toUpperCase() || '—';
  badge.className   = `modal-priority-badge ${task.priority || ''}`;

  $('modalTitle').textContent  = task.title || '—';
  $('modalClient').textContent = task.clientName || '—';
  $('modalCreated').textContent = formatDate(task.createdAt);
  $('modalUpdated').textContent = formatDateTime(task.updatedAt);

  const statusEl = $('modalStatus');
  statusEl.textContent = task.status === 'completed' ? 'Completed' : 'Pending';
  statusEl.className   = `meta-value status-badge ${task.status === 'completed' ? 'completed' : ''}`;

  $('modalPrioritySelect').value = task.priority || 'medium';
  populateAssigneeSelect($('modalAssigneeSelect'), task.assignedTo);

  $('modalSummary').textContent    = task.summary || task.description || 'No summary available.';
  $('modalNextSteps').textContent  = task.nextStepsResponsible || '—';

  const actionList = $('modalActionables');
  actionList.innerHTML = '';
  const items = task.actionables || [];
  if (items.length === 0) {
    actionList.innerHTML = '<li>No actionable items recorded.</li>';
  } else {
    items.forEach(a => {
      const li = document.createElement('li');
      li.textContent = a;
      actionList.appendChild(li);
    });
  }

  // Email thread
  const threadEl = $('modalThread');
  threadEl.innerHTML = '';
  const emails = task.emailThread || [];
  if (emails.length === 0) {
    threadEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">No emails in thread.</p>';
  } else {
    emails.forEach(email => {
      const div = document.createElement('div');
      div.className = 'thread-email';
      div.innerHTML = `
        <div class="thread-email-header">
          <span class="thread-email-from">${escHtml(email.from || 'Unknown')}</span>
          <span class="thread-email-date">${formatDateTime(email.date)}</span>
        </div>
        <div class="thread-email-subject">${escHtml(email.subject || '')}</div>
        <div class="thread-email-body">${escHtml(email.snippet || email.body || '')}</div>
        <button class="thread-expand-btn">Show more</button>
      `;
      const bodyEl  = div.querySelector('.thread-email-body');
      const showBtn = div.querySelector('.thread-expand-btn');
      if ((email.snippet || email.body || '').length < 200) showBtn.style.display = 'none';
      showBtn.addEventListener('click', () => {
        const expanded = bodyEl.classList.toggle('expanded');
        showBtn.textContent = expanded ? 'Show less' : 'Show more';
      });
      threadEl.appendChild(div);
    });
  }

  const completeBtn = $('taskToggleComplete');
  if (task.status === 'completed') {
    completeBtn.textContent = 'Mark Pending';
    completeBtn.className   = 'btn-complete is-completed btn-sm';
  } else {
    completeBtn.textContent = 'Mark Complete';
    completeBtn.className   = 'btn-complete btn-sm';
  }

  modal.style.display = 'flex';
}

function closeTaskModal() {
  $('taskModal').style.display = 'none';
  State.activeTaskId = null;
}

async function saveTaskModalChanges() {
  const id   = State.activeTaskId;
  if (!id) return;
  const task = await DB.getTask(id);
  if (!task) return;

  const newPriority = $('modalPrioritySelect').value;
  const newAssignee = $('modalAssigneeSelect').value;

  task.priority    = newPriority;
  task.assignedTo  = newAssignee;
  task._userPriority = newPriority;
  task._userAssignee = newAssignee;

  // Ensure employee is in the list
  if (newAssignee) await ensureEmployee(newAssignee);

  await Sync.saveAndSync(task);
  showToast('Task saved.', 'success');
  await loadData();
  render();
  closeTaskModal();
}

/* ═══════════════════════════════════════════ TOGGLE COMPLETE ═══ */

async function toggleTaskComplete(taskId, checked) {
  const task = await DB.getTask(taskId);
  if (!task) return;

  task.status       = checked ? 'completed' : 'pending';
  task._userStatus  = task.status;
  task.completedAt  = checked ? new Date().toISOString() : null;

  await Sync.saveAndSync(task);
  await loadData();
  render();
  showToast(checked ? 'Task marked complete.' : 'Task reopened.', 'success');
}

/* ═══════════════════════════════════════════ ADD / EDIT TASK ═══ */

function openAddTaskModal(taskId = null, clientName = '') {
  State.editingTask = taskId;
  $('addTaskModalTitle').textContent = taskId ? 'Edit Task' : 'Add New Task';

  if (taskId) {
    DB.getTask(taskId).then(task => {
      if (!task) return;
      $('formTitle').value       = task.title || '';
      $('formClient').value      = task.clientName || '';
      $('formPriority').value    = task.priority || 'medium';
      $('formDescription').value = task.description || task.summary || '';
      $('formActionables').value = (task.actionables || []).join('\n');
      $('formAssignee').value    = task.assignedTo || '';
      $('formNextSteps').value   = task.nextStepsResponsible || '';
    });
  } else {
    $('formTitle').value       = '';
    $('formClient').value      = clientName || '';
    $('formPriority').value    = 'medium';
    $('formDescription').value = '';
    $('formActionables').value = '';
    $('formAssignee').value    = '';
    $('formNextSteps').value   = '';
  }

  $('addTaskModal').style.display = 'flex';
  $('formTitle').focus();
}

async function submitAddTask() {
  const title    = $('formTitle').value.trim();
  const client   = $('formClient').value.trim();
  const priority = $('formPriority').value;

  if (!title) { showToast('Task title is required.', 'error'); return; }
  if (!client){ showToast('Client name is required.', 'error'); return; }

  const actionLines = $('formActionables').value
    .split('\n').map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);

  let clientRecord = State.clients.find(c => c.name.toLowerCase() === client.toLowerCase());
  if (!clientRecord) {
    clientRecord = await DB.saveClient({ name: client });
    State.clients.push(clientRecord);
    if (!State.clientOrder.includes(clientRecord.id)) {
      State.clientOrder.push(clientRecord.id);
      saveClientOrder();
    }
  }

  const assignee = $('formAssignee').value.trim();
  if (assignee) await ensureEmployee(assignee);

  const task = {
    id:                   State.editingTask || crypto.randomUUID(),
    title,
    clientId:             clientRecord.id,
    clientName:           clientRecord.name,
    priority,
    status:               'pending',
    source:               'manual',
    description:          $('formDescription').value.trim(),
    summary:              $('formDescription').value.trim(),
    actionables:          actionLines,
    assignedTo:           assignee,
    nextStepsResponsible: $('formNextSteps').value.trim(),
    emailThread:          [],
    _userPriority:        priority,
    _userAssignee:        assignee || null,
  };

  await Sync.saveAndSync(task);
  await loadData();
  render();
  $('addTaskModal').style.display = 'none';
  showToast(State.editingTask ? 'Task updated.' : 'Task added.', 'success');
  State.editingTask = null;
}

/* ═══════════════════════════════════════════ DELETE TASK ═══ */

async function deleteCurrentTask() {
  const id = State.activeTaskId;
  if (!id) return;

  const ok = await confirm_('Delete task?', 'This task will be permanently removed from your local view. (GitHub copy updated on next push.)');
  if (!ok) return;

  await Sync.deleteAndSync(id);
  closeTaskModal();
  await loadData();
  render();
  showToast('Task deleted.', 'success');
}

/* ═══════════════════════════════════════════ EMPLOYEES ═══ */

async function ensureEmployee(name) {
  const exists = State.employees.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!exists) {
    const emp = await DB.saveEmployee({ name });
    State.employees.push(emp);
  }
}

function populateAssigneeSelect(selectEl, current) {
  selectEl.innerHTML = '<option value="">Unassigned</option>';
  State.employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.name;
    opt.textContent = e.name;
    if (e.name === current) opt.selected = true;
    selectEl.appendChild(opt);
  });
  if (current && !State.employees.find(e => e.name === current)) {
    const opt = document.createElement('option');
    opt.value = current; opt.textContent = current; opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function updateEmployeeFilters() {
  const sel = $('filterEmployee');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All employees</option>';
  State.employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.name; opt.textContent = e.name;
    if (e.name === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

function updateClientSuggestions() {
  const dl = $('clientSuggestions');
  dl.innerHTML = '';
  State.clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    dl.appendChild(opt);
  });
}

function updateEmployeeSuggestions() {
  const dl = $('employeeSuggestions');
  dl.innerHTML = '';
  State.employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.name;
    dl.appendChild(opt);
  });
}

function updateSettingsEmployeeList() {
  const list = $('employeeList');
  if (!list) return;
  list.innerHTML = '';
  State.employees.forEach(emp => {
    const div = document.createElement('div');
    div.className = 'employee-item';
    div.innerHTML = `
      <span>${escHtml(emp.name)}</span>
      <button class="employee-remove" data-id="${escHtml(emp.id)}" title="Remove">×</button>
    `;
    div.querySelector('.employee-remove').addEventListener('click', async () => {
      const ok = await confirm_('Remove employee?', `Remove "${emp.name}" from the employee list?`);
      if (!ok) return;
      await DB.deleteEmployee(emp.id);
      State.employees = State.employees.filter(e => e.id !== emp.id);
      updateSettingsEmployeeList();
      updateEmployeeFilters();
      updateEmployeeSuggestions();
    });
    list.appendChild(div);
  });
  if (State.employees.length === 0) {
    list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted)">No employees added yet.</p>';
  }
}

/* ═══════════════════════════════════════════ DRAG AND DROP (clients) ═══ */

let _draggedClient = null;

function setupClientDrag(section) {
  section.addEventListener('dragstart', (e) => {
    _draggedClient = section;
    setTimeout(() => section.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  });
  section.addEventListener('dragend', () => {
    section.classList.remove('dragging');
    document.querySelectorAll('.client-section').forEach(s => s.classList.remove('drag-over'));
    _draggedClient = null;
  });
  section.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (_draggedClient && _draggedClient !== section) {
      section.classList.add('drag-over');
    }
  });
  section.addEventListener('dragleave', () => section.classList.remove('drag-over'));
  section.addEventListener('drop', (e) => {
    e.preventDefault();
    section.classList.remove('drag-over');
    if (!_draggedClient || _draggedClient === section) return;

    const container = $('clientList');
    const all = [...container.children];
    const fromIdx = all.indexOf(_draggedClient);
    const toIdx   = all.indexOf(section);
    if (fromIdx === -1 || toIdx === -1) return;

    if (fromIdx < toIdx) {
      container.insertBefore(_draggedClient, section.nextSibling);
    } else {
      container.insertBefore(_draggedClient, section);
    }

    // Persist new order
    State.clientOrder = [...container.children].map(el => el.dataset.clientId).filter(Boolean);
    saveClientOrder();
  });
}

/* ═══════════════════════════════════════════ SETTINGS ═══ */

async function openSettings() {
  const cfg = await Sync.loadConfig();
  $('settOwner').value  = cfg.owner  || '';
  $('settRepo').value   = cfg.repo   || '';
  $('settBranch').value = cfg.branch || 'main';
  $('settToken').value  = cfg.token  || '';
  updateSettingsEmployeeList();
  $('settingsModal').style.display = 'flex';
}

async function saveSettings() {
  const owner  = $('settOwner').value.trim();
  const repo   = $('settRepo').value.trim();
  const branch = $('settBranch').value.trim() || 'main';
  const token  = $('settToken').value.trim();

  await Sync.saveConfig(owner, repo, branch, token);
  $('settingsModal').style.display = 'none';
  showToast('Settings saved.', 'success');
}

/* ═══════════════════════════════════════════ SYNC STATUS ═══ */

function setSyncStatus(status) {
  const dot  = document.querySelector('.sync-dot');
  const time = $('syncTime');
  if (!dot || !time) return;

  dot.className = `sync-dot ${status}`;
  if (status === 'syncing') time.textContent = 'Syncing…';
  else if (status === 'error') time.textContent = 'Sync failed';
  else time.textContent = 'Synced ' + timeAgo(new Date().toISOString());
}

/* ═══════════════════════════════════════════ SETUP WIZARD ═══ */

function runSetupWizard(onComplete) {
  const wizard = $('setupWizard');
  wizard.style.display = 'flex';

  Auth.initSetupPatternLocks(() => showSetupStep(2));

  $('setupStep2Next').addEventListener('click', () => {
    const owner  = $('cfgOwner').value.trim();
    const repo   = $('cfgRepo').value.trim();
    const token  = $('cfgToken').value.trim();
    const branch = $('cfgBranch').value.trim() || 'main';

    if (!owner || !repo) { showToast('Repository owner and name are required.', 'error'); return; }

    Sync.saveConfig(owner, repo, branch, token).then(() => showSetupStep(3));
  });

  $('setupStep2Back').addEventListener('click', () => showSetupStep(1));

  $('setupDone').addEventListener('click', () => {
    wizard.style.display = 'none';
    DB.setConfig('setupComplete', true);
    onComplete();
  });
}

function showSetupStep(n) {
  document.querySelectorAll('.setup-step').forEach(el => el.classList.remove('active'));
  $(`setupStep${n}`).classList.add('active');
}

/* ═══════════════════════════════════════════ BOOT ═══ */

async function bootApp() {
  await DB.open();
  await loadData();

  updateStats();
  render();

  // Initial sync
  setSyncStatus('syncing');
  const result = await Sync.syncNow({ onStatus: setSyncStatus });
  if (result.ok && result.remote) {
    await loadData();
    render();
  }

  // Background auto-sync every 10 min
  Sync.startAutoSync(setSyncStatus, async () => {
    await loadData();
    render();
    showToast('Tasks updated from email sync.', '');
  });
}

/* ═══════════════════════════════════════════ EVENT BINDINGS ═══ */

document.addEventListener('DOMContentLoaded', async () => {
  await DB.open();

  const hasPattern  = Auth.isConfigured();
  const setupDone   = await DB.getConfig('setupComplete', false);

  if (!hasPattern || !setupDone) {
    // First time — show setup wizard
    document.getElementById('patternOverlay').style.display = 'none';
    runSetupWizard(() => {
      $('app').style.display = 'block';
      Auth.refreshSession();
      bootApp();
    });
    return;
  }

  if (Auth.isSessionValid()) {
    // Already authenticated this session
    $('patternOverlay').style.display = 'none';
    $('app').style.display = 'block';
    Auth.refreshSession();
    bootApp();
    return;
  }

  // Show pattern lock
  Auth.initUnlockScreen(() => {
    $('app').style.display = 'block';
    bootApp();
  });
});

/* ─ Nav buttons ─ */
$('lockBtn')?.addEventListener('click', () => Auth.lock());

$('refreshBtn')?.addEventListener('click', async () => {
  setSyncStatus('syncing');
  const result = await Sync.syncNow({ onStatus: setSyncStatus });
  if (result.ok) {
    await loadData(); render();
    showToast('Refreshed.', 'success');
  } else {
    showToast('Sync failed: ' + result.error, 'error');
  }
});

$('settingsBtn')?.addEventListener('click', openSettings);

/* ─ Task modal ─ */
$('taskModalClose')?.addEventListener('click',   closeTaskModal);
$('taskSaveChanges')?.addEventListener('click',  saveTaskModalChanges);
$('taskDeleteBtn')?.addEventListener('click',    deleteCurrentTask);
$('taskToggleComplete')?.addEventListener('click', async () => {
  const id = State.activeTaskId;
  if (!id) return;
  const task = await DB.getTask(id);
  if (!task) return;
  const newStatus = task.status === 'completed' ? 'pending' : 'completed';
  await toggleTaskComplete(id, newStatus === 'completed');
  closeTaskModal();
});

$('taskModal')?.addEventListener('click', (e) => {
  if (e.target === $('taskModal')) closeTaskModal();
});

$('threadToggle')?.addEventListener('click', () => {
  const body    = $('modalThread');
  const chevron = document.querySelector('#threadToggle .toggle-chevron');
  const collapsed = body.classList.toggle('collapsed');
  chevron.classList.toggle('open', !collapsed);
});

/* ─ Add task modal ─ */
$('addTaskBtn')?.addEventListener('click',     () => openAddTaskModal());
$('emptyAddBtn')?.addEventListener('click',    () => openAddTaskModal());
$('addTaskCancel')?.addEventListener('click',  () => { $('addTaskModal').style.display = 'none'; });
$('addTaskModalClose')?.addEventListener('click', () => { $('addTaskModal').style.display = 'none'; });
$('addTaskSubmit')?.addEventListener('click',  submitAddTask);
$('addTaskModal')?.addEventListener('click', (e) => {
  if (e.target === $('addTaskModal')) $('addTaskModal').style.display = 'none';
});

/* ─ Settings modal ─ */
$('settingsCancel')?.addEventListener('click',     () => { $('settingsModal').style.display = 'none'; });
$('settingsModalClose')?.addEventListener('click', () => { $('settingsModal').style.display = 'none'; });
$('settingsSave')?.addEventListener('click',       saveSettings);

$('addEmployeeBtn')?.addEventListener('click', async () => {
  const name = $('newEmployeeName').value.trim();
  if (!name) return;
  await ensureEmployee(name);
  State.employees = await DB.getAllEmployees();
  $('newEmployeeName').value = '';
  updateSettingsEmployeeList();
  updateEmployeeFilters();
  updateEmployeeSuggestions();
  showToast(`Employee "${name}" added.`, 'success');
});

$('changePatternBtn')?.addEventListener('click', () => {
  localStorage.removeItem('sdt_pattern_hash');
  showToast('Pattern cleared. Please reload to set a new pattern.', '');
  setTimeout(() => location.reload(), 2000);
});

$('resetAppBtn')?.addEventListener('click', async () => {
  const ok = await confirm_('Reset all data?', 'This will permanently delete all local tasks and settings. This cannot be undone.');
  if (!ok) return;
  await DB.resetAll();
  localStorage.clear();
  sessionStorage.clear();
  location.reload();
});

$('settingsModal')?.addEventListener('click', (e) => {
  if (e.target === $('settingsModal')) $('settingsModal').style.display = 'none';
});

/* ─ Search & Filters ─ */
$('searchInput')?.addEventListener('input', (e) => {
  State.filters.search = e.target.value;
  $('clearSearch').style.display = e.target.value ? 'block' : 'none';
  render();
});
$('clearSearch')?.addEventListener('click', () => {
  $('searchInput').value = '';
  $('clearSearch').style.display = 'none';
  State.filters.search = '';
  render();
});
$('filterPriority')?.addEventListener('change', (e) => { State.filters.priority = e.target.value; render(); });
$('filterEmployee')?.addEventListener('change', (e) => { State.filters.employee = e.target.value; render(); });
$('filterStatus')?.addEventListener('change',   (e) => { State.filters.status   = e.target.value; render(); });

/* ─ Auto-expand first client by default ─ */
window.addEventListener('load', () => {
  if (State.openClients.size === 0 && State.clients.length > 0) {
    State.openClients.add(State.clientOrder[0]);
  }
});
