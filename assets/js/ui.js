/* ═══════════════════════════════════════════════════════════════
   UI — Rendering helpers for the Task Tracker dashboard
   ═══════════════════════════════════════════════════════════════ */

const UI = (() => {

  /* ── Formatting helpers ── */
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs  = now - d;
      const diffMin = Math.floor(diffMs / 60000);
      const diffH   = Math.floor(diffMin / 60);
      const diffD   = Math.floor(diffH / 24);

      if (diffMin < 2)  return 'just now';
      if (diffMin < 60) return diffMin + 'm ago';
      if (diffH   < 24) return diffH + 'h ago';
      if (diffD   < 7)  return diffD + 'd ago';
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: diffD > 365 ? 'numeric' : undefined });
    } catch { return ''; }
  }

  function priorityLabel(p) {
    return p === 'urgent' ? '🔴 Urgent' : p === 'medium' ? '🟡 Medium' : '🟢 Low';
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  /* ── Stats ── */
  function renderStats(stats) {
    document.getElementById('s-total').textContent   = stats.total;
    document.getElementById('s-urgent').textContent  = stats.urgent;
    document.getElementById('s-medium').textContent  = stats.medium;
    document.getElementById('s-low').textContent     = stats.low;
    document.getElementById('s-pending').textContent = stats.pending;
    document.getElementById('s-done').textContent    = stats.completed;
    const cc = document.getElementById('s-completed-count');
    if (cc) cc.textContent = stats.completed;
  }

  /* ── Single task card ── */
  function renderTaskCard(task, opts = {}) {
    const isComplete = task.status === 'completed';
    const prioClass  = isComplete ? 'completed' : (task.priority || 'medium');
    const checkIcon  = isComplete ? '✓' : '';

    const assigneeBadge = task.assignee
      ? `<span class="task-tag tag-assignee" title="Assigned to ${escHtml(task.assignee)}">👤 ${escHtml(task.assignee)}</span>`
      : '';
    const sourceBadge = task.source === 'email'
      ? `<span class="task-tag tag-source">✉ Email</span>`
      : `<span class="task-tag tag-source">✏ Manual</span>`;
    const dateBadge = `<span class="task-tag tag-date">${fmtDate(task.updatedAt || task.createdAt)}</span>`;

    return `
      <div class="task-card ${prioClass}" id="card-${escHtml(task.id)}"
           onclick="App.openDetail('${escHtml(task.id)}')" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')App.openDetail('${escHtml(task.id)}')">
        <div class="task-card-top">
          <div class="task-main">
            <div class="task-title">${escHtml(task.title)}</div>
            ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
          </div>
          <button class="task-check-btn"
            onclick="event.stopPropagation(); App.toggleStatus('${escHtml(task.id)}')"
            title="${isComplete ? 'Mark pending' : 'Mark complete'}">${checkIcon}</button>
        </div>
        <div class="task-card-bottom">
          <div class="task-meta">
            ${sourceBadge}
            ${assigneeBadge}
            ${dateBadge}
          </div>
          <button class="task-priority-btn ${isComplete ? 'done' : prioClass}"
            onclick="event.stopPropagation(); App.showPriorityPicker(event, '${escHtml(task.id)}')"
            title="Change priority">${priorityLabel(task.priority)}</button>
        </div>
      </div>`;
  }

  /* ── Priority group ── */
  function renderPriorityGroup(tasks, priority) {
    if (tasks.length === 0) return '';
    const label = priority === 'urgent' ? 'Urgent' : priority === 'medium' ? 'Medium' : 'Low';
    const cards = tasks.map(t => renderTaskCard(t)).join('');
    return `
      <div class="priority-group">
        <div class="priority-group-header pgroup-${priority}">
          <span class="pgroup-dot"></span>
          <span class="pgroup-lbl">${label}</span>
          <span class="badge badge-count">${tasks.length}</span>
        </div>
        ${cards}
      </div>`;
  }

  /* ── Client section ── */
  function renderClientSection(clientName, tasks, allClients, collapsed) {
    const pending   = tasks.filter(t => t.status !== 'completed');
    const urgent    = pending.filter(t => t.priority === 'urgent');
    const medium    = pending.filter(t => t.priority === 'medium');
    const low       = pending.filter(t => t.priority === 'low');

    const idx     = allClients.indexOf(clientName);
    const canUp   = idx > 0;
    const canDown = idx < allClients.length - 1;

    const urgentBadge = urgent.length
      ? `<span class="badge badge-urgent">${urgent.length} urgent</span>` : '';
    const totalBadge  = `<span class="badge badge-count">${pending.length} pending</span>`;

    const cid = 'client-' + clientName.replace(/\W+/g, '_');
    const isCollapsed = collapsed[clientName] !== false;

    return `
      <div class="section-block" id="section-${cid}">
        <div class="section-header" onclick="App.toggleClient('${escHtml(clientName)}')">
          <div class="section-header-left">
            <span class="section-collapse-btn" id="toggle-${cid}"
                  style="transform:${isCollapsed?'rotate(0)':'rotate(90deg)'}">▶</span>
            <span class="section-title">🏢 ${escHtml(clientName)}</span>
            ${urgentBadge}
            ${totalBadge}
          </div>
          <div class="section-header-right section-actions">
            ${canUp   ? `<button class="section-move-btn" onclick="event.stopPropagation();App.moveClient('${escHtml(clientName)}','up')"   title="Move up">↑</button>` : ''}
            ${canDown ? `<button class="section-move-btn" onclick="event.stopPropagation();App.moveClient('${escHtml(clientName)}','down')" title="Move down">↓</button>` : ''}
          </div>
        </div>
        <div class="tasks-grid ${isCollapsed ? 'hidden' : ''}" id="tasks-${cid}">
          ${renderPriorityGroup(urgent, 'urgent')}
          ${renderPriorityGroup(medium, 'medium')}
          ${renderPriorityGroup(low, 'low')}
          ${pending.length === 0 ? '<p style="padding:12px 4px;font-size:.82rem;color:var(--text-muted)">No pending tasks for this client.</p>' : ''}
        </div>
      </div>`;
  }

  /* ── Detail modal ── */
  function renderDetailModal(task) {
    const isComplete = task.status === 'completed';

    /* Actionables */
    const actionablesHtml = (task.actionables || []).length
      ? `<ul class="actionables-list">${task.actionables.map(a => `<li>${escHtml(a)}</li>`).join('')}</ul>`
      : `<p style="color:var(--text-muted);font-size:.85rem">No action items extracted.</p>`;

    /* Email thread */
    const emailsHtml = (task.emails || []).length ? (() => {
      const items = task.emails.map(e => `
        <div class="email-item">
          <div class="email-item-header">
            <span class="email-from">${escHtml(e.from || 'Unknown')}</span>
            <span class="email-date">${fmtDate(e.date)}</span>
          </div>
          <div class="email-subject">${escHtml(e.subject || '')}</div>
          <div class="email-body">${escHtml((e.body || '').slice(0, 1200))}${(e.body||'').length > 1200 ? '\n… [truncated]' : ''}</div>
        </div>`).join('');
      return `
        <div class="email-thread-toggle" onclick="this.nextElementSibling.classList.toggle('hidden')">
          <span>📧 View email thread (${task.emails.length} ${task.emails.length === 1 ? 'email' : 'emails'})</span>
          <span>▼</span>
        </div>
        <div class="email-list hidden">${items}</div>`;
    })() : '';

    /* Assignee inline edit */
    const assigneeHtml = `
      <div class="edit-inline-row" id="assignee-row-${escHtml(task.id)}">
        <input id="assignee-input-${escHtml(task.id)}"
               type="text" list="assignee-datalist"
               value="${escHtml(task.assignee || '')}"
               placeholder="Assign to…"
               onchange="App.updateAssignee('${escHtml(task.id)}', this.value)"
               style="flex:1" />
      </div>`;

    /* Priority inline select */
    const prioSelect = `
      <select id="prio-sel-${escHtml(task.id)}"
              onchange="App.updatePriority('${escHtml(task.id)}', this.value)"
              style="width:100%;padding:8px 10px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.88rem;outline:none">
        <option value="urgent" ${task.priority==='urgent'?'selected':''}>🔴 Urgent</option>
        <option value="medium"  ${task.priority==='medium'?'selected':''}>🟡 Medium</option>
        <option value="low"     ${task.priority==='low'?'selected':''}>🟢 Low</option>
      </select>`;

    const body = `
      <div class="detail-section">
        <div class="detail-title">${escHtml(task.title)}</div>
        ${task.description ? `<div class="detail-desc">${escHtml(task.description)}</div>` : ''}
      </div>

      <div class="detail-section">
        <h4>Details</h4>
        <div class="detail-grid">
          <div class="detail-field">
            <div class="detail-field-label">Priority</div>
            <div class="detail-field-value">${prioSelect}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Assigned To</div>
            <div class="detail-field-value">${assigneeHtml}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Created</div>
            <div class="detail-field-value">${fmtDate(task.createdAt)}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Last Updated</div>
            <div class="detail-field-value">${fmtDate(task.updatedAt)}</div>
          </div>
          ${task.responsiblePerson ? `
          <div class="detail-field">
            <div class="detail-field-label">Next Step Owner</div>
            <div class="detail-field-value">${escHtml(task.responsiblePerson)}</div>
          </div>` : ''}
          ${task.source === 'email' && task.emailSubject ? `
          <div class="detail-field">
            <div class="detail-field-label">Email Subject</div>
            <div class="detail-field-value">${escHtml(task.emailSubject)}</div>
          </div>` : ''}
        </div>
      </div>

      ${task.emailSummary ? `
      <div class="detail-section">
        <h4>Email Thread Summary</h4>
        <div class="detail-desc">${escHtml(task.emailSummary)}</div>
      </div>` : ''}

      <div class="detail-section">
        <h4>Action Items</h4>
        ${actionablesHtml}
      </div>

      ${emailsHtml ? `
      <div class="detail-section">
        <h4>Email Thread</h4>
        ${emailsHtml}
      </div>` : ''}`;

    const footer = `
      <button class="btn-secondary btn-sm" onclick="App.openEditModal('${escHtml(task.id)}')">✏ Edit</button>
      <button class="btn-${isComplete ? 'secondary' : 'primary'} btn-sm"
              onclick="App.toggleStatus('${escHtml(task.id)}');App.closeModal('detail-modal')">
        ${isComplete ? '↩ Mark Pending' : '✓ Mark Complete'}
      </button>`;

    /* Set badges in header */
    const cb = document.getElementById('d-client-badge');
    const pb = document.getElementById('d-priority-badge');
    if (cb) cb.textContent = task.clientName || '';
    if (pb) {
      pb.textContent  = priorityLabel(task.priority);
      pb.className    = `priority-badge ${isComplete ? 'done' : (task.priority || 'medium')}`;
    }

    document.getElementById('detail-modal-body').innerHTML   = body;
    document.getElementById('detail-modal-footer').innerHTML = footer;

    /* Refresh assignee datalist */
    const dl = document.getElementById('assignee-datalist');
    if (dl) {
      dl.innerHTML = DB.getAssignees().map(a => `<option value="${escHtml(a)}">`).join('');
    }
  }

  /* ── Toast ── */
  function toast(msg, type = 'info', durationMs = 3000) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el  = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 250);
    }, durationMs);
  }

  /* ── Confirm dialog ── */
  function confirm(title, message) {
    return new Promise(resolve => {
      const d = document.getElementById('confirm-dialog');
      document.getElementById('confirm-title').textContent   = title;
      document.getElementById('confirm-message').textContent = message;
      d.classList.remove('hidden');
      const ok  = document.getElementById('confirm-ok');
      const can = document.getElementById('confirm-cancel');
      const cleanup = (val) => { d.classList.add('hidden'); ok.onclick = null; can.onclick = null; resolve(val); };
      ok.onclick  = () => cleanup(true);
      can.onclick = () => cleanup(false);
    });
  }

  /* ── Priority picker popup ── */
  let _pickerEl = null;
  function showPriorityPicker(anchorEl, taskId) {
    hidePriorityPicker();
    const el = document.createElement('div');
    el.className = 'priority-picker';
    const priorities = [
      { v: 'urgent', l: '🔴 Urgent' },
      { v: 'medium', l: '🟡 Medium' },
      { v: 'low',    l: '🟢 Low' },
    ];
    el.innerHTML = priorities.map(p =>
      `<button class="priority-picker-item"
               onclick="App.updatePriority('${taskId}','${p.v}');UI.hidePriorityPicker()">${p.l}</button>`
    ).join('');

    const rect = anchorEl.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.top  = (rect.bottom + 4) + 'px';
    el.style.left = Math.min(rect.left, window.innerWidth - 150) + 'px';
    document.body.appendChild(el);
    _pickerEl = el;

    setTimeout(() => document.addEventListener('click', hidePriorityPicker, { once: true }), 0);
  }

  function hidePriorityPicker() {
    if (_pickerEl) { _pickerEl.remove(); _pickerEl = null; }
  }

  /* ── Sync badge ── */
  function setSyncBadge(text, cls = '') {
    const el = document.getElementById('sync-badge');
    if (!el) return;
    el.textContent = text;
    el.className = 'sync-badge' + (cls ? ' ' + cls : '');
  }

  /* ── Last updated ── */
  function setLastUpdated(lastUpdated, lastEmailDate) {
    const el = document.getElementById('last-updated');
    if (!el) return;
    if (lastUpdated) {
      el.textContent = 'Data: ' + fmtDate(lastUpdated)
        + (lastEmailDate ? ' · Emails to: ' + fmtDate(lastEmailDate) : '');
    } else {
      el.textContent = 'No email data yet — trigger initial workflow';
    }
  }

  return {
    renderStats, renderTaskCard, renderClientSection,
    renderDetailModal,
    toast, confirm,
    showPriorityPicker, hidePriorityPicker,
    setSyncBadge, setLastUpdated,
    fmtDate, escHtml,
  };
})();
