/**
 * app.js — Main dashboard logic
 *
 * Data sources:
 *   Server: ./data/tasks.json (updated by GitHub Actions every 10 min)
 *   Local:  localStorage for overrides, manual tasks, employees, client ordering
 *
 * LocalStorage keys:
 *   tracker_overrides    – { [taskId]: { priority?, assignee?, status?, completedAt?, deleted? } }
 *   tracker_manual_tasks – Task[] (manually added)
 *   tracker_client_order – string[] (user-defined client ordering)
 *   tracker_employees    – string[] (team member names)
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const LS_OVERRIDES   = 'tracker_overrides';
  const LS_MANUAL      = 'tracker_manual_tasks';
  const LS_ORDER       = 'tracker_client_order';
  const LS_EMPLOYEES   = 'tracker_employees';
  const REFRESH_MS     = 2 * 60 * 1000; // auto-refresh every 2 min

  // Client colors (cycled)
  const CLIENT_COLORS = [
    '#4F46E5','#0EA5E9','#10B981','#F59E0B','#EF4444',
    '#8B5CF6','#EC4899','#06B6D4','#84CC16','#F97316'
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  let state = {
    serverTasks: [],
    serverEmployees: [],
    serverMeta: {},
    overrides: {},
    manualTasks: [],
    clientOrder: [],
    employees: [],
    filters: { priority: '', client: '', employee: '', status: 'pending', search: '' },
    expandedTasks: new Set(),
    refreshTimer: null,
  };

  // ── localStorage helpers ───────────────────────────────────────────────────
  function lsGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  function loadLocal() {
    state.overrides   = lsGet(LS_OVERRIDES, {});
    state.manualTasks = lsGet(LS_MANUAL, []);
    state.clientOrder = lsGet(LS_ORDER, []);
    state.employees   = lsGet(LS_EMPLOYEES, []);
  }

  function saveLocal() {
    lsSet(LS_OVERRIDES, state.overrides);
    lsSet(LS_MANUAL, state.manualTasks);
    lsSet(LS_ORDER, state.clientOrder);
    lsSet(LS_EMPLOYEES, state.employees);
  }

  // ── Server fetch ───────────────────────────────────────────────────────────
  async function fetchServerData() {
    const url = './data/tasks.json?t=' + Date.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ── Merge tasks ────────────────────────────────────────────────────────────
  function getMergedTasks() {
    const all = [...state.serverTasks, ...state.manualTasks];
    return all
      .map(t => {
        const ov = state.overrides[t.id] || {};
        return { ...t, ...ov };
      })
      .filter(t => !t.deleted);
  }

  function getFilteredTasks(tasks) {
    const { priority, client, employee, status, search } = state.filters;
    return tasks.filter(t => {
      if (status === 'pending'   && t.status !== 'pending')   return false;
      if (status === 'completed' && t.status !== 'completed') return false;
      if (priority && t.priority !== priority) return false;
      if (client   && t.clientName !== client) return false;
      if (employee === '__unassigned__' && t.assignee) return false;
      if (employee && employee !== '__unassigned__' && t.assignee !== employee) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (t.title || '').toLowerCase().includes(q) ||
          (t.clientName || '').toLowerCase().includes(q) ||
          (t.summary || '').toLowerCase().includes(q) ||
          (t.assignee || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }

  // Sort: urgent → medium → low, then by updatedAt desc
  const PRIO_ORDER = { urgent: 0, medium: 1, low: 2 };
  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      const pa = PRIO_ORDER[a.priority] ?? 3;
      const pb = PRIO_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function relTime(iso) {
    if (!iso) return 'Never';
    const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (sec < 60) return 'Just now';
    if (sec < 3600) return Math.floor(sec/60) + 'm ago';
    if (sec < 86400) return Math.floor(sec/3600) + 'h ago';
    if (sec < 604800) return Math.floor(sec/86400) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function clientColor(name) {
    let hash = 0;
    for (const c of (name || '')) hash = ((hash << 5) - hash) + c.charCodeAt(0);
    return CLIENT_COLORS[Math.abs(hash) % CLIENT_COLORS.length];
  }

  function uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  }

  let toastTimer;
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  function updateStats() {
    const all = getMergedTasks();
    const pending   = all.filter(t => t.status === 'pending');
    const completed = all.filter(t => t.status === 'completed');
    const urgent = pending.filter(t => t.priority === 'urgent');
    const medium = pending.filter(t => t.priority === 'medium');
    const low    = pending.filter(t => t.priority === 'low');

    document.getElementById('stat-total').querySelector('.stat-num').textContent = all.length;
    document.getElementById('stat-pending').querySelector('.stat-num').textContent = pending.length;
    document.getElementById('stat-completed').querySelector('.stat-num').textContent = completed.length;
    document.getElementById('stat-urgent').querySelector('.stat-num').textContent = urgent.length;
    document.getElementById('stat-medium').querySelector('.stat-num').textContent = medium.length;
    document.getElementById('stat-low').querySelector('.stat-num').textContent = low.length;
  }

  // ── Client filter select ───────────────────────────────────────────────────
  function populateClientFilter() {
    const all = getMergedTasks();
    const clients = [...new Set(all.map(t => t.clientName).filter(Boolean))].sort();
    const sel = document.getElementById('filter-client');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Clients</option>';
    clients.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      if (c === cur) o.selected = true;
      sel.appendChild(o);
    });
    // Also populate add-task datalist
    const dl = document.getElementById('client-datalist');
    if (dl) {
      dl.innerHTML = '';
      clients.forEach(c => {
        const o = document.createElement('option');
        o.value = c; dl.appendChild(o);
      });
    }
  }

  function populateEmployeeFilters() {
    const allEmps = [...new Set([...state.employees, ...(state.serverEmployees || [])])].filter(Boolean).sort();
    [document.getElementById('filter-employee'), document.getElementById('modal-assignee-select'), document.getElementById('new-task-assignee')].forEach(sel => {
      if (!sel) return;
      const cur = sel.value;
      const isFilter = sel.id === 'filter-employee';
      sel.innerHTML = isFilter
        ? '<option value="">All Assignees</option><option value="__unassigned__">Unassigned</option>'
        : '<option value="">Unassigned</option>';
      allEmps.forEach(e => {
        const o = document.createElement('option');
        o.value = e; o.textContent = e;
        if (e === cur) o.selected = true;
        sel.appendChild(o);
      });
    });
  }

  // ── Render clients ─────────────────────────────────────────────────────────
  function getOrderedClients(tasks) {
    const clients = [...new Set(tasks.map(t => t.clientName).filter(Boolean))];
    // Apply user ordering, append unknowns
    const order = state.clientOrder.filter(c => clients.includes(c));
    const rest = clients.filter(c => !order.includes(c)).sort();
    return [...order, ...rest];
  }

  function renderClients() {
    const all = getMergedTasks();
    const pending = all.filter(t => t.status === 'pending');
    const filtered = getFilteredTasks(all).filter(t => t.status !== 'completed');
    const container = document.getElementById('clients-container');
    const emptyState = document.getElementById('empty-state');

    if (all.length === 0) {
      container.innerHTML = '';
      container.appendChild(emptyState);
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    // Group filtered pending tasks by client
    const byClient = {};
    filtered.forEach(t => {
      if (!byClient[t.clientName]) byClient[t.clientName] = [];
      byClient[t.clientName].push(t);
    });

    const orderedClients = getOrderedClients(pending);
    // Only show clients that have tasks in current filter, but preserve ordering
    const visibleClients = orderedClients.filter(c => byClient[c] && byClient[c].length > 0);

    // Remove old client sections
    [...container.querySelectorAll('.client-section')].forEach(el => el.remove());

    if (visibleClients.length === 0 && state.filters.search) {
      if (!container.querySelector('.no-results')) {
        const div = document.createElement('div');
        div.className = 'no-results empty-state';
        div.innerHTML = '<h3>No matching tasks</h3><p>Try a different search or clear the filters.</p>';
        container.appendChild(div);
      }
      return;
    }
    container.querySelector('.no-results')?.remove();

    visibleClients.forEach((clientName, idx) => {
      const tasks = sortTasks(byClient[clientName] || []);
      const section = buildClientSection(clientName, tasks, idx, orderedClients.length);
      container.appendChild(section);
    });
  }

  function buildClientSection(clientName, tasks, idx, total) {
    const urgentCount = tasks.filter(t => t.priority === 'urgent').length;
    const medCount    = tasks.filter(t => t.priority === 'medium').length;
    const isOpen = true; // all expanded by default; can be toggled

    const section = document.createElement('div');
    section.className = 'client-section open';
    section.dataset.client = clientName;

    const badgesHtml = [
      urgentCount ? `<span class="badge badge-danger">${urgentCount} urgent</span>` : '',
      medCount    ? `<span class="badge badge-warning">${medCount} medium</span>` : '',
    ].join('');

    section.innerHTML = `
      <div class="client-header">
        <svg class="client-chevron" viewBox="0 0 20 20" fill="none"><path d="M5 7l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span class="client-color-dot" style="background:${clientColor(clientName)}"></span>
        <span class="client-name">${esc(clientName)}</span>
        <div class="client-badges">
          ${badgesHtml}
          <span class="badge badge-neutral">${tasks.length}</span>
        </div>
        <div class="client-order-btns">
          <button class="order-btn order-up" title="Move up" data-client="${esc(clientName)}" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="order-btn order-dn" title="Move down" data-client="${esc(clientName)}" ${idx === total-1 ? 'disabled' : ''}>▼</button>
        </div>
      </div>
      <div class="client-tasks">
        ${tasks.map(t => buildTaskCard(t)).join('')}
      </div>`;

    // Toggle open/close
    section.querySelector('.client-header').addEventListener('click', e => {
      if (e.target.closest('.client-order-btns')) return;
      section.classList.toggle('open');
    });

    // Order buttons
    section.querySelector('.order-up').addEventListener('click', e => {
      e.stopPropagation();
      moveClient(clientName, -1);
    });
    section.querySelector('.order-dn').addEventListener('click', e => {
      e.stopPropagation();
      moveClient(clientName, +1);
    });

    // Task card interactions
    section.querySelectorAll('.task-card-header').forEach(hdr => {
      hdr.addEventListener('click', e => {
        if (e.target.closest('.task-check')) return;
        const card = hdr.closest('.task-card');
        const id = card.dataset.id;
        card.classList.toggle('expanded');
        if (card.classList.contains('expanded')) state.expandedTasks.add(id);
        else state.expandedTasks.delete(id);
      });
    });

    section.querySelectorAll('.task-check').forEach(chk => {
      chk.addEventListener('click', e => {
        e.stopPropagation();
        const id = chk.closest('.task-card').dataset.id;
        toggleComplete(id);
      });
    });

    section.querySelectorAll('.open-modal-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openTaskModal(btn.dataset.id);
      });
    });

    section.querySelectorAll('.inline-prio-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        changePriority(btn.dataset.id, btn.dataset.prio);
      });
    });

    return section;
  }

  function buildTaskCard(task) {
    const isExpanded = state.expandedTasks.has(task.id);
    const prioClass = task.priority || 'low';
    const threadHtml = (task.conversationHistory || []).slice(0, 3).map(m => `
      <div class="thread-mini-item">
        <span class="thread-mini-from">${esc(m.from?.split('<')[0]?.trim() || m.from)}</span>
        <span class="thread-mini-date"> · ${esc(m.date?.substring(0,16) || '')}</span>
        <div>${esc(m.snippet?.substring(0,120) || '')}</div>
      </div>`).join('');

    const actHtml = (task.actionables || []).map(a => `<li>${esc(a)}</li>`).join('');

    return `
    <div class="task-card ${isExpanded ? 'expanded' : ''}" data-id="${esc(task.id)}">
      <div class="task-card-header">
        <div class="task-check${task.status === 'completed' ? ' checked' : ''}"></div>
        <div class="task-main">
          <div class="task-title-row">
            <span class="task-title">${esc(task.title)}</span>
            <span class="priority-badge ${prioClass}">${prioClass}</span>
          </div>
          <div class="task-meta">
            ${task.assignee ? `<span class="task-meta-item"><svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 13c0-2.761 2.239-4 5-4s5 1.239 5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>${esc(task.assignee)}</span>` : ''}
            <span class="task-meta-item"><svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>${relTime(task.updatedAt)}</span>
            ${task.manuallyCreated ? '<span class="task-meta-item">✎ Manual</span>' : ''}
          </div>
        </div>
        <svg class="task-expand-icon" viewBox="0 0 20 20" fill="none"><path d="M5 7l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </div>
      <div class="task-detail">
        ${task.summary ? `<div class="detail-section"><div class="detail-label">Summary</div><div class="detail-text">${esc(task.summary)}</div></div>` : ''}
        ${actHtml ? `<div class="detail-section"><div class="detail-label">Action Items</div><ul class="actionables-list-inline">${actHtml}</ul></div>` : ''}
        ${task.nextStepsPerson ? `<div class="detail-section"><div class="detail-label">Next Steps</div><div class="detail-text">${esc(task.nextStepsPerson)}</div></div>` : ''}
        ${threadHtml ? `<div class="detail-section"><div class="detail-label">Email Thread (recent)</div><div class="thread-mini">${threadHtml}</div></div>` : ''}
        <div class="task-inline-actions">
          <button class="btn-primary btn-xs open-modal-btn" data-id="${esc(task.id)}">View Full Details</button>
          <button class="btn-ghost btn-xs inline-prio-btn" data-id="${esc(task.id)}" data-prio="urgent" style="color:var(--danger)">Urgent</button>
          <button class="btn-ghost btn-xs inline-prio-btn" data-id="${esc(task.id)}" data-prio="medium" style="color:var(--warning)">Medium</button>
          <button class="btn-ghost btn-xs inline-prio-btn" data-id="${esc(task.id)}" data-prio="low">Low</button>
        </div>
      </div>
    </div>`;
  }

  // ── Completed section ──────────────────────────────────────────────────────
  function renderCompleted() {
    const completed = getFilteredTasks(getMergedTasks()).filter(t => t.status === 'completed');
    const list = document.getElementById('completed-list');
    const count = document.getElementById('completed-count');
    count.textContent = completed.length;

    list.innerHTML = completed.length === 0
      ? '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px;">No completed tasks.</div>'
      : sortTasks(completed).map(t => buildTaskCard(t)).join('');

    // Wire up task card events in completed section
    list.querySelectorAll('.task-card-header').forEach(hdr => {
      hdr.addEventListener('click', e => {
        if (e.target.closest('.task-check')) return;
        hdr.closest('.task-card').classList.toggle('expanded');
      });
    });
    list.querySelectorAll('.task-check').forEach(chk => {
      chk.addEventListener('click', e => {
        e.stopPropagation();
        toggleComplete(chk.closest('.task-card').dataset.id);
      });
    });
    list.querySelectorAll('.open-modal-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openTaskModal(btn.dataset.id);
      });
    });
    list.querySelectorAll('.inline-prio-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        changePriority(btn.dataset.id, btn.dataset.prio);
      });
    });
  }

  // ── Full render ────────────────────────────────────────────────────────────
  function renderAll() {
    updateStats();
    populateClientFilter();
    populateEmployeeFilters();
    renderClients();
    renderCompleted();
  }

  // ── Task mutations ─────────────────────────────────────────────────────────
  function getTask(id) {
    return getMergedTasks().find(t => t.id === id) || null;
  }

  function applyOverride(id, patch) {
    state.overrides[id] = { ...(state.overrides[id] || {}), ...patch };
    saveLocal();
  }

  function toggleComplete(id) {
    const task = getTask(id);
    if (!task) return;
    const now = new Date().toISOString();
    if (task.status === 'pending') {
      applyOverride(id, { status: 'completed', completedAt: now });
      toast('Task marked complete', 'success');
    } else {
      applyOverride(id, { status: 'pending', completedAt: null });
      toast('Task moved back to pending');
    }
    renderAll();
  }

  function changePriority(id, priority) {
    applyOverride(id, { priority, manualPriority: true });
    toast('Priority updated to ' + priority);
    renderAll();
  }

  function changeAssignee(id, assignee) {
    applyOverride(id, { assignee: assignee || null });
    saveLocal();
    renderAll();
  }

  function deleteTask(id) {
    const task = getMergedTasks().find(t => t.id === id);
    if (!task) return;
    if (task.manuallyCreated) {
      state.manualTasks = state.manualTasks.filter(t => t.id !== id);
    } else {
      applyOverride(id, { deleted: true });
    }
    saveLocal();
    toast('Task deleted');
    closeTaskModal();
    renderAll();
  }

  function moveClient(name, dir) {
    const all = getMergedTasks().filter(t => t.status === 'pending');
    const clients = getOrderedClients(all);
    const idx = clients.indexOf(name);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= clients.length) return;
    clients.splice(idx, 1);
    clients.splice(newIdx, 0, name);
    state.clientOrder = clients;
    saveLocal();
    renderAll();
  }

  // ── Task modal ─────────────────────────────────────────────────────────────
  let currentModalTaskId = null;

  function openTaskModal(id) {
    const task = getTask(id);
    if (!task) return;
    currentModalTaskId = id;

    document.getElementById('modal-title').textContent = task.title;
    const pb = document.getElementById('modal-priority-badge');
    pb.textContent = task.priority;
    pb.className = 'priority-badge ' + task.priority;

    document.getElementById('modal-client').textContent = task.clientName;
    document.getElementById('modal-assignee').textContent = task.assignee || '—';
    document.getElementById('modal-next-person').textContent = task.nextStepsPerson || '—';
    document.getElementById('modal-updated').textContent = relTime(task.updatedAt);
    document.getElementById('modal-summary').textContent = task.summary || '—';

    const actList = document.getElementById('modal-actionables');
    actList.innerHTML = (task.actionables || []).map(a => `<li>${esc(a)}</li>`).join('');
    document.getElementById('modal-actionables-section').style.display =
      (task.actionables && task.actionables.length) ? '' : 'none';

    // Thread
    const threadEl = document.getElementById('modal-thread');
    threadEl.innerHTML = (task.conversationHistory || []).map(m => `
      <div class="thread-item">
        <div class="thread-item-from">${esc(m.from?.split('<')[0]?.trim() || m.from || '')}</div>
        <div class="thread-item-meta">To: ${esc(m.to?.substring(0,50) || '')} · ${esc(m.date?.substring(0,25) || '')}</div>
        <div class="thread-item-snippet">${esc(m.snippet || '')}</div>
      </div>`).join('');
    document.getElementById('modal-thread-section').style.display =
      (task.conversationHistory && task.conversationHistory.length) ? '' : 'none';
    threadEl.classList.add('hidden');
    document.getElementById('thread-toggle').textContent = 'Show';

    // Priority buttons
    document.querySelectorAll('.prio-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.p === task.priority);
    });

    // Assignee select
    populateEmployeeFilters();
    const asel = document.getElementById('modal-assignee-select');
    asel.value = task.assignee || '';

    // Complete button
    const cBtn = document.getElementById('modal-complete-btn');
    cBtn.textContent = task.status === 'completed' ? 'Move to Pending' : 'Mark Complete';
    cBtn.onclick = () => { toggleComplete(id); closeTaskModal(); };

    document.getElementById('task-modal').classList.remove('hidden');
  }

  function closeTaskModal() {
    document.getElementById('task-modal').classList.add('hidden');
    currentModalTaskId = null;
  }

  // ── Add task modal ─────────────────────────────────────────────────────────
  function openAddModal() {
    document.getElementById('new-task-title').value = '';
    document.getElementById('new-task-client').value = '';
    document.getElementById('new-task-priority').value = 'medium';
    document.getElementById('new-task-summary').value = '';
    populateEmployeeFilters();
    document.getElementById('new-task-assignee').value = '';
    document.getElementById('add-task-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('new-task-title').focus(), 100);
  }
  function closeAddModal() { document.getElementById('add-task-modal').classList.add('hidden'); }

  function submitAddTask(e) {
    e.preventDefault();
    const title    = document.getElementById('new-task-title').value.trim();
    const client   = document.getElementById('new-task-client').value.trim();
    const priority = document.getElementById('new-task-priority').value;
    const assignee = document.getElementById('new-task-assignee').value || null;
    const summary  = document.getElementById('new-task-summary').value.trim();

    if (!title || !client) {
      toast('Title and client are required', 'error');
      return;
    }
    const now = new Date().toISOString();
    const task = {
      id: uuid(),
      clientName: client,
      title,
      priority,
      status: 'pending',
      assignee,
      emailThreadId: null,
      emailMessageIds: [],
      summary,
      actionables: [],
      nextStepsPerson: '',
      conversationHistory: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      manuallyCreated: true,
      manualPriority: true
    };
    state.manualTasks.push(task);
    saveLocal();
    closeAddModal();
    toast('Task added!', 'success');
    renderAll();
  }

  // ── Employees modal ────────────────────────────────────────────────────────
  function openEmpModal() {
    renderEmpList();
    document.getElementById('emp-modal').classList.remove('hidden');
  }
  function closeEmpModal() { document.getElementById('emp-modal').classList.add('hidden'); }

  function renderEmpList() {
    const list = document.getElementById('emp-list');
    list.innerHTML = state.employees.length === 0
      ? '<li style="color:var(--text-3);font-size:13px;padding:8px 0;">No team members yet.</li>'
      : state.employees.map(e => `
          <li class="emp-item">
            <div class="emp-avatar">${esc(e.charAt(0).toUpperCase())}</div>
            <span class="emp-name">${esc(e)}</span>
            <button class="emp-remove" data-name="${esc(e)}">✕</button>
          </li>`).join('');
    list.querySelectorAll('.emp-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        state.employees = state.employees.filter(e => e !== btn.dataset.name);
        saveLocal();
        renderEmpList();
        populateEmployeeFilters();
      });
    });
  }

  // ── Sync status display ────────────────────────────────────────────────────
  function updateSyncStatus() {
    const dot   = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    const meta  = state.serverMeta;
    if (!meta.lastSyncTime) {
      dot.className = 'sync-dot';
      label.textContent = 'Not synced yet';
      return;
    }
    dot.className = 'sync-dot synced';
    label.textContent = 'Synced ' + relTime(meta.lastSyncTime);
    if (!meta.firstRunComplete) {
      dot.className = 'sync-dot syncing';
      label.textContent = 'First sync pending…';
    }
  }

  // ── Load & refresh ─────────────────────────────────────────────────────────
  async function loadData(showSpinner = false) {
    const icon = document.querySelector('#refresh-btn svg');
    if (showSpinner && icon) icon.classList.add('spinning');
    try {
      const data = await fetchServerData();
      state.serverTasks     = data.tasks || [];
      state.serverEmployees = (data.employees || []).map(e => typeof e === 'string' ? e : e.name);
      state.serverMeta      = data.meta || {};
      updateSyncStatus();
      renderAll();
    } catch (err) {
      console.warn('Failed to load tasks.json:', err.message);
      document.getElementById('sync-dot').className = 'sync-dot error';
      document.getElementById('sync-label').textContent = 'Sync error – using cached data';
      // Still render with local data
      renderAll();
    } finally {
      if (icon) icon.classList.remove('spinning');
    }
  }

  function startAutoRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => loadData(), REFRESH_MS);
  }

  // ── Wire up all UI events ──────────────────────────────────────────────────
  function bindEvents() {
    // Refresh
    document.getElementById('refresh-btn').addEventListener('click', () => loadData(true));

    // Lock
    document.getElementById('lock-btn').addEventListener('click', () => {
      document.getElementById('app').classList.add('hidden');
      document.getElementById('auth-screen').style.display = '';
      // Reload page so auth.js re-initialises
      location.reload();
    });

    // Search
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    searchInput.addEventListener('input', () => {
      state.filters.search = searchInput.value;
      searchClear.classList.toggle('hidden', !searchInput.value);
      renderAll();
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      state.filters.search = '';
      searchClear.classList.add('hidden');
      renderAll();
    });

    // Filters
    document.getElementById('filter-priority').addEventListener('change', e => {
      state.filters.priority = e.target.value; renderAll();
    });
    document.getElementById('filter-client').addEventListener('change', e => {
      state.filters.client = e.target.value; renderAll();
    });
    document.getElementById('filter-employee').addEventListener('change', e => {
      state.filters.employee = e.target.value; renderAll();
    });
    document.getElementById('filter-status').addEventListener('change', e => {
      state.filters.status = e.target.value; renderAll();
    });
    document.getElementById('clear-filters').addEventListener('click', () => {
      state.filters = { priority:'', client:'', employee:'', status:'pending', search:'' };
      document.getElementById('filter-priority').value = '';
      document.getElementById('filter-client').value = '';
      document.getElementById('filter-employee').value = '';
      document.getElementById('filter-status').value = 'pending';
      document.getElementById('search-input').value = '';
      document.getElementById('search-clear').classList.add('hidden');
      renderAll();
    });

    // Stats click → quick filter
    document.getElementById('stat-urgent').addEventListener('click', () => {
      state.filters.priority = 'urgent';
      document.getElementById('filter-priority').value = 'urgent';
      renderAll();
    });
    document.getElementById('stat-pending').addEventListener('click', () => {
      state.filters.status = 'pending';
      document.getElementById('filter-status').value = 'pending';
      renderAll();
    });
    document.getElementById('stat-completed').addEventListener('click', () => {
      state.filters.status = 'completed';
      document.getElementById('filter-status').value = 'completed';
      renderAll();
    });

    // Add task
    document.getElementById('add-task-btn').addEventListener('click', openAddModal);
    document.getElementById('fab').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);
    document.getElementById('add-task-close').addEventListener('click', closeAddModal);
    document.getElementById('add-task-cancel').addEventListener('click', closeAddModal);
    document.getElementById('add-task-backdrop').addEventListener('click', closeAddModal);
    document.getElementById('add-task-form').addEventListener('submit', submitAddTask);

    // Task modal
    document.getElementById('task-modal-close').addEventListener('click', closeTaskModal);
    document.getElementById('task-modal-backdrop').addEventListener('click', closeTaskModal);

    document.getElementById('thread-toggle').addEventListener('click', () => {
      const tl = document.getElementById('modal-thread');
      const btn = document.getElementById('thread-toggle');
      const hidden = tl.classList.toggle('hidden');
      btn.textContent = hidden ? 'Show' : 'Hide';
    });

    document.querySelectorAll('.prio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!currentModalTaskId) return;
        changePriority(currentModalTaskId, btn.dataset.p);
        document.querySelectorAll('.prio-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('modal-priority-badge').textContent = btn.dataset.p;
        document.getElementById('modal-priority-badge').className = 'priority-badge ' + btn.dataset.p;
      });
    });

    document.getElementById('modal-assignee-select').addEventListener('change', e => {
      if (!currentModalTaskId) return;
      changeAssignee(currentModalTaskId, e.target.value);
      document.getElementById('modal-assignee').textContent = e.target.value || '—';
    });

    document.getElementById('modal-delete-btn').addEventListener('click', () => {
      if (!currentModalTaskId) return;
      if (confirm('Delete this task?')) deleteTask(currentModalTaskId);
    });

    // Employees modal
    document.getElementById('manage-employees-btn').addEventListener('click', openEmpModal);
    document.getElementById('emp-close').addEventListener('click', closeEmpModal);
    document.getElementById('emp-backdrop').addEventListener('click', closeEmpModal);
    document.getElementById('emp-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = document.getElementById('emp-name').value.trim();
      if (!name) return;
      if (!state.employees.includes(name)) {
        state.employees.push(name);
        saveLocal();
        populateEmployeeFilters();
        renderEmpList();
        toast(name + ' added to team', 'success');
      }
      document.getElementById('emp-name').value = '';
    });

    // Completed section toggle
    const completedToggle = document.getElementById('completed-toggle');
    completedToggle.addEventListener('click', () => {
      const list = document.getElementById('completed-list');
      const chevron = document.getElementById('completed-chevron');
      list.classList.toggle('hidden');
      chevron.style.transform = list.classList.contains('hidden') ? '' : 'rotate(180deg)';
    });

    // Keyboard shortcut: Escape closes modals
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeTaskModal();
        closeAddModal();
        closeEmpModal();
      }
    });
  }

  // ── Entry point (called by auth.js after unlock) ───────────────────────────
  window.AppInit = function () {
    loadLocal();
    bindEvents();
    loadData();
    startAutoRefresh();
  };

})();
