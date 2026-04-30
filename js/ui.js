const UI = {
  filter: 'all',
  q: '',
  taskId: null,
  expanded: new Set(),

  init() { this._bind(); this.render(); },

  _bind() {
    document.getElementById('search-input').addEventListener('input', e => { this.q = e.target.value; this.renderTasks(); });
    document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active'); this.filter = c.dataset.filter; this.renderTasks();
    }));
    document.getElementById('add-task-btn').addEventListener('click', () => this.openAdd());
    document.getElementById('sync-btn').addEventListener('click', () => Sync.run());
    document.getElementById('lock-btn').addEventListener('click', () => App.lock());
  },

  render() { this._stats(); this.renderTasks(); },

  _stats() {
    const s = DB.stats();
    document.getElementById('stat-total').textContent = s.total;
    document.getElementById('stat-pending').textContent = s.pending;
    document.getElementById('stat-completed').textContent = s.completed;
    document.getElementById('stat-urgent').textContent = s.urgent;
    document.getElementById('stat-medium').textContent = s.medium;
    document.getElementById('stat-low').textContent = s.low;
  },

  renderTasks() {
    const all = Tasks.filtered({ q: this.q, filter: this.filter });
    const pending = all.filter(t => t.status === 'pending');
    const done = all.filter(t => t.status === 'completed');
    const map = {};
    pending.forEach(t => { if (!map[t.client]) map[t.client] = []; map[t.client].push(t); });
    const po = { urgent: 0, medium: 1, low: 2 };
    Object.values(map).forEach(arr => arr.sort((a, b) => (po[a.priority] ?? 1) - (po[b.priority] ?? 1)));
    const cont = document.getElementById('clients-container');
    cont.innerHTML = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, tasks]) => this._clientHTML(name, tasks)).join('');
    this.expanded.forEach(name => {
      const el = document.getElementById('ct-' + this._eid(name));
      const ch = document.getElementById('ch-' + this._eid(name));
      if (el) { el.style.display = 'flex'; ch?.classList.add('open'); }
    });
    this._renderDone(done);
    this._updateDatalist();
    this._stats();
  },

  _clientHTML(name, tasks) {
    const ini = name.split(' ').map(w => w[0]).join('').substr(0, 2).toUpperCase();
    const urg = tasks.filter(t => t.priority === 'urgent').length;
    const badge = urg ? `<span style="color:var(--urgent);font-size:10px;margin-left:6px">&#9679; ${urg} urgent</span>` : '';
    const eid = this._eid(name);
    return `<div class="client-section" data-client="${this._e(name)}">
  <div class="client-header" onclick="UI.toggleClient('${this._e(name)}')">
    <div class="client-info">
      <div class="client-icon">${ini}</div>
      <div><h3 class="client-name">${this._e(name)}${badge}</h3><span class="task-count">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span></div>
    </div>
    <svg class="chevron" id="ch-${eid}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
  </div>
  <div class="tasks-container" id="ct-${eid}" style="display:none">${tasks.map(t => this._cardHTML(t)).join('')}</div>
</div>`;
  },

  _cardHTML(t) {
    const d = new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const ass = t.assignee ? `<span class="assignee-chip">&#128100; ${this._e(t.assignee)}</span>` : '';
    const src = t.source === 'email' ? '<span style="font-size:10px;color:var(--text3)">&#128231;</span>' : '';
    return `<div class="task-card ${t.priority}" onclick="UI.openTask('${t.id}')">
  <div class="task-card-top"><span class="task-title">${this._e(t.title)}</span>
    <div class="task-cb ${t.status === 'completed' ? 'checked' : ''}" onclick="event.stopPropagation();UI.toggle('${t.id}')">&#10003;</div>
  </div>
  <div class="task-meta"><span class="priority-badge ${t.priority}">${t.priority}</span>${ass}${src}<span class="task-date">${d}</span></div>
</div>`;
  },

  _renderDone(tasks) {
    document.getElementById('completed-count').textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;
    const c = document.getElementById('completed-tasks');
    if (!tasks.length) { c.innerHTML = '<p style="color:var(--text3);font-size:12px;padding:14px;text-align:center">No completed tasks yet</p>'; return; }
    tasks.sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt));
    c.innerHTML = tasks.map(t => {
      const d = new Date(t.completedAt || t.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      return `<div class="task-card ${t.priority} done-card" onclick="UI.openTask('${t.id}')">
  <div class="task-card-top"><span class="task-title">${this._e(t.title)}</span>
    <div class="task-cb checked" onclick="event.stopPropagation();UI.toggle('${t.id}')">&#10003;</div>
  </div>
  <div class="task-meta"><span class="priority-badge ${t.priority}">${t.priority}</span><span style="font-size:11px;color:var(--text2)">${this._e(t.client)}</span><span class="task-date">${d}</span></div>
</div>`;
    }).join('');
  },

  toggleClient(name) {
    const el = document.getElementById('ct-' + this._eid(name));
    const ch = document.getElementById('ch-' + this._eid(name));
    if (!el) return;
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'flex';
    ch?.classList.toggle('open', !open);
    open ? this.expanded.delete(name) : this.expanded.add(name);
  },

  toggleSection(id) {
    const el = document.getElementById(id + '-tasks');
    const ch = document.getElementById('chevron-' + id);
    if (!el) return;
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'flex';
    ch?.classList.toggle('open', !open);
  },

  toggle(id) {
    const t = DB.getTask(id); if (!t) return;
    t.status === 'completed' ? Tasks.reopen(id) : Tasks.complete(id);
    this.render();
  },

  openTask(id) {
    const t = DB.getTask(id); if (!t) return;
    this.taskId = id;
    document.getElementById('modal-title').textContent = t.title;
    document.getElementById('modal-client').textContent = t.client;
    const b = document.getElementById('modal-priority-badge');
    b.className = 'priority-badge ' + t.priority; b.textContent = t.priority;
    document.getElementById('modal-summary').textContent = t.description || 'No description.';
    const ul = document.getElementById('modal-actionables');
    ul.innerHTML = t.actionables?.length ? t.actionables.map(a => `<li>${this._e(a)}</li>`).join('') : '<li style="color:var(--text3)">None</li>';
    document.getElementById('modal-responsible').textContent = t.responsiblePerson || 'Not specified';
    document.getElementById('modal-assignee-input').value = t.assignee || '';
    document.getElementById('modal-email-summary').textContent = t.emailSummary || 'No email thread.';
    const btn = document.getElementById('modal-complete-btn');
    btn.textContent = t.status === 'completed' ? 'Mark Pending' : 'Mark Complete';
    document.getElementById('task-modal').classList.remove('hidden');
  },

  openAdd() {
    document.getElementById('add-task-modal').classList.remove('hidden');
  },

  closeModal(id) { document.getElementById(id).classList.add('hidden'); },

  saveAssignee() {
    const v = document.getElementById('modal-assignee-input').value.trim();
    if (this.taskId) { Tasks.update(this.taskId, { assignee: v }); this.render(); }
  },

  setTaskPriority(p) {
    if (!this.taskId) return;
    Tasks.update(this.taskId, { priority: p });
    const b = document.getElementById('modal-priority-badge');
    b.className = 'priority-badge ' + p; b.textContent = p;
    this.render();
  },

  toggleTaskComplete() {
    if (this.taskId) { this.toggle(this.taskId); this.closeModal('task-modal'); }
  },

  deleteCurrentTask() {
    if (this.taskId && confirm('Delete this task?')) {
      Tasks.remove(this.taskId); this.closeModal('task-modal'); this.render();
    }
  },

  saveNewTask() {
    const title = document.getElementById('new-task-title').value.trim();
    const client = document.getElementById('new-task-client').value.trim();
    if (!title || !client) { alert('Title and client name are required.'); return; }
    Tasks.create({
      title, client,
      description: document.getElementById('new-task-desc').value.trim(),
      priority: document.getElementById('new-task-priority').value,
      assignee: document.getElementById('new-task-assignee').value.trim(),
      actionables: document.getElementById('new-task-actionables').value.split('\n').map(s => s.trim()).filter(Boolean)
    });
    ['new-task-title','new-task-client','new-task-desc','new-task-assignee','new-task-actionables'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('new-task-priority').value = 'medium';
    this.closeModal('add-task-modal'); this.render();
  },

  _updateDatalist() {
    const dl = document.getElementById('clients-datalist');
    if (dl) dl.innerHTML = DB.clientList().map(c => `<option value="${this._e(c)}">`).join('');
  },

  _eid(s) { return btoa(unescape(encodeURIComponent(s))).replace(/[^a-zA-Z0-9]/g, ''); },
  _e(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
};
