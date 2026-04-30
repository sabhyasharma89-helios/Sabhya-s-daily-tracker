// Main application logic
const App = (() => {
  // ===================== STATE =====================
  let state = {
    tasks: null,
    tasksSHA: null,
    currentClient: 'all',
    activeTaskId: null,
    search: '',
    empFilter: '',
    priFilter: '',
    statusFilter: '',
    statFilter: '',
    refreshTimer: null,
    saving: false,
  };

  const DEFAULT_STRUCTURE = {
    version: 1,
    lastSync: null,
    clients: {},
    employees: [],
    metadata: { lastHistoryId: null, lastSyncTime: null, initialSyncDone: false }
  };

  // ===================== CONFIG =====================
  function cfg() {
    try { return JSON.parse(localStorage.getItem('tt_config') || '{}'); } catch { return {}; }
  }
  function saveCfg(c) { localStorage.setItem('tt_config', JSON.stringify(c)); }

  function repoBase() {
    const c = cfg();
    return {
      owner: c.repoOwner || 'sabhyasharma89-helios',
      repo: c.repoName || 'sabhya-s-daily-tracker',
      branch: c.repoBranch || 'main',
      pat: c.githubPat || '',
    };
  }

  // ===================== DATA LAYER =====================
  async function loadData() {
    const { owner, repo, branch, pat } = repoBase();
    const path = 'data/tasks.json';

    try {
      if (pat) {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
          { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3+json' } }
        );
        if (!res.ok) throw new Error(res.status);
        const json = await res.json();
        state.tasksSHA = json.sha;
        const decoded = decodeURIComponent(escape(atob(json.content.replace(/\s/g, ''))));
        return JSON.parse(decoded);
      } else {
        const res = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?t=${Date.now()}`
        );
        if (!res.ok) throw new Error(res.status);
        return await res.json();
      }
    } catch (e) {
      console.warn('Load failed, using local cache:', e.message);
      const cached = localStorage.getItem('tt_tasks_cache');
      return cached ? JSON.parse(cached) : JSON.parse(JSON.stringify(DEFAULT_STRUCTURE));
    }
  }

  async function saveData(tasks) {
    const { owner, repo, branch, pat } = repoBase();
    if (!pat) {
      localStorage.setItem('tt_tasks_cache', JSON.stringify(tasks));
      toast('Saved locally (no PAT configured)', 'info');
      return false;
    }
    const path = 'data/tasks.json';
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(tasks, null, 2))));
    const body = { message: `Update tasks [${new Date().toISOString()}]`, content, branch };
    if (state.tasksSHA) body.sha = state.tasksSHA;

    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${pat}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );
      if (res.status === 409) {
        toast('Sync conflict — refreshing...', 'info');
        await refresh();
        return false;
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || res.status);
      }
      const result = await res.json();
      state.tasksSHA = result.content.sha;
      localStorage.setItem('tt_tasks_cache', JSON.stringify(tasks));
      return true;
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
      return false;
    }
  }

  // ===================== INIT =====================
  async function init() {
    showLoading('Loading tasks...');
    try {
      state.tasks = await loadData();
      localStorage.setItem('tt_tasks_cache', JSON.stringify(state.tasks));
    } catch (e) {
      state.tasks = JSON.parse(JSON.stringify(DEFAULT_STRUCTURE));
    }
    hideLoading();
    renderAll();
    updateSyncStatus();

    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(refresh, 60000);
  }

  async function refresh() {
    setSyncState('syncing');
    const fresh = await loadData();
    if (fresh) {
      state.tasks = fresh;
      localStorage.setItem('tt_tasks_cache', JSON.stringify(fresh));
      renderAll();
    }
    setSyncState('ok');
    updateSyncStatus();
  }

  async function syncNow() {
    await refresh();
    toast('Refreshed', 'success');
  }

  // ===================== RENDER =====================
  function renderAll() {
    renderStats();
    renderClientTabs();
    renderTasks();
    populateEmployeeDropdowns();
    updateClientDatalist();
  }

  function getVisibleTasks() {
    if (!state.tasks) return [];
    let all = [];
    for (const [cid, client] of Object.entries(state.tasks.clients || {})) {
      for (const task of client.tasks || []) {
        all.push({ ...task, _clientId: cid, _clientName: client.name, _clientColor: client.color });
      }
    }

    if (state.currentClient !== 'all') {
      all = all.filter(t => t._clientId === state.currentClient);
    }
    if (state.search) {
      const q = state.search.toLowerCase();
      all = all.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t._clientName?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.assigneeName?.toLowerCase().includes(q)
      );
    }
    if (state.empFilter) all = all.filter(t => t.assignee === state.empFilter);
    if (state.priFilter) all = all.filter(t => t.priority === state.priFilter);
    if (state.statusFilter) all = all.filter(t => t.status === state.statusFilter);
    if (state.statFilter === 'urgent') all = all.filter(t => t.priority === 'urgent' && t.status !== 'completed');
    if (state.statFilter === 'medium') all = all.filter(t => t.priority === 'medium' && t.status !== 'completed');
    if (state.statFilter === 'low')    all = all.filter(t => t.priority === 'low' && t.status !== 'completed');
    if (state.statFilter === 'pending')   all = all.filter(t => t.status === 'pending');
    if (state.statFilter === 'completed') all = all.filter(t => t.status === 'completed');

    return all;
  }

  function renderStats() {
    const all = [];
    for (const client of Object.values(state.tasks?.clients || {})) {
      for (const t of client.tasks || []) all.push(t);
    }
    const pending = all.filter(t => t.status !== 'completed');
    const completed = all.filter(t => t.status === 'completed');
    set('stat-total', all.length);
    set('stat-pending', pending.length);
    set('stat-completed', completed.length);
    set('stat-urgent', pending.filter(t => t.priority === 'urgent').length);
    set('stat-medium', pending.filter(t => t.priority === 'medium').length);
    set('stat-low', pending.filter(t => t.priority === 'low').length);

    document.querySelectorAll('.stat-card').forEach(el => {
      el.classList.toggle('active', el.dataset.stat === state.statFilter);
    });
  }

  function renderClientTabs() {
    const container = document.getElementById('client-tabs');
    const existing = {};
    container.querySelectorAll('.client-tab[data-client]').forEach(el => {
      if (el.dataset.client !== 'all') existing[el.dataset.client] = true;
    });

    // Remove stale tabs
    container.querySelectorAll('.client-tab:not([data-client="all"])').forEach(el => el.remove());

    const clients = Object.values(state.tasks?.clients || {})
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    clients.forEach(client => {
      const pending = (client.tasks || []).filter(t => t.status !== 'completed').length;
      const tab = document.createElement('div');
      tab.className = 'client-tab' + (state.currentClient === client.id ? ' active' : '');
      tab.dataset.client = client.id;
      tab.innerHTML = `
        <span class="tab-dot" style="width:8px;height:8px;border-radius:50%;background:${client.color || '#4a90e2'};display:inline-block;flex-shrink:0"></span>
        <span>${escHtml(client.name)}</span>
        ${pending > 0 ? `<span class="tab-count">${pending}</span>` : ''}
      `;
      tab.onclick = () => selectClient(client.id);
      container.appendChild(tab);
    });

    container.querySelector('[data-client="all"]').classList.toggle('active', state.currentClient === 'all');
  }

  function renderTasks() {
    const tasks = getVisibleTasks();
    const urgent    = tasks.filter(t => t.priority === 'urgent'  && t.status !== 'completed');
    const medium    = tasks.filter(t => t.priority === 'medium'  && t.status !== 'completed');
    const low       = tasks.filter(t => t.priority === 'low'     && t.status !== 'completed');
    const completed = tasks.filter(t => t.status === 'completed');

    renderList('urgent', urgent);
    renderList('medium', medium);
    renderList('low', low);
    renderList('completed', completed);

    set('count-urgent', urgent.length);
    set('count-medium', medium.length);
    set('count-low', low.length);
    set('count-completed', completed.length);

    const showEmpty = tasks.length === 0;
    document.getElementById('empty-state').classList.toggle('hidden', !showEmpty);
    ['urgent','medium','low'].forEach(p => {
      document.getElementById(`section-${p}`).style.display =
        tasks.filter(t => t.priority === p && t.status !== 'completed').length === 0 &&
        !state.search && !state.statFilter ? 'none' : '';
    });
  }

  function renderList(priority, tasks) {
    const el = document.getElementById(`list-${priority}`);
    el.innerHTML = '';
    tasks.forEach(t => el.appendChild(buildCard(t)));
  }

  function buildCard(task) {
    const div = document.createElement('div');
    div.className = `task-card ${task.status === 'completed' ? 'completed' : task.priority}`;
    div.dataset.taskId = task.id;

    const showClient = state.currentClient === 'all';
    const date = task.createdAt ? relDate(task.createdAt) : '';
    const assignee = task.assigneeName ? `<span class="task-meta">👤 ${escHtml(task.assigneeName)}</span>` : '';
    const clientBadge = showClient ? `<span class="client-badge">${escHtml(task._clientName)}</span>` : '';

    div.innerHTML = `
      <div class="task-card-header">
        <div class="task-cb" onclick="App.toggleComplete(event,'${task.id}','${task._clientId}')">
          ${task.status === 'completed' ? '✓' : ''}
        </div>
        <span class="task-title">${escHtml(task.title)}</span>
        <span class="priority-badge ${task.priority}">${task.priority.toUpperCase()}</span>
      </div>
      <div class="task-card-footer">
        ${clientBadge}
        ${assignee}
        ${date ? `<span class="task-meta">📅 ${date}</span>` : ''}
      </div>
    `;
    div.addEventListener('click', e => {
      if (!e.target.classList.contains('task-cb')) openTaskModal(task.id, task._clientId);
    });
    return div;
  }

  // ===================== TASK MODAL =====================
  function openTaskModal(taskId, clientId) {
    const client = state.tasks.clients[clientId];
    const task = client?.tasks.find(t => t.id === taskId);
    if (!task) return;

    state.activeTaskId = taskId;
    state.activeClientId = clientId;

    // Header
    const badge = document.getElementById('modal-priority-badge');
    badge.textContent = task.priority.toUpperCase();
    badge.className = `priority-badge ${task.priority}`;
    set('modal-task-title', escHtml(task.title));

    // Meta
    document.getElementById('modal-priority').value = task.priority;
    populateSelect('modal-assignee', state.tasks.employees || [], task.assignee);
    const statusEl = document.getElementById('modal-status');
    statusEl.textContent = task.status === 'completed' ? 'Completed' : 'Pending';
    statusEl.className = `status-badge ${task.status}`;
    set('modal-created', task.createdAt ? fmtDate(task.createdAt) : '-');

    // Body
    set('modal-summary', task.emailSummary || 'No email summary available.');
    document.getElementById('modal-summary').style.whiteSpace = 'pre-wrap';

    const actionList = document.getElementById('modal-actionables');
    const section = document.getElementById('modal-actionables-section');
    if (task.actionables?.length) {
      actionList.innerHTML = task.actionables.map(a => `<li>${escHtml(a)}</li>`).join('');
      section.style.display = '';
    } else {
      section.style.display = 'none';
    }

    set('modal-responsible', task.nextStepsPerson || 'Not specified');
    set('modal-description', task.description || '-');
    document.getElementById('modal-notes').value = task.notes || '';

    const completeBtn = document.getElementById('modal-complete-btn');
    completeBtn.textContent = task.status === 'completed' ? '↩ Mark Pending' : '✓ Mark Complete';
    completeBtn.className = task.status === 'completed' ? 'btn-secondary' : 'btn-success';

    document.getElementById('task-modal').classList.add('active');
  }

  function closeTaskModal() {
    document.getElementById('task-modal').classList.remove('active');
    state.activeTaskId = null;
    state.activeClientId = null;
  }

  async function saveTaskChanges() {
    const { activeTaskId: tid, activeClientId: cid } = state;
    if (!tid || !cid) return;
    const task = state.tasks.clients[cid]?.tasks.find(t => t.id === tid);
    if (!task) return;

    const newPri = document.getElementById('modal-priority').value;
    const newAssignee = document.getElementById('modal-assignee').value;
    const newNotes = document.getElementById('modal-notes').value;

    task.priority = newPri;
    task.priorityManuallySet = true;
    task.assignee = newAssignee || null;
    task.assigneeName = newAssignee
      ? (state.tasks.employees || []).find(e => e.id === newAssignee)?.name || null
      : null;
    task.notes = newNotes;
    task.updatedAt = new Date().toISOString();

    showLoading('Saving...');
    await saveData(state.tasks);
    hideLoading();
    closeTaskModal();
    renderAll();
    toast('Task saved', 'success');
  }

  async function toggleTaskComplete() {
    const { activeTaskId: tid, activeClientId: cid } = state;
    if (!tid || !cid) return;
    const task = state.tasks.clients[cid]?.tasks.find(t => t.id === tid);
    if (!task) return;
    task.status = task.status === 'completed' ? 'pending' : 'completed';
    task.completedAt = task.status === 'completed' ? new Date().toISOString() : null;
    task.updatedAt = new Date().toISOString();

    showLoading('Saving...');
    await saveData(state.tasks);
    hideLoading();
    closeTaskModal();
    renderAll();
    toast(task.status === 'completed' ? 'Marked complete' : 'Marked pending', 'success');
  }

  async function toggleComplete(event, taskId, clientId) {
    event.stopPropagation();
    const task = state.tasks.clients[clientId]?.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = task.status === 'completed' ? 'pending' : 'completed';
    task.completedAt = task.status === 'completed' ? new Date().toISOString() : null;
    task.updatedAt = new Date().toISOString();
    renderAll();
    await saveData(state.tasks);
  }

  async function deleteTask() {
    const { activeTaskId: tid, activeClientId: cid } = state;
    if (!tid || !cid || !confirm('Delete this task?')) return;
    const client = state.tasks.clients[cid];
    if (!client) return;
    client.tasks = client.tasks.filter(t => t.id !== tid);

    showLoading('Deleting...');
    await saveData(state.tasks);
    hideLoading();
    closeTaskModal();
    renderAll();
    toast('Task deleted', 'success');
  }

  // ===================== ADD TASK =====================
  function openAddTask() {
    populateSelect('new-assignee', state.tasks?.employees || []);
    if (state.currentClient !== 'all') {
      document.getElementById('new-client').value =
        state.tasks?.clients[state.currentClient]?.name || '';
    } else {
      document.getElementById('new-client').value = '';
    }
    document.getElementById('new-title').value = '';
    document.getElementById('new-description').value = '';
    document.getElementById('new-priority').value = 'medium';
    document.getElementById('add-task-modal').classList.add('active');
  }

  function closeAddTask() {
    document.getElementById('add-task-modal').classList.remove('active');
  }

  async function saveNewTask() {
    const clientName = document.getElementById('new-client').value.trim();
    const title = document.getElementById('new-title').value.trim();
    if (!clientName || !title) { toast('Client name and title are required', 'error'); return; }

    const priority = document.getElementById('new-priority').value;
    const assigneeId = document.getElementById('new-assignee').value;
    const description = document.getElementById('new-description').value.trim();
    const assignee = (state.tasks?.employees || []).find(e => e.id === assigneeId);

    const { clientId, client } = getOrCreateClient(clientName);

    const task = {
      id: 'task-' + uid(),
      clientId,
      title,
      description,
      priority,
      status: 'pending',
      assignee: assigneeId || null,
      assigneeName: assignee?.name || null,
      emailThreadIds: [],
      emailSummary: '',
      actionables: [],
      nextStepsPerson: '',
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      source: 'manual',
      userCreated: true,
      priorityManuallySet: true,
    };

    client.tasks.push(task);
    showLoading('Saving...');
    await saveData(state.tasks);
    hideLoading();
    closeAddTask();
    renderAll();
    toast('Task added', 'success');
  }

  // ===================== CLIENT MANAGEMENT =====================
  function getOrCreateClient(name) {
    const norm = name.toLowerCase().trim();
    for (const [id, c] of Object.entries(state.tasks.clients)) {
      if (c.name.toLowerCase() === norm) return { clientId: id, client: c };
    }
    const colors = ['#4a90e2','#e24a6b','#4ae29a','#e2a84a','#9a4ae2','#4ae2e2','#e24ae2','#a8e24a'];
    const cid = 'client-' + uid();
    const client = {
      id: cid, name: name.trim(),
      color: colors[Object.keys(state.tasks.clients).length % colors.length],
      order: Object.keys(state.tasks.clients).length,
      tasks: [],
    };
    state.tasks.clients[cid] = client;
    return { clientId: cid, client };
  }

  function selectClient(id) {
    state.currentClient = id;
    state.statFilter = '';
    document.querySelectorAll('.client-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.client === id);
    });
    renderTasks();
    renderStats();
  }

  async function addClient() {
    const name = prompt('Enter client name:');
    if (!name?.trim()) return;
    getOrCreateClient(name.trim());
    await saveData(state.tasks);
    renderAll();
  }

  // ===================== FILTERS =====================
  function onSearch(val) {
    state.search = val;
    document.getElementById('search-clear').classList.toggle('hidden', !val);
    renderTasks();
  }

  function clearSearch() {
    document.getElementById('search-input').value = '';
    onSearch('');
  }

  function onFilter() {
    state.empFilter = document.getElementById('employee-filter').value;
    state.priFilter = document.getElementById('priority-filter').value;
    state.statusFilter = document.getElementById('status-filter').value;
    renderTasks();
  }

  function filterByStat(stat) {
    state.statFilter = state.statFilter === stat ? '' : stat;
    state.empFilter = '';
    state.priFilter = '';
    state.statusFilter = '';
    document.getElementById('employee-filter').value = '';
    document.getElementById('priority-filter').value = '';
    document.getElementById('status-filter').value = '';
    renderStats();
    renderTasks();
  }

  function toggleCompleted() {
    document.getElementById('section-completed').classList.toggle('collapsed');
    const icon = document.getElementById('completed-collapse-icon');
    if (icon) icon.style.transform =
      document.getElementById('section-completed').classList.contains('collapsed') ? '' : 'rotate(90deg)';
  }

  // ===================== SETTINGS =====================
  function openSettings() {
    const c = cfg();
    document.getElementById('s-pat').value = c.githubPat || '';
    document.getElementById('s-owner').value = c.repoOwner || 'sabhyasharma89-helios';
    document.getElementById('s-repo').value = c.repoName || 'sabhya-s-daily-tracker';
    document.getElementById('s-branch').value = c.repoBranch || 'main';
    renderEmployeeList();
    document.getElementById('settings-modal').classList.add('active');
  }

  function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
  }

  async function saveSettings() {
    const c = {
      githubPat: document.getElementById('s-pat').value.trim(),
      repoOwner: document.getElementById('s-owner').value.trim(),
      repoName: document.getElementById('s-repo').value.trim(),
      repoBranch: document.getElementById('s-branch').value.trim() || 'main',
    };
    saveCfg(c);
    closeSettings();
    toast('Settings saved', 'success');
    await refresh();
  }

  async function addEmployee() {
    const name = document.getElementById('new-emp-name').value.trim();
    const email = document.getElementById('new-emp-email').value.trim();
    if (!name) { toast('Employee name required', 'error'); return; }
    if (!state.tasks.employees) state.tasks.employees = [];
    if (state.tasks.employees.find(e => e.name.toLowerCase() === name.toLowerCase())) {
      toast('Employee already exists', 'error'); return;
    }
    state.tasks.employees.push({ id: 'emp-' + uid(), name, email });
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-email').value = '';
    await saveData(state.tasks);
    renderEmployeeList();
    populateEmployeeDropdowns();
    toast('Team member added', 'success');
  }

  function renderEmployeeList() {
    const el = document.getElementById('employees-list');
    const employees = state.tasks?.employees || [];
    el.innerHTML = employees.length
      ? employees.map(e => `
          <div class="employee-item">
            <div class="employee-info">
              <span class="employee-name">${escHtml(e.name)}</span>
              ${e.email ? `<span class="employee-email">${escHtml(e.email)}</span>` : ''}
            </div>
            <button class="btn-danger" style="padding:4px 8px;font-size:11px"
              onclick="App.removeEmployee('${e.id}')">✕</button>
          </div>
        `).join('')
      : '<p style="color:var(--text3);font-size:13px">No team members yet</p>';
  }

  async function removeEmployee(empId) {
    if (!confirm('Remove this team member?')) return;
    state.tasks.employees = (state.tasks.employees || []).filter(e => e.id !== empId);
    await saveData(state.tasks);
    renderEmployeeList();
    populateEmployeeDropdowns();
    toast('Team member removed', 'success');
  }

  function changePattern() {
    closeSettings();
    AuthManager.clearPattern();
    localStorage.removeItem('tt_setup_done');
    showScreen('setup');
    SetupManager.init();
  }

  async function forceRefresh() {
    closeSettings();
    state.tasksSHA = null;
    await refresh();
    toast('Data refreshed', 'success');
  }

  // ===================== HELPERS =====================
  function populateEmployeeDropdowns() {
    const employees = state.tasks?.employees || [];
    ['employee-filter', 'modal-assignee', 'new-assignee'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const cur = el.value;
      const firstOpt = id === 'employee-filter' ? '<option value="">All Employees</option>' : '<option value="">Unassigned</option>';
      el.innerHTML = firstOpt + employees.map(e =>
        `<option value="${e.id}" ${cur === e.id ? 'selected' : ''}>${escHtml(e.name)}</option>`
      ).join('');
    });
  }

  function populateSelect(id, employees, selected) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Unassigned</option>' +
      employees.map(e => `<option value="${e.id}" ${selected === e.id ? 'selected' : ''}>${escHtml(e.name)}</option>`).join('');
  }

  function updateClientDatalist() {
    const dl = document.getElementById('client-datalist');
    if (!dl) return;
    dl.innerHTML = Object.values(state.tasks?.clients || {})
      .map(c => `<option value="${escHtml(c.name)}">`).join('');
  }

  function updateSyncStatus() {
    const syncTime = state.tasks?.metadata?.lastSyncTime;
    const text = syncTime ? 'Synced ' + relDate(syncTime) : 'Never synced';
    set('last-sync-text', text);
  }

  function setSyncState(s) {
    const dot = document.getElementById('sync-dot');
    if (!dot) return;
    dot.className = 'sync-dot' + (s === 'syncing' ? ' syncing' : s === 'error' ? ' error' : '');
  }

  function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function relDate(iso) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return fmtDate(iso);
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function showLoading(msg) {
    document.getElementById('loading-text').textContent = msg || 'Loading...';
    document.getElementById('loading-overlay').classList.remove('hidden');
  }

  function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
  }

  function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    el.innerHTML = `<span>${icon}</span><span>${escHtml(msg)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'slideIn .3s ease reverse';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function lock() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    showScreen('auth');
    AuthManager.init('pattern-canvas', async (p) => {
      const ok = await AuthManager.verifyPattern(p);
      if (ok) {
        AuthManager.showSuccess('pattern-canvas');
        setTimeout(() => { showScreen('dashboard'); init(); }, 400);
      } else {
        AuthManager.showError('Wrong pattern — try again');
      }
    });
  }

  return {
    init, syncNow, refresh, lock,
    selectClient, addClient,
    openAddTask, closeAddTask, saveNewTask,
    openTaskModal, closeTaskModal, saveTaskChanges,
    toggleTaskComplete, toggleComplete, deleteTask,
    onSearch, clearSearch, onFilter, filterByStat, toggleCompleted,
    openSettings, closeSettings, saveSettings, addEmployee, removeEmployee,
    changePattern, forceRefresh,
    toast,
  };
})();
