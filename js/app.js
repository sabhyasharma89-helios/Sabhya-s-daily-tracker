/* Task Tracker — Main Application */

const App = (() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let state = {
    tasks: [],
    clients: [],
    employees: [],
    settings: {},
    filter: { client: 'all', status: 'pending', priority: 'all', assignee: 'all', search: '' },
    activeModal: null,
    lastSync: null,
    metadata: {},
  };

  const LOCAL_KEY = 'sdt_local_data';
  const UPDATES_KEY = 'sdt_pending_updates';

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadData() {
    showLoading(true);
    try {
      // Try GitHub first, fall back to localStorage cache
      let remote = null;
      try {
        if (GitHubAPI.isConfigured()) {
          remote = await GitHubAPI.fetchTasksJson();
        } else {
          // Try direct relative path (works when hosted on GitHub Pages)
          const res = await fetch(`./data/tasks.json?t=${Date.now()}`);
          if (res.ok) remote = await res.json();
        }
      } catch {}

      const local = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');

      if (remote) {
        // Merge: remote is source of truth, but apply local-only overrides
        const merged = mergeWithLocalOverrides(remote);
        state.tasks = merged.tasks || [];
        state.clients = merged.clients || [];
        state.employees = merged.employees || [];
        state.settings = merged.settings || {};
        state.metadata = merged.metadata || {};
        localStorage.setItem(LOCAL_KEY, JSON.stringify(merged));
      } else if (local) {
        state.tasks = local.tasks || [];
        state.clients = local.clients || [];
        state.employees = local.employees || [];
        state.settings = local.settings || {};
        state.metadata = local.metadata || {};
      }

      state.lastSync = new Date();
    } catch (e) {
      console.error('Load error:', e);
    }
    showLoading(false);
    render();
  }

  function mergeWithLocalOverrides(remote) {
    // Apply any pending local updates that haven't been synced yet
    const pending = JSON.parse(localStorage.getItem(UPDATES_KEY) || '{"updates":[]}');
    if (!pending.updates || !pending.updates.length) return remote;

    const taskMap = {};
    (remote.tasks || []).forEach(t => { taskMap[t.id] = { ...t }; });

    pending.updates.forEach(upd => {
      if (taskMap[upd.id]) {
        Object.assign(taskMap[upd.id], upd);
      }
    });

    return { ...remote, tasks: Object.values(taskMap) };
  }

  async function persistUserUpdate(update) {
    // Save locally
    const pending = JSON.parse(localStorage.getItem(UPDATES_KEY) || '{"updates":[],"new_tasks":[],"employees":null,"settings":{}}');

    if (update.type === 'task_update') {
      const existing = pending.updates.findIndex(u => u.id === update.id);
      if (existing >= 0) Object.assign(pending.updates[existing], update);
      else pending.updates.push(update);
    } else if (update.type === 'new_task') {
      pending.new_tasks = pending.new_tasks || [];
      pending.new_tasks.push(update.task);
    } else if (update.type === 'employees') {
      pending.employees = update.employees;
    } else if (update.type === 'settings') {
      Object.assign(pending.settings, update.settings);
    }

    localStorage.setItem(UPDATES_KEY, JSON.stringify(pending));
    localStorage.setItem(LOCAL_KEY, JSON.stringify({
      metadata: state.metadata, tasks: state.tasks,
      clients: state.clients, employees: state.employees, settings: state.settings
    }));

    // Push to GitHub asynchronously
    GitHubAPI.pushUserUpdates(pending).then(ok => {
      if (ok) {
        localStorage.removeItem(UPDATES_KEY);
        updateSyncBadge(true);
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render() {
    renderStats();
    renderClientTabs();
    renderTaskList();
    renderEmployeeOptions();
    updateSyncTime();
  }

  function renderStats() {
    const tasks = state.tasks;
    const pending = tasks.filter(t => t.status === 'pending');
    const completed = tasks.filter(t => t.status === 'completed');
    const urgent = pending.filter(t => t.priority === 'urgent');
    const medium = pending.filter(t => t.priority === 'medium');
    const low = pending.filter(t => t.priority === 'low');

    setEl('stat-total', tasks.length);
    setEl('stat-pending', pending.length);
    setEl('stat-completed', completed.length);
    setEl('stat-urgent', urgent.length);
    setEl('stat-medium', medium.length);
    setEl('stat-low', low.length);
  }

  function renderClientTabs() {
    const container = document.getElementById('client-tabs');
    if (!container) return;

    // Build unique client list from tasks + clients array
    const clientSet = new Set(state.tasks.map(t => t.client_name).filter(Boolean));
    state.clients.forEach(c => clientSet.add(c.name));

    const sorted = [...clientSet].sort((a, b) => {
      const oa = (state.clients.find(c => c.name === a) || {}).order ?? 999;
      const ob = (state.clients.find(c => c.name === b) || {}).order ?? 999;
      return oa - ob;
    });

    container.innerHTML = `
      <button class="tab-btn ${state.filter.client === 'all' ? 'active' : ''}" data-client="all">All</button>
      ${sorted.map(name => {
        const info = state.clients.find(c => c.name === name) || {};
        const count = state.tasks.filter(t => t.client_name === name && t.status === 'pending').length;
        return `<button class="tab-btn ${state.filter.client === name ? 'active' : ''}"
          data-client="${escHtml(name)}"
          style="--client-color:${info.color || '#6366f1'}">
          ${escHtml(name)}
          ${count > 0 ? `<span class="tab-badge">${count}</span>` : ''}
        </button>`;
      }).join('')}
    `;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter.client = btn.dataset.client;
        renderClientTabs();
        renderTaskList();
      });
    });
  }

  function getFilteredTasks() {
    const f = state.filter;
    return state.tasks.filter(t => {
      if (f.status !== 'all' && t.status !== f.status) return false;
      if (f.client !== 'all' && t.client_name !== f.client) return false;
      if (f.priority !== 'all' && t.priority !== f.priority) return false;
      if (f.assignee !== 'all' && t.assigned_to !== f.assignee) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        return (t.title + t.description + t.client_name + (t.assigned_to || '')).toLowerCase().includes(q);
      }
      return true;
    });
  }

  function renderTaskList() {
    const container = document.getElementById('task-list');
    if (!container) return;
    const tasks = getFilteredTasks();
    const isCompleted = state.filter.status === 'completed';

    if (tasks.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
        </svg>
        <p>${isCompleted ? 'No completed tasks yet' : 'No tasks found'}</p>
      </div>`;
      return;
    }

    // Group by client for pending, flat for completed
    if (isCompleted) {
      container.innerHTML = tasks.sort((a, b) =>
        new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at)
      ).map(renderTaskCard).join('');
    } else {
      // Group by client
      const groups = {};
      tasks.forEach(t => {
        const c = t.client_name || 'General';
        if (!groups[c]) groups[c] = [];
        groups[c].push(t);
      });

      container.innerHTML = Object.entries(groups).map(([client, clientTasks]) => {
        const info = state.clients.find(c => c.name === client) || {};
        const sorted = [...clientTasks].sort((a, b) => {
          const prio = { urgent: 0, medium: 1, low: 2 };
          return (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1);
        });
        return `<div class="client-group">
          <div class="client-group-header" style="--cc:${info.color || '#6366f1'}">
            <span class="client-dot"></span>
            <span class="client-group-name">${escHtml(client)}</span>
            <span class="client-group-count">${sorted.length}</span>
          </div>
          ${sorted.map(renderTaskCard).join('')}
        </div>`;
      }).join('');
    }

    // Attach events
    container.querySelectorAll('.task-card').forEach(card => {
      card.querySelector('.task-title-row')?.addEventListener('click', () => {
        const expanded = card.classList.toggle('expanded');
        card.querySelector('.task-detail')?.classList.toggle('visible', expanded);
      });
      card.querySelector('.complete-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        toggleComplete(card.dataset.taskId);
      });
      card.querySelector('.edit-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        openTaskModal(card.dataset.taskId);
      });
      card.querySelector('.priority-sel')?.addEventListener('change', e => {
        e.stopPropagation();
        updateTaskField(card.dataset.taskId, 'priority', e.target.value);
      });
      card.querySelector('.assignee-sel')?.addEventListener('change', e => {
        e.stopPropagation();
        updateTaskField(card.dataset.taskId, 'assigned_to', e.target.value || null);
      });
    });
  }

  function renderTaskCard(task) {
    const isCompleted = task.status === 'completed';
    const pClass = `priority-${task.priority}`;
    const employeeOptions = ['', ...state.employees.map(e => e.name || e)]
      .map(n => `<option value="${escHtml(n)}" ${task.assigned_to === n && n ? 'selected' : ''}>${n ? escHtml(n) : 'Assign to…'}</option>`)
      .join('');

    const actionables = (task.actionables || []).map(a =>
      `<li>${escHtml(a)}</li>`).join('');

    const messages = (task.email_messages || []).slice(0, 5).map(m =>
      `<div class="email-msg">
        <div class="email-meta"><strong>${escHtml(m.from || '')}</strong> · ${formatDate(m.date)}</div>
        <div class="email-body">${escHtml((m.snippet || m.body || '').substring(0, 300))}</div>
      </div>`).join('');

    return `<div class="task-card ${pClass} ${isCompleted ? 'completed' : ''}" data-task-id="${task.id}">
      <div class="task-title-row">
        <div class="task-left">
          <label class="checkbox-wrap" onclick="event.stopPropagation()">
            <input type="checkbox" class="complete-btn" ${isCompleted ? 'checked' : ''}>
            <span class="checkmark"></span>
          </label>
          <div class="task-info">
            <span class="task-title ${isCompleted ? 'struck' : ''}">${escHtml(task.title)}</span>
            <div class="task-meta-row">
              <span class="priority-badge ${pClass}">${task.priority}</span>
              ${task.assigned_to ? `<span class="assignee-chip">${escHtml(task.assigned_to)}</span>` : ''}
              ${task.responsible_person ? `<span class="responsible-chip">Next: ${escHtml(task.responsible_person)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="task-actions" onclick="event.stopPropagation()">
          <select class="priority-sel compact-sel" title="Change priority">
            <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>🔴 Urgent</option>
            <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>🟢 Low</option>
          </select>
          <select class="assignee-sel compact-sel" title="Assign to">${employeeOptions}</select>
          <button class="edit-btn icon-btn" title="View details">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="task-detail">
        ${task.description ? `<p class="task-desc">${escHtml(task.description)}</p>` : ''}
        ${task.summary ? `<div class="summary-box"><strong>Summary</strong><p>${escHtml(task.summary)}</p></div>` : ''}
        ${actionables ? `<div class="actionables"><strong>Actionables</strong><ul>${actionables}</ul></div>` : ''}
        ${messages ? `<div class="email-thread"><strong>Email Thread</strong>${messages}</div>` : ''}
        <div class="task-footer">
          <span>Created ${formatDate(task.created_at)}</span>
          ${isCompleted && task.completed_at ? `<span>Completed ${formatDate(task.completed_at)}</span>` : ''}
          ${task.manual ? '<span class="manual-badge">Manual</span>' : ''}
        </div>
      </div>
    </div>`;
  }

  function renderEmployeeOptions() {
    const sel = document.getElementById('filter-assignee');
    if (!sel) return;
    const empNames = state.employees.map(e => e.name || e);
    sel.innerHTML = `<option value="all">All assignees</option>` +
      empNames.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  }

  // ── Task actions ───────────────────────────────────────────────────────────

  function toggleComplete(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    task.status = newStatus;
    task.updated_at = new Date().toISOString();
    if (newStatus === 'completed') task.completed_at = new Date().toISOString();
    else task.completed_at = null;
    persistUserUpdate({ type: 'task_update', id: taskId, status: newStatus, completed_at: task.completed_at });
    render();
  }

  function updateTaskField(taskId, field, value) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    task[field] = value;
    task.updated_at = new Date().toISOString();
    persistUserUpdate({ type: 'task_update', id: taskId, [field]: value });
    render();
  }

  function addManualTask(formData) {
    const clientName = formData.client_name.trim() || 'General';
    const task = {
      id: `manual_${Date.now()}`,
      client_name: clientName,
      title: formData.title.trim(),
      description: formData.description?.trim() || '',
      priority: formData.priority || 'medium',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      email_thread_id: null,
      email_subject: '',
      summary: '',
      actionables: (formData.actionables || '').split('\n').filter(Boolean),
      responsible_person: formData.responsible_person || '',
      assigned_to: formData.assigned_to || null,
      email_messages: [],
      manual: true,
      confidence: 1,
    };

    if (!state.clients.find(c => c.name.toLowerCase() === clientName.toLowerCase())) {
      const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6'];
      state.clients.push({
        id: `client_${Date.now()}`,
        name: clientName,
        order: state.clients.length,
        color: colors[state.clients.length % colors.length],
      });
    }

    state.tasks.push(task);
    persistUserUpdate({ type: 'new_task', task });
    render();
  }

  // ── Modals ─────────────────────────────────────────────────────────────────

  function openTaskModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const modal = document.getElementById('task-modal');
    const content = document.getElementById('task-modal-content');

    const employeeOptions = ['', ...state.employees.map(e => e.name || e)]
      .map(n => `<option value="${escHtml(n)}" ${task.assigned_to === n ? 'selected' : ''}>${n || 'Unassigned'}</option>`)
      .join('');

    const messages = (task.email_messages || []).map(m =>
      `<div class="email-msg-full">
        <div class="email-meta-full">
          <span><strong>${escHtml(m.from || '')}</strong></span>
          <span>${formatDate(m.date)}</span>
        </div>
        <div class="email-subj">${escHtml(m.subject || '')}</div>
        <pre class="email-body-full">${escHtml((m.body || m.snippet || '').substring(0, 1500))}</pre>
      </div>`
    ).join('');

    content.innerHTML = `
      <div class="modal-header">
        <h2>${escHtml(task.title)}</h2>
        <span class="priority-badge priority-${task.priority}">${task.priority}</span>
        <button class="modal-close" onclick="App.closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="modal-row">
          <label>Client</label><span>${escHtml(task.client_name)}</span>
        </div>
        ${task.summary ? `<div class="modal-section"><label>Summary</label><p>${escHtml(task.summary)}</p></div>` : ''}
        ${task.description ? `<div class="modal-section"><label>Description</label><p>${escHtml(task.description)}</p></div>` : ''}
        ${task.actionables?.length ? `<div class="modal-section"><label>Actionables</label><ul>${task.actionables.map(a=>`<li>${escHtml(a)}</li>`).join('')}</ul></div>` : ''}
        ${task.responsible_person ? `<div class="modal-row"><label>Next Action By</label><span>${escHtml(task.responsible_person)}</span></div>` : ''}
        <div class="modal-row">
          <label>Priority</label>
          <select id="modal-priority" onchange="App.updateTaskField('${task.id}','priority',this.value)">
            <option value="urgent" ${task.priority==='urgent'?'selected':''}>Urgent</option>
            <option value="medium" ${task.priority==='medium'?'selected':''}>Medium</option>
            <option value="low" ${task.priority==='low'?'selected':''}>Low</option>
          </select>
        </div>
        <div class="modal-row">
          <label>Assigned To</label>
          <select id="modal-assignee" onchange="App.updateTaskField('${task.id}','assigned_to',this.value||null)">
            ${employeeOptions}
          </select>
        </div>
        <div class="modal-row">
          <label>Status</label>
          <button class="btn-toggle-status" onclick="App.toggleComplete('${task.id}'); App.closeModal();">
            ${task.status === 'completed' ? 'Mark as Pending' : 'Mark as Completed'}
          </button>
        </div>
        ${messages ? `<div class="modal-section"><label>Email Thread (${(task.email_messages||[]).length} messages)</label><div class="email-thread-full">${messages}</div></div>` : ''}
      </div>`;

    modal.style.display = 'flex';
    state.activeModal = 'task';
  }

  function openAddTaskModal() {
    const modal = document.getElementById('add-task-modal');
    const clientOptions = [...new Set(state.tasks.map(t => t.client_name).filter(Boolean))]
      .map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
    const empOptions = ['', ...state.employees.map(e => e.name || e)]
      .map(n => `<option value="${escHtml(n)}">${n || 'Unassigned'}</option>`).join('');

    document.getElementById('add-task-form').innerHTML = `
      <div class="form-row">
        <label>Task Title *</label>
        <input type="text" name="title" required placeholder="What needs to be done?">
      </div>
      <div class="form-row">
        <label>Client Name *</label>
        <input type="text" name="client_name" list="client-datalist" placeholder="Client or company name" required>
        <datalist id="client-datalist">${clientOptions}</datalist>
      </div>
      <div class="form-row two-col">
        <div>
          <label>Priority</label>
          <select name="priority">
            <option value="urgent">🔴 Urgent</option>
            <option value="medium" selected>🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select>
        </div>
        <div>
          <label>Assign To</label>
          <select name="assigned_to">${empOptions}</select>
        </div>
      </div>
      <div class="form-row">
        <label>Description</label>
        <textarea name="description" rows="3" placeholder="Describe the task…"></textarea>
      </div>
      <div class="form-row">
        <label>Actionables <small>(one per line)</small></label>
        <textarea name="actionables" rows="3" placeholder="Action 1&#10;Action 2"></textarea>
      </div>
      <div class="form-row">
        <label>Responsible Person (Next Action)</label>
        <input type="text" name="responsible_person" placeholder="Name or email">
      </div>
      <div class="form-actions">
        <button type="button" class="btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Add Task</button>
      </div>
    `;
    modal.style.display = 'flex';
    state.activeModal = 'add-task';
  }

  function openSettingsModal() {
    const cfg = GitHubAPI.getConfig();
    document.getElementById('settings-pat').value = cfg.pat || '';
    document.getElementById('settings-repo').value = cfg.repo || '';
    document.getElementById('settings-branch').value = cfg.branch || 'main';

    // Populate employees
    const empList = document.getElementById('employee-list');
    empList.innerHTML = (state.employees || []).map((e, i) => {
      const name = e.name || e;
      return `<div class="emp-row">
        <input type="text" value="${escHtml(name)}" data-idx="${i}" class="emp-name-input">
        <button class="btn-remove-emp" data-idx="${i}">✕</button>
      </div>`;
    }).join('');

    document.getElementById('settings-modal').style.display = 'flex';
    state.activeModal = 'settings';
  }

  function closeModal() {
    ['task-modal', 'add-task-modal', 'settings-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    state.activeModal = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatDate(str) {
    if (!str) return '';
    try {
      const d = new Date(str);
      if (isNaN(d)) return str;
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return str; }
  }

  function showLoading(show) {
    const el = document.getElementById('loading-bar');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  function updateSyncTime() {
    const el = document.getElementById('sync-time');
    if (el && state.lastSync) {
      el.textContent = `Synced ${state.lastSync.toLocaleTimeString()}`;
    }
    const meta = document.getElementById('last-email-sync');
    if (meta && state.metadata.last_email_processed) {
      meta.textContent = `Emails: ${formatDate(state.metadata.last_email_processed)}`;
    }
  }

  function updateSyncBadge(ok) {
    const el = document.getElementById('sync-badge');
    if (el) {
      el.textContent = ok ? '✓ Synced' : '● Local';
      el.className = `sync-badge ${ok ? 'synced' : 'local'}`;
    }
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  function initEvents() {
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        state.filter.search = e.target.value;
        renderClientTabs();
        renderTaskList();
      });
    }

    // Filter dropdowns
    ['filter-status', 'filter-priority', 'filter-assignee'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', e => {
        const key = id.replace('filter-', '');
        state.filter[key] = e.target.value;
        renderTaskList();
      });
    });

    // Add task button
    document.getElementById('add-task-btn')?.addEventListener('click', openAddTaskModal);

    // Add task form submit
    document.getElementById('add-task-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      if (!data.title?.trim() || !data.client_name?.trim()) {
        alert('Title and client name are required');
        return;
      }
      addManualTask(data);
      closeModal();
    });

    // Settings form
    document.getElementById('settings-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const pat = document.getElementById('settings-pat').value.trim();
      const repo = document.getElementById('settings-repo').value.trim();
      const branch = document.getElementById('settings-branch').value.trim() || 'main';
      GitHubAPI.saveConfig(pat, repo, branch);

      // Save employees
      const inputs = document.querySelectorAll('.emp-name-input');
      const employees = [...inputs].map(inp => ({ name: inp.value.trim() })).filter(e => e.name);
      state.employees = employees;
      persistUserUpdate({ type: 'employees', employees });
      closeModal();
      alert('Settings saved!');
    });

    document.getElementById('add-employee-btn')?.addEventListener('click', () => {
      const list = document.getElementById('employee-list');
      const idx = list.children.length;
      const div = document.createElement('div');
      div.className = 'emp-row';
      div.innerHTML = `<input type="text" value="" data-idx="${idx}" class="emp-name-input" placeholder="Employee name">
        <button class="btn-remove-emp" data-idx="${idx}">✕</button>`;
      list.appendChild(div);
    });

    document.getElementById('employee-list')?.addEventListener('click', e => {
      if (e.target.classList.contains('btn-remove-emp')) {
        e.target.parentElement.remove();
      }
    });

    // Modal close on backdrop
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target === el) closeModal();
      });
    });

    // Settings button
    document.getElementById('settings-btn')?.addEventListener('click', openSettingsModal);

    // Reset pattern
    document.getElementById('pattern-reset')?.addEventListener('click', () => {
      PatternAuth.resetPattern();
    });

    // Refresh button
    document.getElementById('refresh-btn')?.addEventListener('click', loadData);

    // Status toggle (pending/completed tab)
    document.getElementById('view-completed')?.addEventListener('click', e => {
      state.filter.status = e.target.checked ? 'completed' : 'pending';
      renderTaskList();
    });

    // Keyboard shortcut: Escape closes modals
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── Auto-refresh ───────────────────────────────────────────────────────────

  function startAutoRefresh() {
    setInterval(loadData, 10 * 60 * 1000); // 10 minutes
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  function init() {
    PatternAuth.init(() => {
      loadData();
      initEvents();
      startAutoRefresh();
      updateSyncBadge(GitHubAPI.isConfigured());
    });
  }

  return { init, toggleComplete, updateTaskField, closeModal, openAddTaskModal, openSettingsModal };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
