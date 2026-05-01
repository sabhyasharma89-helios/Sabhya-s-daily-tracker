/**
 * Main Application Logic – Sabhya's Daily Task Tracker
 * Reads from /data/tasks.json and /data/employees.json (served via GitHub Pages)
 * All mutations (add/edit/complete) are stored in localStorage as a diff layer
 * on top of the server JSON, so data survives refreshes without a backend.
 */

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
const STATE = {
  tasksData:     { clients: {}, lastUpdated: null, stats: {} },
  localChanges:  {},   // keyed by task id: partial override
  employees:     [],
  filter:        'all',
  search:        '',
  sortBy:        'priority',
  employeeFilter: null,
  completedOpen: false,
  editingTaskId: null,
  clientOrder:   [],   // for drag-reorder persistence
};

const LOCAL_KEY   = 'tracker_local_changes';
const EMP_KEY     = 'tracker_employees';
const ORDER_KEY   = 'tracker_client_order';
const DATA_URL    = 'data/tasks.json';
const META_URL    = 'data/metadata.json';
const EMP_URL     = 'data/employees.json';

// ═══════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════
window.appInit = async function () {
  loadLocalState();
  await fetchData();
  renderAll();
  bindEvents();
  scheduleRefresh();
};

function loadLocalState () {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    STATE.localChanges = raw ? JSON.parse(raw) : {};
  } catch { STATE.localChanges = {}; }

  try {
    const raw = localStorage.getItem(EMP_KEY);
    STATE.employees = raw ? JSON.parse(raw) : [];
  } catch { STATE.employees = []; }

  try {
    const raw = localStorage.getItem(ORDER_KEY);
    STATE.clientOrder = raw ? JSON.parse(raw) : [];
  } catch { STATE.clientOrder = []; }
}

async function fetchData () {
  try {
    const [tasksRes, empRes] = await Promise.all([
      fetch(DATA_URL + '?t=' + Date.now()),
      fetch(EMP_URL  + '?t=' + Date.now()),
    ]);

    if (tasksRes.ok) {
      STATE.tasksData = await tasksRes.json();
    }

    if (empRes.ok) {
      const empData = await empRes.json();
      // Merge remote employees with locally added ones
      const remote = empData.employees || [];
      const merged = [...new Set([...remote, ...STATE.employees])];
      STATE.employees = merged;
      localStorage.setItem(EMP_KEY, JSON.stringify(STATE.employees));
    }
  } catch (err) {
    console.warn('Fetch error (offline mode):', err);
  }

  // Patch server tasks with local changes
  applyLocalChanges();
}

function applyLocalChanges () {
  Object.entries(STATE.localChanges).forEach(([id, change]) => {
    const loc = findTaskById(id, STATE.tasksData);
    if (loc) {
      Object.assign(loc.task, change);
    } else if (change._new) {
      // Locally added task — insert into clients
      const client = change.client || 'Uncategorized';
      if (!STATE.tasksData.clients[client]) {
        STATE.tasksData.clients[client] = { tasks: [] };
      }
      // Avoid duplicates on re-render
      const exists = STATE.tasksData.clients[client].tasks.some(t => t.id === id);
      if (!exists) {
        STATE.tasksData.clients[client].tasks.push({ ...change, id });
      }
    }
  });
  recalcStats();
}

function saveLocalChanges () {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(STATE.localChanges));
}

// ═══════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════
function recalcStats () {
  let total = 0, pending = 0, completed = 0, urgent = 0, medium = 0, low = 0;
  forEachTask(task => {
    total++;
    if (task.status === 'completed') completed++;
    else pending++;
    if (task.priority === 'urgent')  urgent++;
    if (task.priority === 'medium')  medium++;
    if (task.priority === 'low')     low++;
  });
  STATE.tasksData.stats = { total, pending, completed, urgent, medium, low };
}

// ═══════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════
function renderAll () {
  renderStats();
  renderClients();
  renderCompleted();
  renderEmployeeFilter();
  updateLastUpdated();
}

function renderStats () {
  const s = STATE.tasksData.stats || {};
  setText('statTotal',     s.total     || 0);
  setText('statPending',   s.pending   || 0);
  setText('statUrgent',    s.urgent    || 0);
  setText('statMedium',    s.medium    || 0);
  setText('statLow',       s.low       || 0);
  setText('statCompleted', s.completed || 0);
  setText('completedCount', s.completed || 0);
}

function getClientOrder () {
  const remote = Object.keys(STATE.tasksData.clients || {});
  const saved  = STATE.clientOrder.filter(c => remote.includes(c));
  const extra  = remote.filter(c => !saved.includes(c));
  return [...saved, ...extra];
}

function renderClients () {
  const container = document.getElementById('clientSections');
  container.innerHTML = '';

  const order = getClientOrder();
  const clients = STATE.tasksData.clients || {};
  let anyVisible = false;

  order.forEach(clientName => {
    const clientData = clients[clientName];
    if (!clientData) return;

    const pendingTasks = (clientData.tasks || []).filter(t => t.status !== 'completed');
    const filtered     = applyFiltersToList(pendingTasks);
    if (filtered.length === 0 && STATE.filter !== 'all' && !STATE.search) return;

    anyVisible = true;
    container.appendChild(buildClientSection(clientName, filtered, pendingTasks.length));
  });

  // Empty state
  const emptyEl = document.getElementById('emptyState');
  if (!anyVisible && Object.keys(clients).length === 0) {
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
  }

  initDragDrop();
}

function buildClientSection (name, filteredTasks, totalPending) {
  const section = document.createElement('div');
  section.className = 'client-section expanded';
  section.dataset.client = name;

  // Badge counts
  const urgentCount = filteredTasks.filter(t => t.priority === 'urgent').length;
  const mediumCount = filteredTasks.filter(t => t.priority === 'medium').length;
  const lowCount    = filteredTasks.filter(t => t.priority === 'low').length;

  const header = document.createElement('div');
  header.className = 'client-header';
  header.innerHTML = `
    <span class="drag-handle" title="Drag to reorder">⠿</span>
    <div class="client-header-left">
      <div class="client-avatar">${name.slice(0,2).toUpperCase()}</div>
      <div>
        <div class="client-name">${esc(name)}</div>
        <div class="client-task-count">${totalPending} pending task${totalPending !== 1 ? 's' : ''}</div>
      </div>
    </div>
    <div class="client-header-right">
      <div class="client-priority-badges">
        ${urgentCount ? `<span class="priority-badge urgent">🔴 ${urgentCount}</span>` : ''}
        ${mediumCount ? `<span class="priority-badge medium">🟡 ${mediumCount}</span>` : ''}
        ${lowCount    ? `<span class="priority-badge low">🟢 ${lowCount}</span>`    : ''}
      </div>
      <span class="client-chevron">▶</span>
    </div>
  `;

  header.querySelector('.client-header-left').addEventListener('click', () => toggleSection(section));
  header.querySelector('.client-header-right').addEventListener('click', () => toggleSection(section));
  header.querySelector('.client-chevron').addEventListener('click', (e) => { e.stopPropagation(); toggleSection(section); });

  const body = document.createElement('div');
  body.className = 'client-body';

  // Group by priority
  const groups = { urgent: [], medium: [], low: [] };
  filteredTasks.forEach(t => { (groups[t.priority] || groups.medium).push(t); });

  const priorityLabels = { urgent: '🔴 Urgent', medium: '🟡 Medium', low: '🟢 Low' };
  ['urgent', 'medium', 'low'].forEach(pri => {
    if (groups[pri].length === 0) return;
    const grp = document.createElement('div');
    grp.className = 'priority-group';
    grp.innerHTML = `
      <div class="priority-group-header">
        <span class="priority-dot ${pri}"></span>
        ${priorityLabels[pri]}
        <span style="margin-left:auto;color:var(--text-muted)">${groups[pri].length}</span>
      </div>
    `;
    groups[pri].forEach(task => grp.appendChild(buildTaskCard(task, name)));
    body.appendChild(grp);
  });

  // Add task button for this client
  const addRow = document.createElement('div');
  addRow.className = 'client-add-row';
  addRow.innerHTML = `<button class="btn-add-task">＋ Add task for ${esc(name)}</button>`;
  addRow.querySelector('button').addEventListener('click', () => openEditModal(null, name));
  body.appendChild(addRow);

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function buildTaskCard (task, clientName) {
  const card = document.createElement('div');
  card.className = 'task-card' + (task.status === 'completed' ? ' completed-card' : '');
  card.dataset.taskId = task.id;

  const isChecked = task.status === 'completed';
  const assigneeHtml = task.assignedTo
    ? `<span class="task-assignee">👤 ${esc(task.assignedTo)}</span>`
    : '';
  const dateHtml = task.updatedAt
    ? `<span class="task-date">${relativeDate(task.updatedAt)}</span>`
    : '';
  const sourceHtml = task.source === 'email'
    ? `<span class="task-source-badge">✉ Email</span>`
    : '';

  card.innerHTML = `
    <div class="task-card-top">
      <div class="task-checkbox ${isChecked ? 'checked' : ''}" title="Mark as ${isChecked ? 'pending' : 'complete'}"></div>
      <div class="task-main">
        <div class="task-title">${esc(task.title)}</div>
        <div class="task-meta">
          <span class="task-priority ${task.priority}">${priorityLabel(task.priority)}</span>
          ${assigneeHtml}
          ${dateHtml}
          ${sourceHtml}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn edit-btn" title="Edit task">✏</button>
        <button class="task-action-btn" title="View detail">↗</button>
      </div>
    </div>
  `;

  card.querySelector('.task-checkbox').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTaskComplete(task.id, clientName);
  });

  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(task.id, clientName);
  });

  card.addEventListener('click', () => openTaskModal(task.id, clientName));
  return card;
}

function renderCompleted () {
  const container = document.getElementById('completedTasksContainer');
  container.innerHTML = '';

  const allCompleted = [];
  forEachTask((task, clientName) => {
    if (task.status === 'completed') allCompleted.push({ task, clientName });
  });

  const filtered = allCompleted.filter(({ task }) => {
    if (STATE.search) {
      const q = STATE.search.toLowerCase();
      return task.title.toLowerCase().includes(q) ||
             (task.description || '').toLowerCase().includes(q);
    }
    return true;
  });

  setText('completedCount', filtered.length);

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px 0">No completed tasks.</p>';
    return;
  }

  filtered.forEach(({ task, clientName }) => {
    container.appendChild(buildTaskCard(task, clientName));
  });
}

function renderEmployeeFilter () {
  const bar = document.getElementById('employeeFilterBar');
  if (STATE.employees.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  const chips = document.getElementById('employeeFilterChips');
  chips.innerHTML = '';
  STATE.employees.forEach(emp => {
    const btn = document.createElement('button');
    btn.className = 'fchip' + (STATE.employeeFilter === emp ? ' active' : '');
    btn.textContent = emp;
    btn.addEventListener('click', () => {
      STATE.employeeFilter = STATE.employeeFilter === emp ? null : emp;
      renderAll();
    });
    chips.appendChild(btn);
  });
}

function updateLastUpdated () {
  const el = document.getElementById('lastUpdatedLabel');
  if (STATE.tasksData.lastUpdated) {
    el.textContent = 'Updated ' + relativeDate(STATE.tasksData.lastUpdated);
  } else {
    el.textContent = 'Awaiting first sync…';
  }
}

// ═══════════════════════════════════════════
//  FILTERS
// ═══════════════════════════════════════════
function applyFiltersToList (tasks) {
  return tasks.filter(task => {
    // Status filter
    if (STATE.filter === 'pending'   && task.status === 'completed') return false;
    if (STATE.filter === 'completed' && task.status !== 'completed') return false;
    if (STATE.filter === 'urgent'    && task.priority !== 'urgent')  return false;
    if (STATE.filter === 'medium'    && task.priority !== 'medium')  return false;
    if (STATE.filter === 'low'       && task.priority !== 'low')     return false;

    // Employee filter
    if (STATE.employeeFilter && task.assignedTo !== STATE.employeeFilter) return false;

    // Search
    if (STATE.search) {
      const q = STATE.search.toLowerCase();
      const hay = [
        task.title, task.description, task.assignedTo,
        (task.emailThread || {}).subject,
        (task.actionItems || []).join(' ')
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

window.applyFilter = function (f) {
  STATE.filter = f;
  document.querySelectorAll('.fchip').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  document.querySelectorAll('.stat-chip').forEach(b => {
    b.classList.toggle('active', false);
  });
  renderClients();
  renderCompleted();
};

window.clearEmployeeFilter = function () {
  STATE.employeeFilter = null;
  renderAll();
};

// ═══════════════════════════════════════════
//  TASK MUTATIONS (local layer)
// ═══════════════════════════════════════════
function toggleTaskComplete (taskId, clientName) {
  const loc = findTaskById(taskId, STATE.tasksData);
  if (!loc) return;

  const task = loc.task;
  const newStatus = task.status === 'completed' ? 'pending' : 'completed';
  task.status = newStatus;
  if (newStatus === 'completed') task.completedAt = new Date().toISOString();
  else delete task.completedAt;

  patchLocalChange(taskId, { status: newStatus, completedAt: task.completedAt });
  recalcStats();
  renderAll();
  showToast(newStatus === 'completed' ? '✓ Marked as completed' : '↩ Moved back to pending');
}

function patchLocalChange (id, patch) {
  STATE.localChanges[id] = { ...(STATE.localChanges[id] || {}), ...patch };
  saveLocalChanges();
}

// ═══════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════
window.handleModalBackdropClick = function (e, modalId) {
  if (e.target.classList.contains('modal-backdrop')) closeModal(modalId);
};

window.closeModal = function (modalId) {
  document.getElementById(modalId).classList.add('hidden');
};

// ── Task Detail Modal ──
window.openTaskModal = function (taskId, clientName) {
  const loc = findTaskById(taskId, STATE.tasksData);
  if (!loc) return;
  const task = loc.task;

  document.getElementById('modalTaskTitle').textContent = task.title;
  const body = document.getElementById('taskModalBody');

  const thread = task.emailThread || {};
  const messages = thread.messages || [];

  body.innerHTML = `
    <div class="detail-meta-row">
      <div class="detail-meta-chip">
        ${priorityDot(task.priority)} Priority:
        <select class="priority-select-inline" data-taskid="${esc(taskId)}" data-client="${esc(clientName || loc.clientName)}">
          <option value="urgent"  ${task.priority==='urgent' ?'selected':''}>🔴 Urgent</option>
          <option value="medium"  ${task.priority==='medium' ?'selected':''}>🟡 Medium</option>
          <option value="low"     ${task.priority==='low'    ?'selected':''}>🟢 Low</option>
        </select>
      </div>
      <div class="detail-meta-chip">
        👤 Assigned to:
        <select class="priority-select-inline" id="assigneeSelect" data-taskid="${esc(taskId)}">
          <option value="">— Unassigned —</option>
          ${STATE.employees.map(e => `<option value="${esc(e)}" ${task.assignedTo===e?'selected':''}>${esc(e)}</option>`).join('')}
        </select>
      </div>
      ${task.status==='completed'
        ? `<div class="detail-meta-chip">✓ Completed ${task.completedAt ? relativeDate(task.completedAt) : ''}</div>`
        : ''}
      ${thread.subject ? `<div class="detail-meta-chip">✉ ${esc(thread.subject)}</div>` : ''}
    </div>

    ${task.description ? `
    <div class="detail-section">
      <h3>Description</h3>
      <div class="detail-summary">${esc(task.description)}</div>
    </div>` : ''}

    ${thread.summary ? `
    <div class="detail-section">
      <h3>Email Thread Summary</h3>
      <div class="detail-summary">${esc(thread.summary)}</div>
    </div>` : ''}

    ${(task.actionItems || []).length > 0 ? `
    <div class="detail-section">
      <h3>Action Items</h3>
      <ul class="action-item-list">
        ${task.actionItems.map(a => `<li><span class="action-bullet">→</span>${esc(a)}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${task.nextResponsible ? `
    <div class="detail-section">
      <h3>Next Steps Responsible</h3>
      <div class="detail-meta-chip" style="display:inline-flex">👤 ${esc(task.nextResponsible)}</div>
    </div>` : ''}

    ${messages.length > 0 ? `
    <div class="detail-section">
      <h3>Email Thread (${messages.length} message${messages.length!==1?'s':''})</h3>
      <div class="email-thread">
        ${messages.map(m => `
        <div class="email-msg">
          <div class="email-msg-header">
            <span class="email-from">${esc(m.from || 'Unknown')}</span>
            <span class="email-date">${m.date ? new Date(m.date).toLocaleString() : ''}</span>
          </div>
          <div class="email-body">${esc((m.body || '').slice(0, 1200))}${(m.body||'').length>1200?'\n…[truncated]':''}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="modal-actions">
      <button class="btn-secondary" onclick="openEditModal('${esc(taskId)}','${esc(clientName || loc.clientName)}');closeModal('taskModal')">✏ Edit</button>
      ${task.status !== 'completed'
        ? `<button class="btn-primary" onclick="toggleTaskComplete('${esc(taskId)}','${esc(clientName||loc.clientName)}');closeModal('taskModal')">✓ Mark Complete</button>`
        : `<button class="btn-secondary" onclick="toggleTaskComplete('${esc(taskId)}','${esc(clientName||loc.clientName)}');closeModal('taskModal')">↩ Mark Pending</button>`}
    </div>
  `;

  // Priority change listener
  body.querySelector('.priority-select-inline[data-taskid]').addEventListener('change', function () {
    changePriority(this.dataset.taskid, this.dataset.client, this.value);
  });
  // Assignee change
  const assignSel = body.querySelector('#assigneeSelect');
  if (assignSel) {
    assignSel.addEventListener('change', function () {
      changeAssignee(this.dataset.taskid, this.value);
    });
  }

  document.getElementById('taskModal').classList.remove('hidden');
};

function changePriority (taskId, clientName, newPriority) {
  const loc = findTaskById(taskId, STATE.tasksData);
  if (!loc) return;
  loc.task.priority = newPriority;
  patchLocalChange(taskId, { priority: newPriority });
  recalcStats();
  renderAll();
  showToast('Priority updated');
}

function changeAssignee (taskId, assignee) {
  const loc = findTaskById(taskId, STATE.tasksData);
  if (!loc) return;
  loc.task.assignedTo = assignee || null;
  patchLocalChange(taskId, { assignedTo: assignee || null });
  renderAll();
  showToast(assignee ? `Assigned to ${assignee}` : 'Unassigned');
}

// ── Edit / Add Task Modal ──
window.openEditModal = function (taskId, clientName) {
  STATE.editingTaskId = taskId;

  const isNew = !taskId;
  document.getElementById('editModalTitle').textContent = isNew ? 'Add New Task' : 'Edit Task';

  // Populate client datalist
  const clientDl = document.getElementById('clientDatalist');
  clientDl.innerHTML = Object.keys(STATE.tasksData.clients || {})
    .map(c => `<option value="${esc(c)}">`).join('');

  // Populate employee datalist
  const empDl = document.getElementById('employeeDatalist');
  empDl.innerHTML = STATE.employees.map(e => `<option value="${esc(e)}">`).join('');

  if (isNew) {
    document.getElementById('fClient').value      = clientName || '';
    document.getElementById('fTitle').value       = '';
    document.getElementById('fDescription').value = '';
    document.getElementById('fPriority').value    = 'medium';
    document.getElementById('fAssignee').value    = '';
    document.getElementById('fTaskId').value      = '';
    document.getElementById('actionItemsContainer').innerHTML = '';
  } else {
    const loc = findTaskById(taskId, STATE.tasksData);
    if (!loc) return;
    const task = loc.task;
    document.getElementById('fClient').value      = clientName || loc.clientName;
    document.getElementById('fTitle').value       = task.title;
    document.getElementById('fDescription').value = task.description || '';
    document.getElementById('fPriority').value    = task.priority || 'medium';
    document.getElementById('fAssignee').value    = task.assignedTo || '';
    document.getElementById('fTaskId').value      = taskId;

    const cont = document.getElementById('actionItemsContainer');
    cont.innerHTML = '';
    (task.actionItems || []).forEach(a => addActionItemRow(a));
  }

  document.getElementById('editModal').classList.remove('hidden');
};

window.addActionItemRow = function (value = '') {
  const cont = document.getElementById('actionItemsContainer');
  const row = document.createElement('div');
  row.className = 'action-item-row';
  row.innerHTML = `
    <input type="text" placeholder="Action item…" value="${esc(value)}" />
    <button type="button" class="remove-btn" onclick="this.parentElement.remove()">✕</button>
  `;
  cont.appendChild(row);
};

window.saveTask = function (e) {
  e.preventDefault();

  const client      = document.getElementById('fClient').value.trim();
  const title       = document.getElementById('fTitle').value.trim();
  const description = document.getElementById('fDescription').value.trim();
  const priority    = document.getElementById('fPriority').value;
  const assignedTo  = document.getElementById('fAssignee').value.trim() || null;
  const taskId      = document.getElementById('fTaskId').value;

  const actionItems = Array.from(document.querySelectorAll('#actionItemsContainer input'))
    .map(i => i.value.trim()).filter(Boolean);

  if (!client || !title) {
    showToast('Client and title are required', 'error');
    return;
  }

  const now = new Date().toISOString();

  if (!taskId) {
    // New task
    const id = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const newTask = {
      id, title, description, priority, assignedTo,
      actionItems, status: 'pending', source: 'manual',
      client, createdAt: now, updatedAt: now,
      _new: true
    };

    if (!STATE.tasksData.clients[client]) {
      STATE.tasksData.clients[client] = { tasks: [] };
    }
    STATE.tasksData.clients[client].tasks.push(newTask);
    STATE.localChanges[id] = { ...newTask };
  } else {
    // Edit existing
    const loc = findTaskById(taskId, STATE.tasksData);
    if (!loc) return;

    // Handle client change
    const oldClient = loc.clientName;
    if (oldClient !== client) {
      loc.client.tasks = loc.client.tasks.filter(t => t.id !== taskId);
      if (!STATE.tasksData.clients[client]) {
        STATE.tasksData.clients[client] = { tasks: [] };
      }
      const updatedTask = { ...loc.task, title, description, priority, assignedTo, actionItems, updatedAt: now };
      STATE.tasksData.clients[client].tasks.push(updatedTask);
    } else {
      Object.assign(loc.task, { title, description, priority, assignedTo, actionItems, updatedAt: now });
    }

    patchLocalChange(taskId, { title, description, priority, assignedTo, actionItems, updatedAt: now, client });
  }

  saveLocalChanges();
  recalcStats();
  renderAll();
  closeModal('editModal');
  showToast(taskId ? 'Task updated' : 'Task created', 'success');
};

// ── Settings Modal ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
});

function openSettings () {
  renderEmployeeListSettings();
  loadSyncStatus();
  document.getElementById('settingsModal').classList.remove('hidden');
}

function renderEmployeeListSettings () {
  const container = document.getElementById('employeeListSettings');
  container.innerHTML = '';
  if (STATE.employees.length === 0) {
    container.innerHTML = '<p class="hint-text">No employees added yet.</p>';
    return;
  }
  STATE.employees.forEach(emp => {
    const row = document.createElement('div');
    row.className = 'employee-item';
    row.innerHTML = `<span>${esc(emp)}</span><button class="employee-remove" title="Remove">✕</button>`;
    row.querySelector('.employee-remove').addEventListener('click', () => removeEmployee(emp));
    container.appendChild(row);
  });
}

window.addEmployee = function () {
  const input = document.getElementById('newEmployeeInput');
  const name = input.value.trim();
  if (!name) return;
  if (STATE.employees.includes(name)) { showToast('Already exists', 'error'); return; }
  STATE.employees.push(name);
  localStorage.setItem(EMP_KEY, JSON.stringify(STATE.employees));
  input.value = '';
  renderEmployeeListSettings();
  renderEmployeeFilter();
  showToast(`Added ${name}`, 'success');
};

function removeEmployee (name) {
  STATE.employees = STATE.employees.filter(e => e !== name);
  localStorage.setItem(EMP_KEY, JSON.stringify(STATE.employees));
  renderEmployeeListSettings();
  renderEmployeeFilter();
}

async function loadSyncStatus () {
  const box = document.getElementById('syncStatus');
  try {
    const res = await fetch(META_URL + '?t=' + Date.now());
    if (res.ok) {
      const meta = await res.json();
      box.innerHTML = `
        <strong>Last email sync:</strong> ${meta.lastEmailRead ? new Date(meta.lastEmailRead).toLocaleString() : 'Never (first run pending)'}<br>
        <strong>First run:</strong> ${meta.firstRun ? 'Yes – will process last 30 days of emails' : 'No'}<br>
        <strong>Version:</strong> ${meta.version || '1.0.0'}
      `;
    } else {
      box.textContent = 'Could not load sync status.';
    }
  } catch {
    box.textContent = 'Offline – sync status unavailable.';
  }
}

window.exportData = function () {
  const blob = new Blob([JSON.stringify(STATE.tasksData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'tasks_export.json';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ═══════════════════════════════════════════
//  TOGGLE HELPERS
// ═══════════════════════════════════════════
function toggleSection (sectionEl) {
  sectionEl.classList.toggle('expanded');
  const chevron = sectionEl.querySelector('.client-chevron');
  if (chevron) chevron.style.transform = sectionEl.classList.contains('expanded') ? 'rotate(90deg)' : '';
}

window.toggleCompleted = function () {
  STATE.completedOpen = !STATE.completedOpen;
  const container = document.getElementById('completedTasksContainer');
  const chevron   = document.getElementById('completedChevron');
  container.classList.toggle('hidden', !STATE.completedOpen);
  chevron.classList.toggle('open', STATE.completedOpen);
};

// ═══════════════════════════════════════════
//  DRAG & DROP CLIENT REORDER
// ═══════════════════════════════════════════
function initDragDrop () {
  const container = document.getElementById('clientSections');
  let dragging = null;

  container.querySelectorAll('.client-section').forEach(section => {
    const handle = section.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = section;
      section.classList.add('dragging');
    });
  });

  container.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const target = e.target.closest('.client-section');
    if (target && target !== dragging) {
      const rect = target.getBoundingClientRect();
      const mid  = rect.top + rect.height / 2;
      if (e.clientY < mid) container.insertBefore(dragging, target);
      else container.insertBefore(dragging, target.nextSibling);
    }
  });

  const stopDrag = () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    // Save new order
    const order = Array.from(container.querySelectorAll('.client-section'))
      .map(s => s.dataset.client);
    STATE.clientOrder = order;
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  };

  document.addEventListener('mouseup', stopDrag);
}

// ═══════════════════════════════════════════
//  EVENT BINDINGS
// ═══════════════════════════════════════════
function bindEvents () {
  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    showToast('Refreshing data…');
    await fetchData();
    renderAll();
    showToast('Data refreshed', 'success');
  });

  // Lock
  document.getElementById('lockBtn').addEventListener('click', () => {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('patternScreen').classList.remove('hidden');
  });

  // Add task global
  document.getElementById('addTaskGlobalBtn').addEventListener('click', () => openEditModal(null, ''));

  // Filter chips
  document.querySelectorAll('.fchip').forEach(btn => {
    btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
  });

  // Sort
  document.getElementById('sortBy').addEventListener('change', function () {
    STATE.sortBy = this.value;
    renderClients();
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearchBtn');

  searchInput.addEventListener('input', function () {
    STATE.search = this.value.trim();
    clearSearch.classList.toggle('hidden', !STATE.search);
    renderClients();
    renderCompleted();
  });

  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    STATE.search = '';
    clearSearch.classList.add('hidden');
    renderClients();
    renderCompleted();
  });
}

// ═══════════════════════════════════════════
//  AUTO-REFRESH
// ═══════════════════════════════════════════
function scheduleRefresh () {
  // Re-fetch every 10 minutes in case GitHub Actions updated the JSON
  setInterval(async () => {
    await fetchData();
    renderAll();
  }, 10 * 60 * 1000);
}

// ═══════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════
function findTaskById (id, data) {
  for (const [clientName, clientData] of Object.entries(data.clients || {})) {
    const task = (clientData.tasks || []).find(t => t.id === id);
    if (task) return { task, clientName, client: clientData };
  }
  return null;
}

function forEachTask (cb) {
  Object.entries(STATE.tasksData.clients || {}).forEach(([clientName, clientData]) => {
    (clientData.tasks || []).forEach(task => cb(task, clientName));
  });
}

function priorityLabel (p) {
  return p === 'urgent' ? '🔴 Urgent' : p === 'medium' ? '🟡 Medium' : '🟢 Low';
}

function priorityDot (p) {
  const colors = { urgent: 'var(--urgent)', medium: 'var(--medium)', low: 'var(--low)' };
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[p]||colors.medium};margin-right:4px"></span>`;
}

function relativeDate (iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function esc (str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function setText (id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showToast (msg, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

// Make globally accessible (called by pattern-auth unlock)
window.changeAssignee    = changeAssignee;
window.changePriority    = changePriority;
