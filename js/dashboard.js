/* ════════════════════════════════════════════════════
   dashboard.js — rendering engine
════════════════════════════════════════════════════ */

const Dashboard = (() => {

  /* ── filter state ── */
  const F = { search: '', status: 'all', priority: 'all', assignee: 'all' };

  /* ────────────────────────────────────────────────
     MAIN RENDER
  ──────────────────────────────────────────────── */
  function render() {
    const data = DB.get();
    if (!data) { _showEmpty(); return; }

    _renderStats(data);
    _renderAssigneeFilter(data);
    _renderClientList(data);
    _renderCompleted(data);
  }

  /* ── stats row ── */
  function _renderStats(data) {
    let total = 0, pending = 0, done = 0, urgent = 0, medium = 0, low = 0;

    for (const client of Object.values(data.clients)) {
      for (const t of client.tasks) {
        total++;
        if (t.status === 'completed') done++; else pending++;
        if (t.priority === 'urgent') urgent++;
        else if (t.priority === 'medium') medium++;
        else low++;
      }
    }

    document.getElementById('stat-total').textContent   = total;
    document.getElementById('stat-pending').textContent  = pending;
    document.getElementById('stat-done').textContent    = done;
    document.getElementById('stat-urgent').textContent  = urgent;
    document.getElementById('stat-medium').textContent  = medium;
    document.getElementById('stat-low').textContent     = low;
  }

  /* ── assignee filter options ── */
  function _renderAssigneeFilter(data) {
    const sel = document.getElementById('filter-assignee');
    const cur = sel.value;
    /* collect unique assignees */
    const set = new Set();
    for (const c of Object.values(data.clients))
      for (const t of c.tasks) if (t.assignedTo) set.add(t.assignedTo);

    /* keep "All" option + fresh list */
    sel.innerHTML = '<option value="all">Assignee</option>';
    [...set].sort().forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    });
    if (cur && cur !== 'all') sel.value = cur;
  }

  /* ── active client sections ── */
  function _renderClientList(data) {
    const container = document.getElementById('main-list');
    const emptyEl   = document.getElementById('empty-state');

    /* get clients sorted by their order field */
    const clients = Object.values(data.clients)
      .sort((a, b) => a.order - b.order);

    /* apply filters to tasks */
    let anyVisible = false;

    /* keep existing client cards so we don't thrash DOM */
    const existingIds = new Set([...container.querySelectorAll('.client-card')].map(el => el.dataset.clientId));
    const newIds      = new Set(clients.map(c => c.id));

    /* remove stale */
    existingIds.forEach(id => {
      if (!newIds.has(id)) container.querySelector(`[data-client-id="${id}"]`)?.remove();
    });

    clients.forEach((client, ci) => {
      const pendingTasks = client.tasks
        .filter(t => t.status !== 'completed')
        .filter(t => _taskMatchesFilter(t, client))
        .sort((a, b) => (CFG.PRIORITY_ORDER[a.priority] ?? 9) - (CFG.PRIORITY_ORDER[b.priority] ?? 9));

      if (pendingTasks.length === 0 && F.search) return; // hide empty clients when searching

      anyVisible = true;

      let card = container.querySelector(`[data-client-id="${client.id}"]`);
      if (!card) {
        card = _buildClientCard(client);
        container.appendChild(card);
      } else {
        _updateClientHeader(card, client, pendingTasks);
      }

      _renderTasksInCard(card, client, pendingTasks);
    });

    emptyEl.style.display = (anyVisible || Object.keys(data.clients).length === 0) ? 'none' : 'flex';
    if (Object.keys(data.clients).length === 0) emptyEl.style.display = 'flex';
  }

  function _buildClientCard(client) {
    const card = document.createElement('div');
    card.className       = 'client-card';
    card.dataset.clientId = client.id;
    card.innerHTML = `
      <div class="client-header" data-client-id="${client.id}">
        <svg class="client-arrow ${client.collapsed ? 'closed' : 'open'}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        <span class="client-name">${esc(client.name)}</span>
        <div class="client-badges">
          <span class="badge badge-urgent client-urgent-badge">0</span>
          <span class="badge badge-medium client-medium-badge">0</span>
          <span class="badge badge-low client-low-badge">0</span>
          <span class="badge badge-total client-total-badge">0</span>
        </div>
      </div>
      <div class="client-body" style="${client.collapsed ? 'display:none' : ''}"></div>
    `;

    card.querySelector('.client-header').addEventListener('click', () => {
      const body    = card.querySelector('.client-body');
      const arrow   = card.querySelector('.client-arrow');
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      arrow.className    = `client-arrow ${collapsed ? 'open' : 'closed'}`;
      DB.setClientCollapsed(client.id, !collapsed);
    });

    return card;
  }

  function _updateClientHeader(card, client, pendingTasks) {
    const name = card.querySelector('.client-name');
    if (name) name.textContent = client.name;
    _updateClientBadges(card, pendingTasks);
  }

  function _updateClientBadges(card, tasks) {
    const u = tasks.filter(t => t.priority === 'urgent').length;
    const m = tasks.filter(t => t.priority === 'medium').length;
    const l = tasks.filter(t => t.priority === 'low').length;

    card.querySelector('.client-urgent-badge').textContent = u;
    card.querySelector('.client-medium-badge').textContent = m;
    card.querySelector('.client-low-badge').textContent    = l;
    card.querySelector('.client-total-badge').textContent  = tasks.length;

    card.querySelector('.client-urgent-badge').style.display = u ? '' : 'none';
    card.querySelector('.client-medium-badge').style.display = m ? '' : 'none';
    card.querySelector('.client-low-badge').style.display    = l ? '' : 'none';
  }

  function _renderTasksInCard(card, client, tasks) {
    _updateClientBadges(card, tasks);
    const body = card.querySelector('.client-body');

    /* reconcile task items */
    const existingMap = new Map([...body.querySelectorAll('.task-item')].map(el => [el.dataset.taskId, el]));
    const newIdSet    = new Set(tasks.map(t => t.id));

    existingMap.forEach((el, id) => { if (!newIdSet.has(id)) el.remove(); });

    tasks.forEach((task, i) => {
      let item = existingMap.get(task.id);
      if (!item) {
        item = _buildTaskItem(task);
        body.appendChild(item);
      } else {
        _updateTaskItem(item, task);
      }
    });
  }

  function _buildTaskItem(task) {
    const item = document.createElement('div');
    item.className    = 'task-item';
    item.dataset.taskId = task.id;
    _updateTaskItem(item, task);
    return item;
  }

  function _updateTaskItem(item, task) {
    const done  = task.status === 'completed';
    const pDot  = `dot-${task.priority}`;
    const assigneeHtml = task.assignedTo
      ? `<span class="task-assignee">👤 ${esc(task.assignedTo)}</span>`
      : '';
    const sourceHtml = task.emailSubject
      ? `<span class="task-source" title="${esc(task.emailSubject)}">✉ ${esc(task.emailSubject)}</span>`
      : '';

    item.innerHTML = `
      <div class="task-row" data-task-id="${task.id}">
        <button class="task-check ${done ? 'checked' : ''}" data-complete-id="${task.id}" title="${done ? 'Mark pending' : 'Mark complete'}"></button>
        <div class="task-priority-dot ${pDot}"></div>
        <div class="task-info">
          <div class="task-title ${done ? 'done-text' : ''}">${esc(task.title)}</div>
          <div class="task-meta">${assigneeHtml}${sourceHtml}</div>
        </div>
        <div class="task-actions">
          <button class="task-action-btn" data-edit-id="${task.id}" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="task-action-btn task-priority-toggle" data-task-id="${task.id}" title="Change priority">
            <span class="priority-pill pill-${task.priority}">${task.priority}</span>
          </button>
        </div>
      </div>
    `;

    /* click row → open detail */
    item.querySelector('.task-row').addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openDetail(task.id);
    });

    /* check button */
    item.querySelector('[data-complete-id]').addEventListener('click', async e => {
      e.stopPropagation();
      await Tasks.toggleComplete(task.id);
    });

    /* edit button */
    item.querySelector('[data-edit-id]').addEventListener('click', e => {
      e.stopPropagation();
      Tasks.openEdit(task.id);
    });

    /* priority toggle */
    item.querySelector('.task-priority-toggle').addEventListener('click', async e => {
      e.stopPropagation();
      const cycles = ['urgent', 'medium', 'low'];
      const next   = cycles[(cycles.indexOf(task.priority) + 1) % 3];
      await Tasks.changePriority(task.id, next);
    });
  }

  /* ── completed section ── */
  function _renderCompleted(data) {
    const completedTasks = [];
    for (const client of Object.values(data.clients)) {
      for (const t of client.tasks) {
        if (t.status === 'completed') {
          completedTasks.push({ task: t, clientName: client.name });
        }
      }
    }

    const section = document.getElementById('completed-section');
    const badge   = document.getElementById('completed-badge');
    const list    = document.getElementById('completed-list');

    badge.textContent = completedTasks.length;
    section.style.display = completedTasks.length ? '' : 'none';

    list.innerHTML = '';
    completedTasks
      .sort((a, b) => (b.task.completedAt || '').localeCompare(a.task.completedAt || ''))
      .filter(({ task }) => _taskMatchesFilter(task, { name: '' }, true))
      .forEach(({ task, clientName }) => {
        const item = document.createElement('div');
        item.className    = 'task-item';
        item.dataset.taskId = task.id;
        item.innerHTML = `
          <div class="task-row" data-task-id="${task.id}">
            <button class="task-check checked" data-complete-id="${task.id}" title="Mark pending"></button>
            <div class="task-priority-dot dot-${task.priority}"></div>
            <div class="task-info">
              <div class="task-title done-text">${esc(task.title)}</div>
              <div class="task-meta">
                <span class="task-assignee">${esc(clientName)}</span>
                ${task.assignedTo ? `<span class="task-assignee">👤 ${esc(task.assignedTo)}</span>` : ''}
              </div>
            </div>
            <div class="task-actions">
              <button class="task-action-btn" data-edit-id="${task.id}" title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
            </div>
          </div>
        `;

        item.querySelector('.task-row').addEventListener('click', e => {
          if (e.target.closest('button')) return;
          openDetail(task.id);
        });
        item.querySelector('[data-complete-id]').addEventListener('click', async e => {
          e.stopPropagation();
          await Tasks.toggleComplete(task.id);
        });
        item.querySelector('[data-edit-id]').addEventListener('click', e => {
          e.stopPropagation();
          Tasks.openEdit(task.id);
        });

        list.appendChild(item);
      });
  }

  /* ── detail modal ── */
  function openDetail(taskId) {
    const task   = DB.findTask(taskId);
    const client = DB.findClientOfTask(taskId);
    if (!task) return;

    document.getElementById('detail-priority-pill').className = `priority-pill pill-${task.status === 'completed' ? 'done' : task.priority}`;
    document.getElementById('detail-priority-pill').textContent = task.status === 'completed' ? 'Done' : task.priority;
    document.getElementById('detail-title-el').textContent  = task.title;

    /* meta chips */
    const meta = document.getElementById('detail-meta');
    meta.innerHTML = '';
    const chips = [
      client && `<span class="detail-meta-chip">🏢 ${esc(client.name)}</span>`,
      task.assignedTo && `<span class="detail-meta-chip">👤 ${esc(task.assignedTo)}</span>`,
      task.createdAt && `<span class="detail-meta-chip">📅 Created ${_fmtDate(task.createdAt)}</span>`,
      task.completedAt && `<span class="detail-meta-chip">✅ Done ${_fmtDate(task.completedAt)}</span>`,
    ].filter(Boolean);
    meta.innerHTML = chips.join('');

    document.getElementById('detail-summary').textContent = task.summary || '—';

    const actionList = document.getElementById('detail-actionables');
    actionList.innerHTML = '';
    if (task.actionables && task.actionables.length) {
      task.actionables.forEach(a => {
        const li = document.createElement('li');
        li.textContent = a;
        actionList.appendChild(li);
      });
    } else {
      actionList.innerHTML = '<li style="color:var(--text-muted)">No specific actionables extracted</li>';
    }

    const nextBlock = document.getElementById('detail-next-block');
    const nextEl    = document.getElementById('detail-next-steps');
    if (task.nextStepsPerson) {
      nextEl.textContent = task.nextStepsPerson;
      nextBlock.style.display = '';
    } else {
      nextBlock.style.display = 'none';
    }

    /* email thread */
    const threadEl = document.getElementById('detail-thread');
    threadEl.innerHTML = '';
    if (task.emailHistory && task.emailHistory.length) {
      task.emailHistory.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'email-msg';
        div.innerHTML = `
          <div class="email-msg-header">
            <span class="email-msg-from">${esc(msg.from || '')}</span>
            <span class="email-msg-date">${esc(msg.date || '')}</span>
          </div>
          <div class="email-msg-subject">${esc(msg.subject || '')}</div>
          <div class="email-msg-snippet">${esc(msg.snippet || '')}</div>
        `;
        threadEl.appendChild(div);
      });
    } else {
      threadEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">No email thread attached</div>';
    }

    /* footer buttons */
    const completeBtn = document.getElementById('detail-toggle-complete-btn');
    completeBtn.textContent = task.status === 'completed' ? 'Mark Pending' : 'Mark Complete';
    completeBtn.onclick = async () => {
      await Tasks.toggleComplete(taskId);
      /* re-render pill */
      const updated = DB.findTask(taskId);
      if (updated) {
        document.getElementById('detail-priority-pill').className  = `priority-pill pill-${updated.status === 'completed' ? 'done' : updated.priority}`;
        document.getElementById('detail-priority-pill').textContent = updated.status === 'completed' ? 'Done' : updated.priority;
        completeBtn.textContent = updated.status === 'completed' ? 'Mark Pending' : 'Mark Complete';
      }
    };

    document.getElementById('detail-edit-btn').onclick = () => {
      closeModal('detail-modal-backdrop');
      Tasks.openEdit(taskId);
    };

    document.getElementById('detail-delete-btn').onclick = () => Tasks.remove(taskId);

    openModal('detail-modal-backdrop');
  }

  /* ── filter helpers ── */
  function _taskMatchesFilter(task, client, includeDone = false) {
    if (!includeDone && task.status === 'completed') return false;

    if (F.status !== 'all') {
      if (F.status === 'pending'   && task.status !== 'pending')   return false;
      if (F.status === 'completed' && task.status !== 'completed') return false;
    }
    if (F.priority !== 'all' && task.priority !== F.priority) return false;
    if (F.assignee !== 'all' && task.assignedTo !== F.assignee)   return false;

    if (F.search) {
      const q = F.search.toLowerCase();
      const haystack = [
        task.title, task.description, task.summary,
        task.assignedTo, client.name, task.emailSubject,
        ...(task.actionables || [])
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  }

  /* ── filter event wiring (called by app.js) ── */
  function wireFilters() {
    document.getElementById('search-input').addEventListener('input', e => {
      F.search = e.target.value.trim();
      document.getElementById('clear-search').style.display = F.search ? '' : 'none';
      render();
    });

    document.getElementById('clear-search').addEventListener('click', () => {
      F.search = '';
      document.getElementById('search-input').value = '';
      document.getElementById('clear-search').style.display = 'none';
      render();
    });

    document.getElementById('filter-status').addEventListener('change',   e => { F.status   = e.target.value; render(); });
    document.getElementById('filter-priority').addEventListener('change', e => { F.priority = e.target.value; render(); });
    document.getElementById('filter-assignee').addEventListener('change', e => { F.assignee = e.target.value; render(); });
  }

  /* ── completed toggle ── */
  function wireCompletedToggle() {
    const btn   = document.getElementById('completed-toggle');
    const list  = document.getElementById('completed-list');
    const arrow = document.getElementById('completed-arrow');

    btn.addEventListener('click', () => {
      const open = list.style.display !== 'none';
      list.style.display = open ? 'none' : '';
      arrow.className = `toggle-arrow ${open ? 'collapsed' : 'open'}`;
    });
  }

  /* ── helpers ── */
  function _showEmpty() {
    document.getElementById('empty-state').style.display = 'flex';
  }

  function _fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) { return iso.substring(0, 10); }
  }

  return { render, wireFilters, wireCompletedToggle, openDetail };
})();

/* ── Global helpers ── */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function openModal(backdropId) {
  document.getElementById(backdropId).style.display = 'flex';
}

function closeModal(backdropId) {
  document.getElementById(backdropId).style.display = 'none';
}

let _toastTimer = null;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}
