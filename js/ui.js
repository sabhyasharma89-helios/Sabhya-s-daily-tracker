/* ═══════════════════════════════════════════════════════════════
   ui.js — All rendering, filtering, modal management
   ═══════════════════════════════════════════════════════════════ */

const UI = (() => {
  let currentFilter   = 'all';
  let currentEmployee = '';
  let currentClient   = '';
  let searchQuery     = '';
  let detailTaskId    = null;
  let completedOpen   = false;

  const AVATAR_COLORS = 8; // matches .avatar-0 … .avatar-7

  // ─── Avatar helper ──────────────────────────────────────────────
  function avatarClass(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return `avatar-${h % AVATAR_COLORS}`;
  }

  function initials(name) {
    return name.split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  }

  // ─── Priority rendering ──────────────────────────────────────────
  function priorityBadge(priority) {
    const labels = { urgent:'🔴 Urgent', medium:'🟡 Medium', low:'🟢 Low' };
    return `<span class="priority-badge ${priority}">${labels[priority] || priority}</span>`;
  }

  // ─── Stats bar ───────────────────────────────────────────────────
  async function refreshStats() {
    const tasks    = await DB.getTasks();
    const total    = tasks.length;
    const pending  = tasks.filter(t => t.status === 'pending').length;
    const comp     = tasks.filter(t => t.status === 'completed').length;
    const urgent   = tasks.filter(t => t.status === 'pending' && t.priority === 'urgent').length;
    const medium   = tasks.filter(t => t.status === 'pending' && t.priority === 'medium').length;
    const low      = tasks.filter(t => t.status === 'pending' && t.priority === 'low').length;

    document.getElementById('stat-total').textContent     = total;
    document.getElementById('stat-pending').textContent   = pending;
    document.getElementById('stat-completed').textContent = comp;
    document.getElementById('stat-urgent').textContent    = urgent;
    document.getElementById('stat-medium').textContent    = medium;
    document.getElementById('stat-low').textContent       = low;
  }

  // ─── Filter/select dropdowns ─────────────────────────────────────
  async function refreshDropdowns() {
    const tasks     = await DB.getTasks();
    const ud        = await DB.getUserData();
    const employees = ud.employees || [];

    // Employee filter
    const efEl = document.getElementById('employee-filter');
    if (efEl) {
      const cur = efEl.value;
      efEl.innerHTML = '<option value="">All Assignees</option>' +
        employees.map(e => `<option value="${e.name}" ${e.name===cur?'selected':''}>${e.name}</option>`).join('');
    }

    // Client filter
    const cfEl = document.getElementById('client-filter');
    const clients = [...new Set(tasks.map(t => t.clientName).filter(Boolean))].sort();
    if (cfEl) {
      const cur = cfEl.value;
      cfEl.innerHTML = '<option value="">All Clients</option>' +
        clients.map(c => `<option value="${c}" ${c===cur?'selected':''}>${c}</option>`).join('');
    }

    // Task modal dropdowns
    const ta = document.getElementById('task-assignee-input');
    if (ta) {
      ta.innerHTML = '<option value="">— Unassigned —</option>' +
        employees.map(e => `<option value="${e.name}">${e.name}</option>`).join('');
    }

    // Client datalist
    const dl = document.getElementById('client-datalist');
    if (dl) dl.innerHTML = clients.map(c => `<option value="${c}">`).join('');
  }

  // ─── Filtering logic ─────────────────────────────────────────────
  function passesFilter(task) {
    if (currentFilter === 'completed' && task.status !== 'completed') return false;
    if (currentFilter === 'pending'   && task.status !== 'pending')   return false;
    if (currentFilter === 'urgent'    && (task.priority !== 'urgent'  || task.status === 'completed')) return false;
    if (currentFilter === 'medium'    && (task.priority !== 'medium'  || task.status === 'completed')) return false;
    if (currentFilter === 'low'       && (task.priority !== 'low'     || task.status === 'completed')) return false;

    if (currentEmployee && task.assignedTo !== currentEmployee) return false;
    if (currentClient   && task.clientName !== currentClient)   return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const searchable = [task.title, task.clientName, task.summary, task.assignedTo, ...(task.actionables||[])].join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  }

  // ─── Task card HTML ──────────────────────────────────────────────
  function taskCardHtml(task) {
    const checked   = task.status === 'completed';
    const checkCls  = checked ? 'checked' : '';
    const cardCls   = `task-card ${task.priority} ${checked ? 'completed' : ''}`;
    const assignee  = task.assignedTo ? `👤 ${task.assignedTo}` : '';
    const emailInd  = task.emailThreadId ? '📧' : '';
    return `
<div class="${cardCls}" data-id="${task.id}" onclick="App.ui.openDetail('${task.id}')">
  <div class="task-card-top">
    <div class="task-checkbox ${checkCls}" onclick="App.tasks.toggleComplete(event,'${task.id}')"></div>
    <span class="task-title">${escHtml(task.title)}</span>
    <div class="task-badges">${priorityBadge(task.priority)}</div>
  </div>
  <div class="task-card-bottom">
    <span class="task-assignee">${escHtml(assignee)}</span>
    <span class="task-email-indicator">${emailInd}</span>
    <span class="task-date">${fmtDate(task.updatedAt || task.createdAt)}</span>
  </div>
</div>`;
  }

  // ─── Render clients + tasks ──────────────────────────────────────
  async function renderClients() {
    const allTasks  = await DB.getTasks();
    const ud        = await DB.getUserData();
    const collapsed = ud.collapsedClients || [];
    const order     = ud.clientOrder      || [];

    // Separate pending and completed
    const pendingTasks   = allTasks.filter(t => t.status === 'pending'   && passesFilter(t));
    const completedTasks = allTasks.filter(t => t.status === 'completed' && passesFilter(t));

    // Group pending by client
    const clientMap = {};
    for (const t of pendingTasks) {
      const key = t.clientName || 'Unknown';
      if (!clientMap[key]) clientMap[key] = [];
      clientMap[key].push(t);
    }

    // Sort clients by order, then alphabetically
    let clientNames = Object.keys(clientMap);
    clientNames.sort((a, b) => {
      const oa = order.indexOf(a), ob = order.indexOf(b);
      if (oa !== -1 && ob !== -1) return oa - ob;
      if (oa !== -1) return -1;
      if (ob !== -1) return 1;
      return a.localeCompare(b);
    });

    const container = document.getElementById('client-container');
    if (!container) return;

    if (clientNames.length === 0 && completedTasks.length === 0 && allTasks.length === 0) {
      document.getElementById('no-tasks-msg').style.display = 'block';
      container.innerHTML = '';
    } else {
      document.getElementById('no-tasks-msg').style.display = 'none';

      container.innerHTML = clientNames.map(clientName => {
        const tasks    = clientMap[clientName];
        const isCollapsed = collapsed.includes(clientName);

        // Sort by priority: urgent > medium > low
        const prioOrder = { urgent:0, medium:1, low:2 };
        tasks.sort((a,b) => (prioOrder[a.priority]||3) - (prioOrder[b.priority]||3));

        const urgentCount  = tasks.filter(t => t.priority==='urgent').length;
        const mediumCount  = tasks.filter(t => t.priority==='medium').length;
        const lowCount     = tasks.filter(t => t.priority==='low').length;

        const avCls = avatarClass(clientName);
        return `
<div class="client-section ${isCollapsed ? 'collapsed' : ''}" data-client="${escHtml(clientName)}">
  <div class="client-header" onclick="App.ui.toggleClient('${escHtml(clientName).replace(/'/g,"\\'")}')">
    <div class="client-avatar ${avCls}">${initials(clientName)}</div>
    <span class="client-name">${escHtml(clientName)}
      <span style="font-weight:400;color:var(--text-muted);font-size:.82rem;">(${tasks.length})</span>
    </span>
    <div class="client-counts">
      ${urgentCount ? `<span class="badge badge-urgent">🔴 ${urgentCount}</span>` : ''}
      ${mediumCount ? `<span class="badge badge-medium">🟡 ${mediumCount}</span>` : ''}
      ${lowCount    ? `<span class="badge badge-low">🟢 ${lowCount}</span>`    : ''}
    </div>
    <span class="client-chevron">▼</span>
  </div>
  <div class="client-task-list">
    ${tasks.map(taskCardHtml).join('')}
    <button class="btn btn-secondary btn-sm" style="margin-top:4px;align-self:flex-start;" onclick="App.ui.openAddTaskForClient('${escHtml(clientName).replace(/'/g,"\\'")}')">+ Add Task</button>
  </div>
</div>`;
      }).join('');
    }

    // Render completed section
    const compSection = document.getElementById('completed-section');
    const compList    = document.getElementById('completed-list');
    const compBadge   = document.getElementById('completed-count-badge');
    const compChevron = document.getElementById('completed-chevron');

    if (completedTasks.length > 0) {
      compSection.style.display = 'block';
      if (compBadge) compBadge.textContent = completedTasks.length;
      if (compChevron) compChevron.textContent = completedOpen ? '▼' : '▶';
      if (compList) {
        compList.className = `completed-list ${completedOpen ? '' : 'collapsed'}`;
        compList.innerHTML = completedTasks.map(taskCardHtml).join('');
      }
    } else {
      if (compSection) compSection.style.display = 'none';
    }
  }

  // ─── Refresh all ─────────────────────────────────────────────────
  async function refreshAll() {
    await refreshStats();
    await refreshDropdowns();
    await renderClients();
  }

  // ─── Filter handlers ─────────────────────────────────────────────
  function setFilter(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderClients();
  }

  function setEmployeeFilter(val) { currentEmployee = val; renderClients(); }
  function setClientFilter(val)   { currentClient   = val; renderClients(); }
  function onSearch(val)          { searchQuery = val.trim(); renderClients(); }

  // ─── Toggle client collapse ──────────────────────────────────────
  async function toggleClient(name) {
    const ud = await DB.getUserData();
    const collapsed = ud.collapsedClients || [];
    const idx = collapsed.indexOf(name);
    if (idx === -1) collapsed.push(name);
    else            collapsed.splice(idx, 1);
    await DB.patchUserData({ collapsedClients: collapsed });
    renderClients();
  }

  // ─── Toggle completed section ────────────────────────────────────
  function toggleCompleted() {
    completedOpen = !completedOpen;
    renderClients();
  }

  // ─── Sidebar toggle ──────────────────────────────────────────────
  function toggleSidebar() { /* reserved for future side-panel */ }

  // ─── Add Task modal ──────────────────────────────────────────────
  function openAddTask() {
    document.getElementById('task-modal-id').value    = '';
    document.getElementById('task-modal-title').textContent = 'Add Task';
    document.getElementById('task-title-input').value = '';
    document.getElementById('task-client-input').value = '';
    document.getElementById('task-priority-input').value = 'medium';
    document.getElementById('task-summary-input').value = '';
    document.getElementById('task-actionables-input').value = '';
    document.getElementById('task-nextstep-input').value = '';
    refreshDropdowns().then(() => {
      document.getElementById('task-assignee-input').value = '';
    });
    document.getElementById('task-modal').style.display = 'flex';
  }

  function openAddTaskForClient(clientName) {
    openAddTask();
    document.getElementById('task-client-input').value = clientName;
  }

  function openEditTask(task) {
    document.getElementById('task-modal-id').value    = task.id;
    document.getElementById('task-modal-title').textContent = 'Edit Task';
    document.getElementById('task-title-input').value = task.title || '';
    document.getElementById('task-client-input').value = task.clientName || '';
    document.getElementById('task-priority-input').value = task.priority || 'medium';
    document.getElementById('task-summary-input').value = task.summary || '';
    document.getElementById('task-actionables-input').value = (task.actionables||[]).join('\n');
    document.getElementById('task-nextstep-input').value = task.nextStepPerson || '';
    refreshDropdowns().then(() => {
      document.getElementById('task-assignee-input').value = task.assignedTo || '';
    });
    document.getElementById('task-modal').style.display = 'flex';
  }

  function closeTaskModal() { document.getElementById('task-modal').style.display = 'none'; }

  // ─── Detail modal ────────────────────────────────────────────────
  async function openDetail(id) {
    const task = await DB.getTask(id);
    if (!task) return;
    detailTaskId = id;

    document.getElementById('detail-title').textContent   = task.title;
    document.getElementById('detail-summary').textContent = task.summary || '—';
    document.getElementById('detail-nextstep').textContent = task.nextStepPerson || '—';
    document.getElementById('detail-client').textContent   = task.clientName  || '';
    document.getElementById('detail-date').textContent     = fmtDateTime(task.updatedAt || task.createdAt);

    const assigneeEl = document.getElementById('detail-assignee');
    assigneeEl.textContent = task.assignedTo ? `👤 ${task.assignedTo}` : '';
    assigneeEl.style.display = task.assignedTo ? 'inline' : 'none';

    const priorityBadgeEl = document.getElementById('detail-priority-badge');
    priorityBadgeEl.className = `priority-badge ${task.priority}`;
    priorityBadgeEl.textContent = { urgent:'🔴 Urgent', medium:'🟡 Medium', low:'🟢 Low' }[task.priority] || task.priority;

    // Actionables
    const actSection = document.getElementById('detail-actionables-section');
    const actList    = document.getElementById('detail-actionables');
    if (task.actionables && task.actionables.length) {
      actSection.style.display = 'block';
      actList.innerHTML = task.actionables.map(a => `<li>${escHtml(a)}</li>`).join('');
    } else {
      actSection.style.display = 'none';
    }

    // Email thread
    const threadSection = document.getElementById('detail-thread-section');
    const threadList    = document.getElementById('detail-thread-list');
    if (task.conversationHistory && task.conversationHistory.length) {
      threadSection.style.display = 'block';
      threadList.innerHTML = task.conversationHistory.map(m => `
<div class="email-thread-item">
  <div class="email-from">${escHtml(m.from || '')}</div>
  <div class="email-date">${fmtDateTime(m.date)}</div>
  <div class="email-snippet">${escHtml(m.snippet || m.subject || '')}</div>
</div>`).join('');
    } else {
      threadSection.style.display = 'none';
    }

    // Complete button
    const compBtn = document.getElementById('detail-complete-btn');
    if (task.status === 'completed') {
      compBtn.textContent = '↩ Mark Pending';
      compBtn.className   = 'btn btn-sm btn-secondary';
    } else {
      compBtn.textContent = '✅ Mark Complete';
      compBtn.className   = 'btn btn-sm btn-primary';
    }

    // Priority and assignee selects
    document.getElementById('detail-priority-select').value = task.priority || 'medium';
    const ud = await DB.getUserData();
    const employees = ud.employees || [];
    const assignSel = document.getElementById('detail-assignee-select');
    assignSel.innerHTML = '<option value="">— Unassigned —</option>' +
      employees.map(e => `<option value="${e.name}" ${e.name===task.assignedTo?'selected':''}>${e.name}</option>`).join('');

    document.getElementById('detail-modal').style.display = 'flex';
  }

  function closeDetailModal() {
    document.getElementById('detail-modal').style.display = 'none';
    detailTaskId = null;
  }

  function getCurrentDetailId() { return detailTaskId; }

  // ─── Settings modal ──────────────────────────────────────────────
  async function openSettings() {
    const cfg = await DB.getConfig();
    document.getElementById('set-gh-owner').value  = cfg.ghOwner  || '';
    document.getElementById('set-gh-repo').value   = cfg.ghRepo   || '';
    document.getElementById('set-gh-branch').value = cfg.ghBranch || 'main';
    document.getElementById('set-gh-token').value  = '';

    const ud = await DB.getUserData();
    renderEmployeeList(ud.employees || [], 'employee-list-settings', 'App.employees.removeFromSettings');

    const lastSync   = ud.lastSyncAt ? fmtDateTime(ud.lastSyncAt) : 'Never';
    const emailCount = cfg.totalEmailsProcessed || 0;
    document.getElementById('settings-last-sync').textContent  = `Last sync: ${lastSync}`;
    document.getElementById('settings-email-count').textContent = `Emails processed: ${emailCount}`;

    document.getElementById('settings-modal').style.display = 'flex';
  }

  function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }

  // ─── Employee list rendering ─────────────────────────────────────
  function renderEmployeeList(employees, containerId, removeFn) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!employees.length) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;">No team members yet.</p>';
      return;
    }
    el.innerHTML = employees.map((e,i) => `
<div class="employee-item">
  <span class="employee-name">${escHtml(e.name)}</span>
  <span class="employee-email">${escHtml(e.email||'')}</span>
  <span class="employee-remove" onclick="${removeFn}(${i})" title="Remove">✕</span>
</div>`).join('');
  }

  // ─── Toast ───────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent  = msg;
    el.className    = `toast ${type||''}`;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  // ─── Wizard helpers ──────────────────────────────────────────────
  function renderSetupEmployeeList(employees) {
    renderEmployeeList(employees, 'employee-list-setup', 'App.wizard.removeEmployee');
  }

  // ─── Escape HTML ─────────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  return {
    refreshAll, refreshStats, refreshDropdowns, renderClients,
    setFilter, setEmployeeFilter, setClientFilter, onSearch,
    toggleClient, toggleCompleted, toggleSidebar,
    openAddTask, openAddTaskForClient, openEditTask, closeTaskModal,
    openDetail, closeDetailModal, getCurrentDetailId,
    openSettings, closeSettings,
    renderEmployeeList, renderSetupEmployeeList,
    toast, escHtml, fmtDate, fmtDateTime
  };
})();
