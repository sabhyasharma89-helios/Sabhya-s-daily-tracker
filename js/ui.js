/* ── UI Rendering & Event Handling ───────────────────────────────────
   Renders the dashboard from the db snapshot; wires all interactions.
   ─────────────────────────────────────────────────────────────────── */

const UI = (() => {

  /* ── Toast ────────────────────────────────────────────────────────── */
  let _toastTimer = null;
  function toast(msg, type = '', duration = 2800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  /* ── Date helpers ─────────────────────────────────────────────────── */
  function relDate(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  /* ── Priority Badge ───────────────────────────────────────────────── */
  function badgeHtml(priority, status) {
    if (status === 'completed') return `<span class="priority-badge done">Done</span>`;
    return `<span class="priority-badge ${priority}">${priority}</span>`;
  }

  /* ── Client colour map ────────────────────────────────────────────── */
  const PALETTE = ['#6366f1','#f59e0b','#22c55e','#ef4444','#06b6d4',
                   '#a855f7','#f97316','#14b8a6','#ec4899','#84cc16'];
  const _colourMap = {};
  let _colourIdx = 0;
  function clientColour(name) {
    if (!_colourMap[name]) {
      _colourMap[name] = PALETTE[_colourIdx++ % PALETTE.length];
    }
    return _colourMap[name];
  }

  /* ── Full dashboard render ────────────────────────────────────────── */
  function render(db, activeFilters) {
    const { search, status, priority, employee } = activeFilters;

    // Stats
    const stats = Tasks.computeStats(db.tasks);
    document.getElementById('statTotal').textContent     = stats.total;
    document.getElementById('statPending').textContent   = stats.pending;
    document.getElementById('statCompleted').textContent = stats.completed;
    document.getElementById('statUrgent').textContent    = stats.urgent;
    document.getElementById('statMedium').textContent    = stats.medium;
    document.getElementById('statLow').textContent       = stats.low;

    // Last updated
    document.getElementById('lastUpdated').textContent = db.lastUpdated
      ? `Updated ${relDate(db.lastUpdated)}`
      : 'No data yet';

    // Employee filter dropdown
    _populateEmployeeFilter(db.settings?.employees || []);
    _populateDataLists(db.clients || [], db.settings?.employees || []);

    // Filter tasks
    const filtered = Tasks.filter(db.tasks, { search, status, priority, employee });
    const pending   = filtered.filter(t => t.status !== 'completed');
    const completed = filtered.filter(t => t.status === 'completed');

    // Client sections
    const clientOrder = Tasks.loadClientOrder();
    const groups = Tasks.groupByClient(pending.length ? pending : db.tasks.filter(t => t.status !== 'completed'), clientOrder);

    // Re-filter groups to only show what matches
    const filteredGroups = status === 'completed'
      ? []
      : Tasks.groupByClient(pending, clientOrder);

    _renderClientSections(filteredGroups);
    _renderCompletedSection(completed);

    // Loading/empty state
    document.getElementById('loadingState').classList.add('hidden');
    const isEmpty = filteredGroups.length === 0 && completed.length === 0;
    document.getElementById('emptyState').classList.toggle('hidden', !isEmpty);
  }

  function _renderClientSections(groups) {
    const container = document.getElementById('clientSections');
    const expanded  = _getExpandedSet('client');

    container.innerHTML = '';

    groups.forEach(({ name, tasks }) => {
      const isOpen = expanded.has(name);
      const colour = clientColour(name);
      const block  = document.createElement('div');
      block.className = 'section-block';
      block.dataset.client = name;
      block.draggable = true;

      block.innerHTML = `
        <button class="section-header${isOpen ? '' : ' collapsed'}" data-client="${name}">
          <span class="section-title">
            <span class="drag-handle" title="Drag to reorder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
              </svg>
            </span>
            <span class="client-color-dot" style="background:${colour}"></span>
            ${escHtml(name)}
          </span>
          <span class="section-meta">
            <span class="task-count">${tasks.length}</span>
            <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </button>
        <div class="section-body" id="body-${slugify(name)}" ${isOpen ? '' : 'style="display:none"'}>
          ${tasks.map(t => _taskCardHtml(t)).join('')}
        </div>`;

      _wireClientHeader(block, name);
      _wireDragDrop(block, name);
      container.appendChild(block);
    });
  }

  function _wireClientHeader(block, name) {
    const btn  = block.querySelector('.section-header');
    const body = block.querySelector('.section-body');
    btn.addEventListener('click', e => {
      if (e.target.closest('.drag-handle')) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      btn.classList.toggle('collapsed', !open);
      _toggleExpanded('client', name, !open);
    });
    // Wire task cards
    block.querySelectorAll('.task-card').forEach(card => _wireTaskCard(card));
  }

  /* ── Drag-to-reorder client sections ─────────────────────────────── */
  let _dragSrc = null;
  function _wireDragDrop(block) {
    block.addEventListener('dragstart', e => {
      if (e.target.closest('.drag-handle')) {
        _dragSrc = block;
        e.dataTransfer.effectAllowed = 'move';
        block.classList.add('dragging');
      } else {
        e.preventDefault();
      }
    });
    block.addEventListener('dragend', () => {
      _dragSrc = null;
      block.classList.remove('dragging', 'drag-over');
    });
    block.addEventListener('dragover', e => {
      if (_dragSrc && _dragSrc !== block) {
        e.preventDefault();
        block.classList.add('drag-over');
      }
    });
    block.addEventListener('dragleave', () => block.classList.remove('drag-over'));
    block.addEventListener('drop', e => {
      e.preventDefault();
      block.classList.remove('drag-over');
      if (_dragSrc && _dragSrc !== block) {
        const container = block.parentElement;
        const blocks    = [...container.querySelectorAll('.section-block')];
        const srcIdx    = blocks.indexOf(_dragSrc);
        const tgtIdx    = blocks.indexOf(block);
        if (srcIdx < tgtIdx) {
          container.insertBefore(_dragSrc, block.nextSibling);
        } else {
          container.insertBefore(_dragSrc, block);
        }
        // Persist order
        const order = [...container.querySelectorAll('.section-block')].map(b => b.dataset.client);
        Tasks.saveClientOrder(order);
      }
    });
  }

  function _renderCompletedSection(tasks) {
    const block = document.getElementById('completedBlock');
    const list  = document.getElementById('completedTasksList');
    const count = document.getElementById('completedCount');

    count.textContent = tasks.length;

    if (!tasks.length) {
      block.style.display = 'none';
      return;
    }
    block.style.display = '';
    list.innerHTML = tasks.map(t => _taskCardHtml(t, true)).join('');
    list.querySelectorAll('.task-card').forEach(card => _wireTaskCard(card));
  }

  /* ── Task Card HTML ───────────────────────────────────────────────── */
  function _taskCardHtml(t, isCompleted = false) {
    const done = isCompleted || t.status === 'completed';
    return `
    <div class="task-card${done ? ' done' : ''}" data-id="${t.id}">
      <div class="task-top">
        <div class="task-check${done ? ' checked' : ''}" data-id="${t.id}" title="${done ? 'Mark pending' : 'Mark complete'}"></div>
        <div class="task-main">
          <div class="task-title-row">
            ${badgeHtml(t.priority, t.status)}
            <span class="task-title">${escHtml(t.title)}</span>
          </div>
          <div class="task-meta">
            ${t.assignedTo ? `<span class="task-assignee">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              ${escHtml(t.assignedTo)}
            </span>` : ''}
            <span class="task-date">${relDate(t.updatedAt || t.createdAt)}</span>
            ${t.emailHistory?.length ? `<span class="task-date">📧 ${t.emailHistory.length} email${t.emailHistory.length !== 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
        <button class="task-expand-btn" data-id="${t.id}" title="Expand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
      <div class="task-detail" id="detail-${t.id}">
        ${_taskDetailHtml(t)}
      </div>
    </div>`;
  }

  function _taskDetailHtml(t) {
    const employees = _cachedEmployees();
    return `
      ${t.summary ? `
        <div class="detail-section">
          <div class="detail-label">Summary</div>
          <div class="detail-text">${escHtml(t.summary)}</div>
        </div>` : ''}

      ${t.actionables?.length ? `
        <div class="detail-section">
          <div class="detail-label">Action Items</div>
          <ul class="actionables-list">
            ${t.actionables.map(a => `<li>${escHtml(a)}</li>`).join('')}
          </ul>
        </div>` : ''}

      ${t.nextStepPerson ? `
        <div class="detail-section">
          <div class="detail-label">Next Step Owner</div>
          <div class="detail-text">👤 ${escHtml(t.nextStepPerson)}</div>
        </div>` : ''}

      ${t.emailHistory?.length ? `
        <div class="detail-section">
          <div class="detail-label">Email Thread (${t.emailHistory.length} messages)</div>
          <div class="email-thread">
            ${t.emailHistory.map(m => `
              <div class="email-msg">
                <div class="email-msg-header">
                  <span class="email-msg-from">${escHtml(_shortEmail(m.from))}</span>
                  <span>${escHtml(_shortDate(m.date))}</span>
                </div>
                <div class="email-msg-body">${escHtml((m.body || m.snippet || '').slice(0, 400))}${(m.body || m.snippet || '').length > 400 ? '…' : ''}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <div class="detail-actions">
        <div class="task-action-inline">
          <label>Priority:</label>
          <select class="priority-select" data-id="${t.id}">
            <option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
            <option value="medium" ${t.priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low"    ${t.priority === 'low'    ? 'selected' : ''}>Low</option>
          </select>
        </div>
        <div class="task-action-inline">
          <label>Assign:</label>
          <input class="assignee-input" data-id="${t.id}" value="${escHtml(t.assignedTo || '')}"
            placeholder="Employee name" list="employeeDatalist" />
        </div>
      </div>`;
  }

  /* ── Wire task card events ────────────────────────────────────────── */
  function _wireTaskCard(card) {
    const id = card.dataset.id;

    // Expand/collapse
    const expandBtn = card.querySelector('.task-expand-btn');
    const detail    = card.querySelector('.task-detail');
    expandBtn?.addEventListener('click', e => {
      e.stopPropagation();
      const open = detail.classList.contains('visible');
      detail.classList.toggle('visible', !open);
      expandBtn.classList.toggle('open', !open);
    });

    card.addEventListener('click', e => {
      if (e.target.closest('.task-check') ||
          e.target.closest('.priority-select') ||
          e.target.closest('.assignee-input') ||
          e.target.closest('.task-expand-btn')) return;
      expandBtn?.click();
    });

    // Check / uncheck
    const check = card.querySelector('.task-check');
    check?.addEventListener('click', async e => {
      e.stopPropagation();
      const checked = check.classList.contains('checked');
      check.classList.toggle('checked', !checked);
      try {
        if (checked) {
          await Tasks.markPending(id);
          toast('Task moved back to pending', 'success');
        } else {
          await Tasks.markComplete(id);
          toast('Task marked complete', 'success');
        }
        Storage.invalidateCache();
        App.reload();
      } catch (err) { toast(err.message, 'error'); }
    });

    // Priority change
    card.querySelector('.priority-select')?.addEventListener('change', async e => {
      e.stopPropagation();
      try {
        await Tasks.updatePriority(id, e.target.value);
        toast('Priority updated', 'success');
        Storage.invalidateCache();
        App.reload();
      } catch (err) { toast(err.message, 'error'); }
    });

    // Assignee change
    card.querySelector('.assignee-input')?.addEventListener('change', async e => {
      e.stopPropagation();
      try {
        await Tasks.updateAssignee(id, e.target.value);
        toast('Assignee updated', 'success');
        Storage.invalidateCache();
        App.reload();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ── Completed toggle ─────────────────────────────────────────────── */
  function wireCompletedToggle() {
    const btn  = document.getElementById('completedToggle');
    const body = document.getElementById('completedTasksList');
    btn?.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      btn.classList.toggle('collapsed', !open);
    });
  }

  /* ── Stats filter chips ───────────────────────────────────────────── */
  function wireStatChips(onChange) {
    document.getElementById('statsBar').addEventListener('click', e => {
      const chip = e.target.closest('.stat-chip');
      if (!chip) return;
      document.querySelectorAll('.stat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const f = chip.dataset.filter;
      if (['urgent','medium','low'].includes(f)) {
        onChange({ priority: f, status: 'all' });
      } else {
        onChange({ status: f === 'all' ? 'all' : f, priority: 'all' });
      }
    });
  }

  /* ── Filter bar ───────────────────────────────────────────────────── */
  function wireFilterBar(onChange) {
    const search   = document.getElementById('searchInput');
    const status   = document.getElementById('filterStatus');
    const priority = document.getElementById('filterPriority');
    const employee = document.getElementById('filterEmployee');
    const clear    = document.getElementById('clearFiltersBtn');

    const emit = () => onChange({
      search: search.value, status: status.value,
      priority: priority.value, employee: employee.value
    });

    search.addEventListener('input', emit);
    status.addEventListener('change', emit);
    priority.addEventListener('change', emit);
    employee.addEventListener('change', emit);
    clear.addEventListener('click', () => {
      search.value = ''; status.value = 'all'; priority.value = 'all'; employee.value = 'all';
      document.querySelectorAll('.stat-chip').forEach(c => c.classList.remove('active'));
      document.querySelector('.stat-chip[data-filter="all"]')?.classList.add('active');
      emit();
    });
  }

  /* ── Settings modal ───────────────────────────────────────────────── */
  function wireSettings(db) {
    document.getElementById('settingsBtn').addEventListener('click', () => openSettings(db));
    document.getElementById('settingsModalClose').addEventListener('click', closeSettings);
    document.getElementById('settingsModal').addEventListener('click', e => {
      if (e.target === document.getElementById('settingsModal')) closeSettings();
    });

    document.getElementById('saveGhToken').addEventListener('click', () => {
      const v = document.getElementById('ghTokenInput').value.trim();
      if (v) { setGhToken(v); toast('Token saved', 'success'); }
    });

    document.getElementById('saveGhConfig').addEventListener('click', () => {
      const repo   = document.getElementById('ghRepoInput').value.trim();
      const branch = document.getElementById('ghBranchInput').value.trim() || 'main';
      if (repo) {
        const [owner, name] = repo.split('/');
        saveConfig({ githubOwner: owner, githubRepo: name, githubBranch: branch });
        toast('Config saved. Reload to apply.', 'success');
      }
    });

    document.getElementById('saveEmployees').addEventListener('click', async () => {
      const lines = document.getElementById('employeesList').value
        .split('\n').map(s => s.trim()).filter(Boolean);
      await Tasks.setEmployees(lines);
      toast('Employees saved', 'success');
      Storage.invalidateCache();
      App.reload();
    });

    document.getElementById('changePatternBtn').addEventListener('click', () => {
      closeSettings();
      Auth.triggerChangePattern();
    });
    document.getElementById('lockNowBtn').addEventListener('click', () => {
      closeSettings();
      Auth.lock();
    });
    document.getElementById('exportDataBtn').addEventListener('click', async () => {
      const d = await Storage.loadTasks(true);
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tasks.json';
      a.click();
    });
  }

  function openSettings(db) {
    document.getElementById('ghTokenInput').value = getGhToken() ? '••••••••••••' : '';
    document.getElementById('ghRepoInput').value = `${CONFIG.githubOwner}/${CONFIG.githubRepo}`;
    document.getElementById('ghBranchInput').value = CONFIG.githubBranch;
    document.getElementById('employeesList').value = (db.settings?.employees || []).join('\n');
    document.getElementById('lastEmailProcessed').textContent = db.emailLastRun || '—';
    document.getElementById('totalTasksCount').textContent = db.tasks?.length || 0;
    document.getElementById('settingsModal').classList.remove('hidden');
  }
  function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
  }

  /* ── Add Task modal ───────────────────────────────────────────────── */
  function wireAddTask() {
    document.getElementById('addTaskBtn').addEventListener('click', () => {
      document.getElementById('addTaskModal').classList.remove('hidden');
      document.getElementById('newTaskTitle').focus();
    });
    document.getElementById('addTaskModalClose').addEventListener('click', _closeAddTask);
    document.getElementById('cancelAddTask').addEventListener('click', _closeAddTask);
    document.getElementById('addTaskModal').addEventListener('click', e => {
      if (e.target === document.getElementById('addTaskModal')) _closeAddTask();
    });
    document.getElementById('submitAddTask').addEventListener('click', _submitAddTask);
  }

  function _closeAddTask() {
    document.getElementById('addTaskModal').classList.add('hidden');
    document.getElementById('addTaskForm').reset();
  }

  async function _submitAddTask() {
    const title  = document.getElementById('newTaskTitle').value.trim();
    const client = document.getElementById('newTaskClient').value.trim();
    if (!title || !client) { toast('Title and client are required', 'error'); return; }
    const actionText = document.getElementById('newTaskActions').value.trim();
    const actionables = actionText ? actionText.split('\n').map(s => s.trim()).filter(Boolean) : [];
    try {
      await Tasks.createTask({
        title,
        clientName:  client,
        priority:    document.getElementById('newTaskPriority').value,
        assignedTo:  document.getElementById('newTaskAssignee').value.trim(),
        description: document.getElementById('newTaskDesc').value.trim(),
        actionables
      });
      _closeAddTask();
      toast('Task added', 'success');
      Storage.invalidateCache();
      App.reload();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ── Populate employee filter / datalists ─────────────────────────── */
  let _cachedEmpList = [];
  function _cachedEmployees() { return _cachedEmpList; }

  function _populateEmployeeFilter(employees) {
    _cachedEmpList = employees;
    const sel = document.getElementById('filterEmployee');
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    employees.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e; opt.textContent = e;
      sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }

  function _populateDataLists(clients, employees) {
    const cd = document.getElementById('clientDatalist');
    const ed = document.getElementById('employeeDatalist');
    if (cd) { cd.innerHTML = clients.map(c => `<option value="${escHtml(c)}">`).join(''); }
    if (ed) { ed.innerHTML = employees.map(e => `<option value="${escHtml(e)}">`).join(''); }
  }

  /* ── Expand/collapse state persistence ───────────────────────────── */
  function _getExpandedSet(ns) {
    try { return new Set(JSON.parse(localStorage.getItem(`expanded_${ns}`) || '[]')); }
    catch { return new Set(); }
  }
  function _toggleExpanded(ns, key, open) {
    const set = _getExpandedSet(ns);
    open ? set.add(key) : set.delete(key);
    localStorage.setItem(`expanded_${ns}`, JSON.stringify([...set]));
  }

  /* ── Utility ──────────────────────────────────────────────────────── */
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, '-'); }
  function _shortEmail(str) {
    const m = (str || '').match(/<(.+)>/);
    return m ? m[1] : str;
  }
  function _shortDate(str) {
    if (!str) return '';
    try { return new Date(str).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }); }
    catch { return str.slice(0, 16); }
  }

  return { render, wireStatChips, wireFilterBar, wireSettings, wireAddTask, wireCompletedToggle, toast };
})();
