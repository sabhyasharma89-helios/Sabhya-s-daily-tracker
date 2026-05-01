/**
 * Main application controller.
 * Manages screens, renders the dashboard, and wires all interactions.
 */

/* ── Globals ─────────────────────────────────────────────────── */
let activeClientId = 'all';
let filterPriority = 'all';
let filterAssignee = 'all';
let searchQuery    = '';
let expandedTaskId = null;
let autoSyncTimer  = null;

/* ── Toast ───────────────────────────────────────────────────── */
function toast(msg, type = 'info', dur = 3000) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

/* ── Screen switching ────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

/* ═══════════════════════════════════════════════════════════════
   SETUP WIZARD
═══════════════════════════════════════════════════════════════ */
function initSetup() {
  showScreen('setup-screen');
  let step = 1;
  const totalSteps = 3;

  updateSetupStep();

  function updateSetupStep() {
    document.querySelectorAll('.setup-step').forEach((el, i) => {
      el.classList.toggle('hidden', i + 1 !== step);
    });
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i + 1 === step);
      dot.classList.toggle('done',   i + 1 < step);
    });
  }

  document.getElementById('setup-next-1').addEventListener('click', () => {
    step = 2; updateSetupStep();
    // Init pattern drawing for setup
    const canvas = document.getElementById('setup-pattern-canvas');
    PatternAuth.destroy();
    PatternAuth.init(canvas, 'set', () => {
      step = 3; updateSetupStep();
    });
    document.getElementById('auth-title-setup').textContent = 'Draw your pattern';
    document.getElementById('auth-message-setup').textContent = 'Connect at least 4 dots';
  });

  document.getElementById('setup-prev-2').addEventListener('click', () => {
    step = 1; updateSetupStep();
    PatternAuth.destroy();
  });

  document.getElementById('setup-prev-3').addEventListener('click', () => {
    step = 2; updateSetupStep();
  });

  document.getElementById('setup-finish').addEventListener('click', async () => {
    const owner  = document.getElementById('gh-owner').value.trim();
    const repo   = document.getElementById('gh-repo').value.trim();
    const token  = document.getElementById('gh-token').value.trim();
    const branch = document.getElementById('gh-branch').value.trim() || 'main';

    if (!owner || !repo || !token) {
      toast('Please fill in all GitHub fields', 'error'); return;
    }

    const btn = document.getElementById('setup-finish');
    btn.textContent = 'Verifying…'; btn.disabled = true;

    try {
      await GithubAPI.verifyConfig(owner, repo, token);
      localStorage.setItem('tracker_github', JSON.stringify({ owner, repo, token, branch }));
      localStorage.setItem('tracker_setup_done', '1');
      toast('Setup complete!', 'success');
      setTimeout(() => initDashboard(), 400);
    } catch (err) {
      toast('GitHub config invalid: ' + err.message, 'error');
    } finally {
      btn.textContent = 'Finish Setup'; btn.disabled = false;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   AUTH SCREEN
═══════════════════════════════════════════════════════════════ */
function initAuth(onUnlock) {
  showScreen('auth-screen');
  const canvas = document.getElementById('pattern-canvas');
  document.getElementById('auth-title').textContent = 'Draw your pattern to unlock';
  document.getElementById('auth-message').textContent = '';

  PatternAuth.init(canvas, 'verify', () => {
    PatternAuth.destroy();
    onUnlock();
  });

  document.getElementById('auth-reset-btn').addEventListener('click', () => {
    if (confirm('This will clear your pattern and require re-setup. Continue?')) {
      PatternAuth.clearStoredPattern();
      localStorage.removeItem('tracker_setup_done');
      window.location.reload();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════ */
async function initDashboard() {
  showScreen('dashboard-screen');
  document.getElementById('loading-overlay').classList.remove('hidden');

  try {
    await TaskManager.load();
  } catch (err) {
    toast('Failed to load tasks: ' + err.message, 'error');
  } finally {
    document.getElementById('loading-overlay').classList.add('hidden');
  }

  renderAll();
  startAutoRefresh();
  wireControls();
}

function renderAll() {
  renderStats();
  renderClientTabs();
  renderTaskList();
  renderCompletedSection();
  renderLastUpdated();
}

/* ── Stats bar ────────────────────────────────────────────────── */
function renderStats() {
  const s = TaskManager.getStats();
  document.getElementById('stat-total').textContent    = s.total;
  document.getElementById('stat-pending').textContent  = s.pending;
  document.getElementById('stat-urgent').textContent   = s.urgent;
  document.getElementById('stat-medium').textContent   = s.medium;
  document.getElementById('stat-low').textContent      = s.low;
  document.getElementById('stat-done').textContent     = s.completed;
}

/* ── Client tabs ──────────────────────────────────────────────── */
function renderClientTabs() {
  const scroll = document.getElementById('client-tabs-scroll');
  const clients = TaskManager.getClients();

  // Count pending per client
  const pendingCounts = {};
  TaskManager.getPending().forEach(t => {
    pendingCounts[t.clientId] = (pendingCounts[t.clientId] || 0) + 1;
  });

  const allCount = TaskManager.getPending().length;

  scroll.innerHTML = '';

  const allTab = document.createElement('button');
  allTab.className = 'tab-item' + (activeClientId === 'all' ? ' active' : '');
  allTab.dataset.id = 'all';
  allTab.innerHTML = `All Clients <span class="tab-badge">${allCount}</span>`;
  allTab.addEventListener('click', () => setActiveClient('all'));
  scroll.appendChild(allTab);

  clients.forEach(client => {
    const count = pendingCounts[client.id] || 0;
    const tab = document.createElement('button');
    tab.className = 'tab-item' + (activeClientId === client.id ? ' active' : '');
    tab.dataset.id = client.id;
    tab.draggable = true;
    tab.innerHTML = `${escHtml(client.name)} <span class="tab-badge">${count}</span>`;
    tab.addEventListener('click', () => setActiveClient(client.id));
    setupTabDrag(tab);
    scroll.appendChild(tab);
  });
}

function setActiveClient(id) {
  activeClientId = id;
  renderClientTabs();
  renderTaskList();
}

/* ── Tab drag-to-reorder ─────────────────────────────────────── */
let dragSrcId = null;

function setupTabDrag(tab) {
  tab.addEventListener('dragstart', e => {
    dragSrcId = tab.dataset.id;
    tab.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
  tab.addEventListener('dragover', e => { e.preventDefault(); tab.classList.add('drag-over'); });
  tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));
  tab.addEventListener('drop', e => {
    e.preventDefault();
    tab.classList.remove('drag-over');
    if (!dragSrcId || dragSrcId === tab.dataset.id) return;
    const tabs = [...document.querySelectorAll('#client-tabs-scroll .tab-item[data-id]')]
      .filter(t => t.dataset.id !== 'all')
      .map(t => t.dataset.id);
    const from = tabs.indexOf(dragSrcId);
    const to   = tabs.indexOf(tab.dataset.id);
    if (from < 0 || to < 0) return;
    tabs.splice(from, 1);
    tabs.splice(to, 0, dragSrcId);
    TaskManager.reorderClients(tabs);
    renderClientTabs();
    debouncedSave();
  });
}

/* ── Task list ────────────────────────────────────────────────── */
function renderTaskList() {
  const container = document.getElementById('task-list');
  const tasks = TaskManager.filter({
    clientId:  activeClientId,
    priority:  filterPriority,
    status:    'pending',
    assignee:  filterAssignee,
    query:     searchQuery,
  });

  if (tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <p>No pending tasks${searchQuery ? ' matching "' + escHtml(searchQuery) + '"' : ''}</p>
      </div>`;
    return;
  }

  // Sort: urgent first, then medium, then low; newest first within group
  const order = { urgent: 0, medium: 1, low: 2 };
  tasks.sort((a, b) =>
    (order[a.priority] - order[b.priority]) ||
    new Date(b.updatedAt) - new Date(a.updatedAt)
  );

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'task-cards-grid';
  tasks.forEach(t => grid.appendChild(buildTaskCard(t)));
  container.appendChild(grid);
}

/* ── Task card builder ────────────────────────────────────────── */
function buildTaskCard(task) {
  const card = document.createElement('div');
  card.className = `task-card ${task.priority} ${task.status}`;
  card.dataset.id = task.id;
  if (expandedTaskId === task.id) card.classList.add('expanded');

  const assigneeHtml = task.assignee
    ? `<span class="task-assignee">
         <span class="assignee-avatar">${task.assignee[0].toUpperCase()}</span>
         ${escHtml(task.assignee)}
       </span>`
    : '';

  const emailHtml = task.emailCount > 0
    ? `<span class="dot">·</span><span>📧 ${task.emailCount} email${task.emailCount > 1 ? 's' : ''}</span>`
    : '';

  const updatedStr = task.updatedAt ? relativeTime(task.updatedAt) : '';

  card.innerHTML = `
    <div class="task-header">
      <div class="task-checkbox" data-id="${task.id}" title="Mark complete">
        <svg class="check-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="task-info">
        <div class="task-title">${escHtml(task.taskTitle || task.subject || 'Untitled')}</div>
        <div class="task-meta">
          <span class="priority-badge ${task.priority}">${task.priority}</span>
          ${activeClientId === 'all' ? `<span class="dot">·</span><span>${escHtml(task.clientName)}</span>` : ''}
          ${assigneeHtml ? `<span class="dot">·</span>${assigneeHtml}` : ''}
          ${emailHtml}
          ${updatedStr ? `<span class="dot">·</span><span>${updatedStr}</span>` : ''}
        </div>
      </div>
      <svg class="task-chevron" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
      </svg>
    </div>
    <div class="task-detail">
      ${buildTaskDetail(task)}
    </div>`;

  // Expand/collapse on header click
  card.querySelector('.task-header').addEventListener('click', e => {
    if (e.target.closest('.task-checkbox')) return;
    toggleExpand(task.id, card);
  });

  // Complete checkbox
  card.querySelector('.task-checkbox').addEventListener('click', e => {
    e.stopPropagation();
    TaskManager.markComplete(task.id);
    renderAll();
    debouncedSave('✅ Mark task complete');
  });

  // Wire detail controls
  wireDetailControls(card, task);

  return card;
}

function buildTaskDetail(task) {
  const actionablesHtml = task.actionables?.length
    ? `<ul class="actionables-list">${task.actionables.map(a => `<li>${escHtml(a)}</li>`).join('')}</ul>`
    : '<p class="detail-text text-muted">None identified</p>';

  const employees = TaskManager.getEmployees();
  const empOptions = employees.map(e =>
    `<option value="${escHtml(e.name)}" ${task.assignee === e.name ? 'selected' : ''}>${escHtml(e.name)}</option>`
  ).join('');

  return `
    ${task.summary ? `
    <div class="detail-section">
      <div class="detail-label">Summary</div>
      <div class="detail-text">${escHtml(task.summary)}</div>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-label">Action Items</div>
      ${actionablesHtml}
    </div>

    ${task.responsiblePerson ? `
    <div class="detail-section">
      <div class="detail-label">Responsible</div>
      <div class="detail-text">${escHtml(task.responsiblePerson)}</div>
    </div>` : ''}

    <div class="detail-actions">
      <select class="detail-select filter-select" data-action="priority" title="Change priority">
        <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>🔴 Urgent</option>
        <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
        <option value="low"    ${task.priority === 'low'    ? 'selected' : ''}>🟢 Low</option>
      </select>

      <select class="detail-select filter-select" data-action="assignee" title="Assign to">
        <option value="">Assign to…</option>
        ${empOptions}
      </select>

      <button class="btn btn-sm btn-success" data-action="complete">
        ✓ Complete
      </button>

      ${task.emailCount > 0 ? `
      <span class="email-count-badge">
        📧 ${task.emailCount} email${task.emailCount > 1 ? 's' : ''}
      </span>` : ''}
    </div>`;
}

function wireDetailControls(card, task) {
  const detail = card.querySelector('.task-detail');
  if (!detail) return;

  detail.querySelector('[data-action="priority"]')?.addEventListener('change', e => {
    TaskManager.setPriority(task.id, e.target.value);
    card.className = `task-card ${e.target.value} ${task.status}`;
    if (expandedTaskId === task.id) card.classList.add('expanded');
    renderStats();
    debouncedSave('🔄 Update task priority');
  });

  detail.querySelector('[data-action="assignee"]')?.addEventListener('change', e => {
    TaskManager.setAssignee(task.id, e.target.value);
    renderTaskList();
    debouncedSave('👤 Assign task');
  });

  detail.querySelector('[data-action="complete"]')?.addEventListener('click', () => {
    TaskManager.markComplete(task.id);
    expandedTaskId = null;
    renderAll();
    debouncedSave('✅ Mark task complete');
    toast('Task marked complete', 'success');
  });
}

function toggleExpand(taskId, card) {
  if (expandedTaskId === taskId) {
    expandedTaskId = null;
    card.classList.remove('expanded');
  } else {
    document.querySelectorAll('.task-card.expanded').forEach(c => c.classList.remove('expanded'));
    expandedTaskId = taskId;
    card.classList.add('expanded');
  }
}

/* ── Completed section ────────────────────────────────────────── */
function renderCompletedSection() {
  const section = document.getElementById('completed-section');
  const list    = document.getElementById('completed-list');
  const badge   = document.getElementById('completed-count');
  const tasks   = TaskManager.filter({
    clientId: activeClientId, status: 'completed',
    priority: filterPriority, assignee: filterAssignee, query: searchQuery,
  });

  badge.textContent = tasks.length;
  list.innerHTML = '';

  tasks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).forEach(task => {
    const item = document.createElement('div');
    item.className = `task-card completed ${task.priority}`;
    item.innerHTML = `
      <div class="task-header">
        <div class="task-checkbox completed-cb" data-id="${task.id}" title="Reopen task">
          <svg class="check-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="task-info">
          <div class="task-title">${escHtml(task.taskTitle || task.subject || 'Untitled')}</div>
          <div class="task-meta">
            <span class="priority-badge completed">done</span>
            <span class="dot">·</span>
            <span>${escHtml(task.clientName)}</span>
            ${task.assignee ? `<span class="dot">·</span><span>${escHtml(task.assignee)}</span>` : ''}
          </div>
        </div>
      </div>`;

    item.querySelector('.completed-cb').addEventListener('click', () => {
      TaskManager.markPending(task.id);
      renderAll();
      debouncedSave('🔄 Reopen task');
      toast('Task moved back to pending', 'info');
    });

    list.appendChild(item);
  });
}

/* ── Last updated timestamp ───────────────────────────────────── */
function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!el) return;
  const ts = TaskManager.lastUpdated;
  el.textContent = ts ? 'Last synced: ' + relativeTime(ts) : '';
}

/* ═══════════════════════════════════════════════════════════════
   CONTROLS & MODALS
═══════════════════════════════════════════════════════════════ */
function wireControls() {
  /* Search */
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderTaskList();
    renderCompletedSection();
  });

  /* Filters */
  document.getElementById('filter-priority').addEventListener('change', e => {
    filterPriority = e.target.value;
    renderTaskList();
    renderCompletedSection();
  });
  document.getElementById('filter-assignee').addEventListener('change', e => {
    filterAssignee = e.target.value;
    renderTaskList();
    renderCompletedSection();
  });

  /* Completed toggle */
  document.getElementById('completed-toggle').addEventListener('click', () => {
    document.getElementById('completed-section').classList.toggle('open');
  });

  /* Sync button */
  document.getElementById('sync-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sync-btn');
    btn.classList.add('syncing');
    try {
      const ok = await GithubAPI.triggerSync(false);
      if (ok) toast('Sync triggered — check back in ~2 minutes', 'success');
      else    toast('Sync trigger failed (check GitHub Actions is enabled)', 'error');
    } catch (e) {
      toast('Sync error: ' + e.message, 'error');
    }
    // Also refresh data from GitHub
    setTimeout(async () => {
      try {
        await TaskManager.load();
        renderAll();
        toast('Dashboard refreshed', 'info');
      } catch {}
      btn.classList.remove('syncing');
    }, 1500);
  });

  /* Add task */
  document.getElementById('add-task-btn').addEventListener('click', () => openAddTaskModal());

  /* Settings */
  document.getElementById('settings-btn').addEventListener('click', () => openSettingsModal());

  /* Add client tab */
  document.getElementById('tab-add-btn').addEventListener('click', () => {
    const name = prompt('New client / category name:');
    if (!name?.trim()) return;
    TaskManager.addClient(name.trim());
    renderClientTabs();
    debouncedSave('➕ Add client');
  });

  /* Modal close helpers */
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
}

/* ── Add task modal ───────────────────────────────────────────── */
function openAddTaskModal() {
  const modal = document.getElementById('add-task-modal');
  const clientSel = document.getElementById('new-task-client');

  // Populate client dropdown
  clientSel.innerHTML = `<option value="">Select / type new…</option>`;
  TaskManager.getClients().forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    clientSel.appendChild(o);
  });

  // Populate assignee dropdown
  const assigneeSel = document.getElementById('new-task-assignee');
  assigneeSel.innerHTML = `<option value="">Unassigned</option>`;
  TaskManager.getEmployees().forEach(e => {
    const o = document.createElement('option');
    o.value = e.name; o.textContent = e.name;
    assigneeSel.appendChild(o);
  });

  modal.classList.add('open');

  document.getElementById('save-task-btn').onclick = () => {
    const title    = document.getElementById('new-task-title').value.trim();
    const priority = document.getElementById('new-task-priority').value;
    const clientId = clientSel.value;
    const newClient= document.getElementById('new-client-name').value.trim();
    const summary  = document.getElementById('new-task-summary').value.trim();
    const assignee = assigneeSel.value;

    if (!title) { toast('Task title is required', 'error'); return; }

    const fields = { taskTitle: title, priority, summary, assignee };
    if (clientId) {
      const client = TaskManager.getClients().find(c => c.id === clientId);
      fields.clientId = clientId;
      fields.clientName = client?.name;
    } else if (newClient) {
      fields.clientName = newClient;
    }

    TaskManager.addTask(fields);
    modal.classList.remove('open');
    // Reset form
    ['new-task-title','new-task-summary','new-client-name'].forEach(id =>
      document.getElementById(id).value = '');
    renderAll();
    debouncedSave('➕ Add manual task');
    toast('Task added', 'success');
  };
}

/* ── Settings modal ───────────────────────────────────────────── */
function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  renderEmployeeList();
  modal.classList.add('open');

  document.getElementById('add-employee-btn').onclick = () => {
    const name = document.getElementById('new-employee-name').value.trim();
    if (!name) return;
    TaskManager.addEmployee(name);
    document.getElementById('new-employee-name').value = '';
    renderEmployeeList();
    debouncedSave('👤 Add employee');
  };

  document.getElementById('pattern-reset-modal-btn').onclick = () => {
    modal.classList.remove('open');
    if (confirm('Reset your unlock pattern? You will need to set a new one.')) {
      PatternAuth.clearStoredPattern();
      localStorage.removeItem('tracker_setup_done');
      window.location.reload();
    }
  };

  document.getElementById('full-sync-btn').onclick = async () => {
    try {
      await GithubAPI.triggerSync(true);
      toast('Full 30-day sync triggered', 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  };

  document.getElementById('refresh-data-btn').onclick = async () => {
    modal.classList.remove('open');
    document.getElementById('loading-overlay').classList.remove('hidden');
    try {
      await TaskManager.load();
      renderAll();
      toast('Data refreshed from GitHub', 'success');
    } catch (e) { toast('Refresh failed: ' + e.message, 'error'); }
    finally { document.getElementById('loading-overlay').classList.add('hidden'); }
  };
}

function renderEmployeeList() {
  const list = document.getElementById('employee-list');
  const emps = TaskManager.getEmployees();
  if (emps.length === 0) {
    list.innerHTML = '<p class="text-sm text-muted">No employees added yet</p>';
    return;
  }
  list.innerHTML = emps.map(e => `
    <div class="employee-item">
      <span>${escHtml(e.name)}</span>
      <button class="btn-icon" onclick="removeEmp('${e.id}')">🗑</button>
    </div>`).join('');

  // Rebuild filter dropdown
  const sel = document.getElementById('filter-assignee');
  const prev = sel.value;
  sel.innerHTML = `<option value="all">All Staff</option>`;
  emps.forEach(e => {
    const o = document.createElement('option');
    o.value = e.name; o.textContent = e.name;
    sel.appendChild(o);
  });
  sel.value = prev;
}

window.removeEmp = function(id) {
  TaskManager.removeEmployee(id);
  renderEmployeeList();
  debouncedSave('🗑 Remove employee');
};

/* ═══════════════════════════════════════════════════════════════
   AUTO-REFRESH & SAVE
═══════════════════════════════════════════════════════════════ */
let saveTimer = null;

function debouncedSave(message) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await TaskManager.save(message);
      renderLastUpdated();
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
    }
  }, 1500);
}

function startAutoRefresh() {
  // Reload data from GitHub every 10 minutes silently
  autoSyncTimer = setInterval(async () => {
    try {
      await TaskManager.load();
      renderAll();
    } catch {}
  }, 10 * 60 * 1000);
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const setupDone   = localStorage.getItem('tracker_setup_done');
  const hasPattern  = PatternAuth.hasStoredPattern();
  const hasGitHub   = !!localStorage.getItem('tracker_github');

  // Show loading briefly
  showScreen('loading-screen');

  setTimeout(() => {
    if (!setupDone || !hasGitHub) {
      initSetup();
    } else if (!hasPattern) {
      // GitHub configured but no pattern — go straight to set-pattern step
      showScreen('setup-screen');
      document.querySelector('.setup-step').classList.add('hidden');
      const canvas = document.getElementById('setup-pattern-canvas');
      PatternAuth.init(canvas, 'set', () => {
        initAuth(() => initDashboard());
      });
    } else {
      initAuth(() => initDashboard());
    }
  }, 600);
});
