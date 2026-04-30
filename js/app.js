/**
 * Sabhya's Task Tracker — frontend application
 * Pattern lock auth + dashboard powered by data/tasks.json
 */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const STATE = {
  db: { version: 1, lastSync: null, isFirstRun: true, tasks: [], clients: [], employees: [], processedThreadIds: [] },
  filters: { status: 'all', priority: 'all', employee: 'all', client: 'all', search: '' },
  refreshTimer: null,
  pendingEditId: null,
  patternSetup: { step: 1, firstPattern: null }
};

// ── Storage keys ──────────────────────────────────────────────────────────────
const K = {
  PATTERN_HASH:   'stt_pattern_hash',
  SETUP_DONE:     'stt_setup_done',
  GH_PAT:         'stt_gh_pat',
  GH_OWNER:       'stt_gh_owner',
  GH_REPO:        'stt_gh_repo',
  GH_BRANCH:      'stt_gh_branch',
  LOCAL_TASKS:    'stt_local_tasks',
  LOCAL_OVERRIDES:'stt_local_overrides',
  EXPANDED_CLIENTS:'stt_expanded_clients'
};

// ── Utility ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function showToast(msg, duration = 2500) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

async function hashPattern(patternStr) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(patternStr + ':stt-v1'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}

function genId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
}

// ── Client color palette ──────────────────────────────────────────────────────
const CLIENT_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#a855f7'];
function clientColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return CLIENT_COLORS[Math.abs(h) % CLIENT_COLORS.length];
}

// ── Pattern Lock ──────────────────────────────────────────────────────────────
class PatternLock {
  constructor(canvasId, size = 280) {
    this.canvas  = $(canvasId);
    this.ctx     = this.canvas.getContext('2d');
    this.size    = size;
    this.dots    = [];
    this.active  = [];
    this.drawing = false;
    this.color   = '#6366f1';
    this.onComplete = null;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width  = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.scale(dpr, dpr);

    this._buildDots();
    this._draw();
    this._bindEvents();
  }

  _buildDots() {
    const pad = 46, step = (this.size - pad * 2) / 2;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        this.dots.push({ x: pad + c * step, y: pad + r * step, idx: r * 3 + c });
  }

  _draw(mx, my) {
    const ctx = this.ctx, s = this.size;
    ctx.clearRect(0, 0, s, s);

    // Lines between active dots
    if (this.active.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.dots[this.active[0]].x, this.dots[this.active[0]].y);
      for (let i = 1; i < this.active.length; i++)
        ctx.lineTo(this.dots[this.active[i]].x, this.dots[this.active[i]].y);
      if (this.drawing && mx !== undefined)
        ctx.lineTo(mx, my);
      ctx.strokeStyle = this.color + 'aa';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (this.active.length === 1 && this.drawing && mx !== undefined) {
      const d = this.dots[this.active[0]];
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(mx, my);
      ctx.strokeStyle = this.color + '66';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Dots
    this.dots.forEach(d => {
      const isActive = this.active.includes(d.idx);
      ctx.beginPath();
      ctx.arc(d.x, d.y, isActive ? 11 : 7, 0, Math.PI * 2);
      if (isActive) {
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 12;
      } else {
        ctx.fillStyle = '#2d3748';
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isActive) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    });
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  _nearDot(x, y) {
    return this.dots.find(d => Math.hypot(d.x - x, d.y - y) < 22) || null;
  }

  _bindEvents() {
    const start = e => { e.preventDefault(); this.drawing = true; this.active = []; const p = this._pos(e); this._move(p.x, p.y); };
    const move  = e => { e.preventDefault(); if (!this.drawing) return; const p = this._pos(e); this._move(p.x, p.y); this._draw(p.x, p.y); };
    const end   = e => { e.preventDefault(); if (!this.drawing) return; this.drawing = false; this._draw(); this._finish(); };

    this.canvas.addEventListener('mousedown',  start, { passive: false });
    this.canvas.addEventListener('mousemove',  move,  { passive: false });
    this.canvas.addEventListener('mouseup',    end,   { passive: false });
    this.canvas.addEventListener('touchstart', start, { passive: false });
    this.canvas.addEventListener('touchmove',  move,  { passive: false });
    this.canvas.addEventListener('touchend',   end,   { passive: false });
  }

  _move(x, y) {
    const d = this._nearDot(x, y);
    if (d && !this.active.includes(d.idx)) {
      this.active.push(d.idx);
      this._draw(x, y);
    }
  }

  _finish() {
    if (this.active.length < 4) {
      this.setError('Connect at least 4 dots');
      setTimeout(() => this.reset(), 800);
      return;
    }
    if (this.onComplete) this.onComplete(this.active.join('-'));
  }

  setColor(c) { this.color = c; this._draw(); }
  setError(msg) { this.setColor('#ef4444'); const m = $('auth-message'); if (m) { m.textContent = msg; m.className = 'auth-message error'; } }
  setSuccess(msg) { this.setColor('#10b981'); const m = $('auth-message'); if (m) { m.textContent = msg; m.className = 'auth-message success'; } }
  setInfo(msg) { this.setColor('#6366f1'); const m = $('auth-message'); if (m) { m.textContent = msg; m.className = 'auth-message info'; } }
  reset() { this.active = []; this.drawing = false; this.setColor('#6366f1'); this._draw(); const m = $('auth-message'); if (m) { m.textContent = ''; m.className = 'auth-message'; } }
}

// ── Auth flow ─────────────────────────────────────────────────────────────────
let lock;

async function initAuth() {
  lock = new PatternLock('pattern-canvas', 280);
  const setupDone  = localStorage.getItem(K.SETUP_DONE);
  const patternHash = localStorage.getItem(K.PATTERN_HASH);

  if (!setupDone || !patternHash) {
    // First time: set pattern
    $('auth-subtitle').textContent = 'Set a new unlock pattern (connect ≥ 4 dots)';
    STATE.patternSetup.step = 1;
    lock.setInfo('Draw your new pattern');

    lock.onComplete = async (pattern) => {
      if (STATE.patternSetup.step === 1) {
        STATE.patternSetup.firstPattern = pattern;
        STATE.patternSetup.step = 2;
        lock.setSuccess('Pattern recorded! Draw it again to confirm');
        $('auth-subtitle').textContent = 'Confirm your pattern';
        setTimeout(() => lock.reset(), 600);
      } else {
        if (pattern === STATE.patternSetup.firstPattern) {
          const h = await hashPattern(pattern);
          localStorage.setItem(K.PATTERN_HASH, h);
          localStorage.setItem(K.SETUP_DONE, '1');
          lock.setSuccess('Pattern set!');
          setTimeout(() => unlockDashboard(), 700);
        } else {
          STATE.patternSetup.step = 1;
          STATE.patternSetup.firstPattern = null;
          lock.setError("Patterns don't match. Start again.");
          $('auth-subtitle').textContent = 'Set a new unlock pattern (connect ≥ 4 dots)';
          setTimeout(() => lock.reset(), 900);
        }
      }
    };
  } else {
    // Return visit: verify pattern
    $('auth-subtitle').textContent = 'Draw your pattern to unlock';
    let attempts = 0;

    lock.onComplete = async (pattern) => {
      const h = await hashPattern(pattern);
      if (h === patternHash) {
        lock.setSuccess('Unlocked!');
        setTimeout(() => unlockDashboard(), 500);
      } else {
        attempts++;
        if (attempts >= 5) {
          lock.setError('Too many attempts. Reset the app.');
        } else {
          lock.setError(`Wrong pattern (${5 - attempts} attempts left)`);
          setTimeout(() => lock.reset(), 900);
        }
      }
    };
  }

  showScreen('auth-screen');
}

async function unlockDashboard() {
  showScreen('dashboard-screen');
  await loadAndRender();
  startAutoRefresh();
}

function lockDashboard() {
  stopAutoRefresh();
  // Re-init auth for next unlock
  showScreen('auth-screen');
  lock.reset();
  const patternHash = localStorage.getItem(K.PATTERN_HASH);
  $('auth-subtitle').textContent = 'Draw your pattern to unlock';
  let attempts = 0;
  lock.onComplete = async (pattern) => {
    const h = await hashPattern(pattern);
    if (h === patternHash) {
      lock.setSuccess('Unlocked!');
      setTimeout(() => unlockDashboard(), 500);
    } else {
      attempts++;
      lock.setError(`Wrong pattern (${5 - attempts} attempts left)`);
      setTimeout(() => lock.reset(), 900);
    }
  };
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadAndRender() {
  $('sync-time').textContent = 'Loading…';
  try {
    const url = `./data/tasks.json?t=${Date.now()}`;
    const res  = await fetch(url);
    if (res.ok) {
      const remote = await res.json();
      mergeRemoteData(remote);
    }
  } catch (_) {
    // Offline or no remote file yet — use local data only
  }
  applyLocalOverrides();
  renderAll();
  updateSyncTime();
}

function mergeRemoteData(remote) {
  // Merge remote (Actions-generated) tasks with local manual tasks
  const localOverrides = JSON.parse(localStorage.getItem(K.LOCAL_OVERRIDES) || '{}');
  const localTasks     = JSON.parse(localStorage.getItem(K.LOCAL_TASKS) || '[]');

  const merged = [...(remote.tasks || [])];

  // Apply local field overrides (priority, assignedTo, status, notes)
  merged.forEach((t, i) => {
    const ov = localOverrides[t.id];
    if (ov) merged[i] = { ...t, ...ov };
  });

  // Add local-only manual tasks (not in remote)
  const remoteIds = new Set(merged.map(t => t.id));
  localTasks.forEach(lt => {
    if (!remoteIds.has(lt.id)) merged.push(lt);
  });

  STATE.db = {
    ...remote,
    tasks: merged,
    clients: deriveClients(merged),
    employees: deriveEmployees(merged)
  };
}

function applyLocalOverrides() {
  const localOverrides = JSON.parse(localStorage.getItem(K.LOCAL_OVERRIDES) || '{}');
  const localTasks     = JSON.parse(localStorage.getItem(K.LOCAL_TASKS) || '[]');

  if (!STATE.db.tasks) STATE.db.tasks = [];
  const remoteIds = new Set(STATE.db.tasks.map(t => t.id));

  // Apply overrides to existing tasks
  STATE.db.tasks = STATE.db.tasks.map(t => {
    const ov = localOverrides[t.id];
    return ov ? { ...t, ...ov } : t;
  });

  // Add purely local tasks
  localTasks.forEach(lt => {
    if (!remoteIds.has(lt.id)) STATE.db.tasks.push(lt);
  });

  STATE.db.clients   = deriveClients(STATE.db.tasks);
  STATE.db.employees = deriveEmployees(STATE.db.tasks);
}

function deriveClients(tasks) {
  return [...new Set(tasks.filter(t => t.status !== 'completed' || true).map(t => t.clientName).filter(Boolean))].sort();
}
function deriveEmployees(tasks) {
  return [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))].sort();
}

// ── Persist user changes ──────────────────────────────────────────────────────
function saveTaskOverride(id, fields) {
  const ov = JSON.parse(localStorage.getItem(K.LOCAL_OVERRIDES) || '{}');
  ov[id] = { ...(ov[id] || {}), ...fields };
  localStorage.setItem(K.LOCAL_OVERRIDES, JSON.stringify(ov));

  // Also update in-memory state immediately
  const idx = STATE.db.tasks.findIndex(t => t.id === id);
  if (idx >= 0) STATE.db.tasks[idx] = { ...STATE.db.tasks[idx], ...fields };

  // Try GitHub API write if PAT available
  pushToGitHub();
}

function saveManualTask(task) {
  const local = JSON.parse(localStorage.getItem(K.LOCAL_TASKS) || '[]');
  const existIdx = local.findIndex(t => t.id === task.id);
  if (existIdx >= 0) local[existIdx] = task;
  else               local.push(task);
  localStorage.setItem(K.LOCAL_TASKS, JSON.stringify(local));

  const idx = STATE.db.tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) STATE.db.tasks[idx] = task;
  else          STATE.db.tasks.push(task);

  STATE.db.clients   = deriveClients(STATE.db.tasks);
  STATE.db.employees = deriveEmployees(STATE.db.tasks);

  pushToGitHub();
}

async function pushToGitHub() {
  const pat    = localStorage.getItem(K.GH_PAT);
  const owner  = localStorage.getItem(K.GH_OWNER);
  const repo   = localStorage.getItem(K.GH_REPO);
  const branch = localStorage.getItem(K.GH_BRANCH) || 'main';
  if (!pat || !owner || !repo) return;

  try {
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/data/tasks.json`;
    const shaRes  = await fetch(apiBase, { headers: { Authorization: `token ${pat}` } });
    const shaData = shaRes.ok ? await shaRes.json() : {};
    const sha     = shaData.sha;

    // Build the full merged db for persistence
    const dbToSave = {
      ...STATE.db,
      tasks: STATE.db.tasks,
      clients: deriveClients(STATE.db.tasks),
      employees: deriveEmployees(STATE.db.tasks)
    };

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(dbToSave, null, 2))));
    const body = { message: 'Update tasks from dashboard', content, branch };
    if (sha) body.sha = sha;

    await fetch(apiBase, {
      method: 'PUT',
      headers: { Authorization: `token ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn('GitHub push failed (will retry on next change):', e.message);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderFilters();
  renderClients();
  renderCompleted();
}

function getFilteredTasks(includeCompleted = false) {
  const { status, priority, employee, client, search } = STATE.filters;
  const q = search.toLowerCase();
  return STATE.db.tasks.filter(t => {
    if (!includeCompleted && t.status === 'completed') return false;
    if (includeCompleted && t.status !== 'completed')  return false;
    if (status   !== 'all' && t.status   !== status)   return false;
    if (priority !== 'all' && t.priority !== priority) return false;
    if (employee !== 'all' && t.assignedTo !== employee) return false;
    if (client   !== 'all' && t.clientName !== client) return false;
    if (q && !(
      (t.subject     || '').toLowerCase().includes(q) ||
      (t.clientName  || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.assignedTo  || '').toLowerCase().includes(q) ||
      (t.summary     || '').toLowerCase().includes(q)
    )) return false;
    return true;
  });
}

function renderStats() {
  const all     = STATE.db.tasks;
  const pending = all.filter(t => t.status === 'pending');
  $('stat-total').querySelector('.stat-value').textContent     = all.length;
  $('stat-urgent').querySelector('.stat-value').textContent    = pending.filter(t => t.priority === 'urgent').length;
  $('stat-medium').querySelector('.stat-value').textContent    = pending.filter(t => t.priority === 'medium').length;
  $('stat-low').querySelector('.stat-value').textContent       = pending.filter(t => t.priority === 'low').length;
  $('stat-completed').querySelector('.stat-value').textContent = all.filter(t => t.status === 'completed').length;
}

function renderFilters() {
  const empSel = $('filter-employee');
  const cliSel = $('filter-client');
  const dlistCli  = $('clients-datalist');
  const dlistEmp  = $('employees-datalist');

  // Employees dropdown
  const curEmp = empSel.value;
  empSel.innerHTML = '<option value="all">All Employees</option>';
  STATE.db.employees.forEach(e => {
    const o = document.createElement('option');
    o.value = e; o.textContent = e;
    if (e === curEmp) o.selected = true;
    empSel.appendChild(o);
  });

  // Clients dropdown
  const curCli = cliSel.value;
  cliSel.innerHTML = '<option value="all">All Clients</option>';
  STATE.db.clients.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === curCli) o.selected = true;
    cliSel.appendChild(o);
  });

  // Datalists for form inputs
  if (dlistCli) {
    dlistCli.innerHTML = '';
    STATE.db.clients.forEach(c => { const o = document.createElement('option'); o.value = c; dlistCli.appendChild(o); });
  }
  if (dlistEmp) {
    dlistEmp.innerHTML = '';
    STATE.db.employees.forEach(e => { const o = document.createElement('option'); o.value = e; dlistEmp.appendChild(o); });
  }
}

function renderClients() {
  const container = $('main-content');
  const empty     = $('empty-state');
  const tasks     = getFilteredTasks(false);

  // Group by client
  const byClient = {};
  tasks.forEach(t => {
    const c = t.clientName || 'Unknown';
    if (!byClient[c]) byClient[c] = [];
    byClient[c].push(t);
  });

  const clientNames = Object.keys(byClient).sort((a, b) => {
    // Sort by urgent count desc, then name
    const urgA = byClient[a].filter(t => t.priority === 'urgent').length;
    const urgB = byClient[b].filter(t => t.priority === 'urgent').length;
    return urgB - urgA || a.localeCompare(b);
  });

  // Remove old sections (keep empty-state)
  container.querySelectorAll('.client-section').forEach(el => el.remove());

  if (clientNames.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const expanded = JSON.parse(localStorage.getItem(K.EXPANDED_CLIENTS) || '{}');

  clientNames.forEach(clientName => {
    const clientTasks = byClient[clientName];
    const urgentCount = clientTasks.filter(t => t.priority === 'urgent').length;
    const isExpanded  = expanded[clientName] !== false; // default open
    const color       = clientColor(clientName);

    const section = document.createElement('div');
    section.className = `client-section${isExpanded ? ' expanded' : ''}`;
    section.dataset.client = clientName;

    section.innerHTML = `
      <div class="client-header" data-client="${clientName}">
        <div class="client-color-bar" style="background:${color}"></div>
        <div class="client-info">
          <div class="client-name">${esc(clientName)}</div>
          <div class="client-meta">${clientTasks.length} task${clientTasks.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="client-badges">
          ${urgentCount ? `<span class="count-badge urgent-badge">${urgentCount} urgent</span>` : ''}
          <span class="count-badge">${clientTasks.length}</span>
        </div>
        <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="client-tasks">
        ${clientTasks
          .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))
          .map(t => taskCardHTML(t))
          .join('')}
      </div>`;

    section.querySelector('.client-header').addEventListener('click', () => toggleClient(section, clientName));
    section.querySelectorAll('.task-card').forEach(card => {
      card.querySelector('.task-check').addEventListener('click', e => { e.stopPropagation(); toggleTaskStatus(card.dataset.id); });
      card.addEventListener('click', () => openTaskModal(card.dataset.id));
    });

    container.appendChild(section);
  });
}

function priorityOrder(p) { return p === 'urgent' ? 0 : p === 'medium' ? 1 : 2; }

function taskCardHTML(t) {
  const isCompleted = t.status === 'completed';
  return `
    <div class="task-card${isCompleted ? ' completed' : ''}" data-id="${t.id}">
      <div class="task-check" title="${isCompleted ? 'Mark pending' : 'Mark complete'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="task-body">
        <div class="task-subject">${esc(t.subject || 'No subject')}</div>
        <div class="task-meta">
          <span class="priority-badge ${t.priority}">${t.priority}</span>
          ${t.assignedTo ? `<span class="task-assignee"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${esc(t.assignedTo)}</span>` : ''}
          ${t.emailMessageCount ? `<span class="task-email-count">✉ ${t.emailMessageCount}</span>` : ''}
          <span class="task-date">${fmtRelative(t.updatedAt || t.createdAt)}</span>
        </div>
      </div>
    </div>`;
}

function renderCompleted() {
  const tasks   = getFilteredTasks(true);
  const toggle  = $('completed-toggle');
  const section = document.getElementById('completed-section');
  const count   = $('completed-count');
  const box     = $('completed-tasks');

  count.textContent = tasks.length;
  if (tasks.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  box.innerHTML = tasks
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(t => taskCardHTML(t))
    .join('');

  box.querySelectorAll('.task-card').forEach(card => {
    card.querySelector('.task-check').addEventListener('click', e => { e.stopPropagation(); toggleTaskStatus(card.dataset.id); });
    card.addEventListener('click', () => openTaskModal(card.dataset.id));
  });

  // Restore open/close state
  const open = section.classList.contains('open');
  box.style.display = open ? '' : 'none';
}

function toggleClient(section, name) {
  section.classList.toggle('expanded');
  const expanded = JSON.parse(localStorage.getItem(K.EXPANDED_CLIENTS) || '{}');
  expanded[name] = section.classList.contains('expanded');
  localStorage.setItem(K.EXPANDED_CLIENTS, JSON.stringify(expanded));
}

// ── Task interactions ─────────────────────────────────────────────────────────
function toggleTaskStatus(id) {
  const task = STATE.db.tasks.find(t => t.id === id);
  if (!task) return;
  const newStatus = task.status === 'completed' ? 'pending' : 'completed';
  saveTaskOverride(id, { status: newStatus, manualOverrides: { ...(task.manualOverrides || {}), status: true } });
  renderAll();
  showToast(newStatus === 'completed' ? 'Task marked complete ✓' : 'Task moved back to pending');
}

function openTaskModal(id) {
  const t = STATE.db.tasks.find(t => t.id === id);
  if (!t) return;

  $('modal-task-subject').textContent = t.subject || 'Task Details';

  const body = $('modal-task-body');
  body.innerHTML = `
    <div>
      <div class="detail-priority">
        <span class="priority-dot ${t.priority}"></span>
        <span class="priority-badge ${t.priority}">${t.priority}</span>
        <span style="color:var(--text-muted);font-size:13px;margin-left:4px">${t.clientName}</span>
      </div>
    </div>
    <div class="detail-meta-grid">
      <div class="detail-meta-item">
        <label>Assigned To</label>
        <span class="${t.assignedTo ? '' : 'empty'}">${esc(t.assignedTo || 'Unassigned')}</span>
      </div>
      <div class="detail-meta-item">
        <label>Next Step: Who?</label>
        <span class="${t.nextStepPerson ? '' : 'empty'}">${esc(t.nextStepPerson || '—')}</span>
      </div>
      <div class="detail-meta-item">
        <label>Created</label>
        <span>${fmtDate(t.createdAt)}</span>
      </div>
      <div class="detail-meta-item">
        <label>Last Updated</label>
        <span>${fmtDate(t.updatedAt)}</span>
      </div>
      ${t.emailMessageCount ? `<div class="detail-meta-item"><label>Email Thread</label><span>${t.emailMessageCount} email${t.emailMessageCount !== 1 ? 's' : ''}</span></div>` : ''}
    </div>

    ${t.summary ? `
    <div class="detail-section">
      <h4>Thread Summary</h4>
      <p>${esc(t.summary)}</p>
    </div>` : ''}

    ${t.description ? `
    <div class="detail-section">
      <h4>Task Description</h4>
      <p>${esc(t.description)}</p>
    </div>` : ''}

    ${t.actionables && t.actionables.length ? `
    <div class="detail-section">
      <h4>Action Items</h4>
      <div class="actionables">
        ${t.actionables.map(a => `<div class="action-item">${esc(a)}</div>`).join('')}
      </div>
    </div>` : ''}

    ${t.notes ? `
    <div class="detail-section">
      <h4>Notes</h4>
      <p>${esc(t.notes)}</p>
    </div>` : ''}

    <div class="detail-actions">
      <button class="btn-secondary btn-sm" onclick="openEditModal('${t.id}'); closeTaskModal();">Edit</button>
      <button class="btn-secondary btn-sm" onclick="changePriority('${t.id}')">Change Priority</button>
      <button class="btn-${t.status === 'completed' ? 'secondary' : 'primary'} btn-sm" onclick="toggleTaskStatus('${t.id}'); closeTaskModal();">
        ${t.status === 'completed' ? '↩ Mark Pending' : '✓ Mark Complete'}
      </button>
    </div>`;

  $('task-modal').style.display = 'flex';
}

function closeTaskModal() { $('task-modal').style.display = 'none'; }

function changePriority(id) {
  const task = STATE.db.tasks.find(t => t.id === id);
  if (!task) return;
  const order = ['urgent', 'medium', 'low'];
  const next  = order[(order.indexOf(task.priority) + 1) % 3];
  saveTaskOverride(id, { priority: next, manualOverrides: { ...(task.manualOverrides || {}), priority: true } });
  closeTaskModal();
  renderAll();
  showToast(`Priority changed to ${next}`);
}

// ── Add / Edit task modal ─────────────────────────────────────────────────────
function openEditModal(editId) {
  STATE.pendingEditId = editId || null;
  const t = editId ? STATE.db.tasks.find(x => x.id === editId) : null;

  $('edit-modal-title').textContent = t ? 'Edit Task' : 'Add New Task';
  $('edit-task-id').value      = t ? t.id : '';
  $('edit-client').value       = t ? (t.clientName || '') : '';
  $('edit-subject').value      = t ? (t.subject || '') : '';
  $('edit-description').value  = t ? (t.description || '') : '';
  $('edit-priority').value     = t ? (t.priority || 'medium') : 'medium';
  $('edit-assignee').value     = t ? (t.assignedTo || '') : '';
  $('edit-notes').value        = t ? (t.notes || '') : '';

  $('edit-modal').style.display = 'flex';
}

function closeEditModal() { $('edit-modal').style.display = 'none'; STATE.pendingEditId = null; }

$('task-form').addEventListener('submit', e => {
  e.preventDefault();
  const id      = $('edit-task-id').value;
  const client  = $('edit-client').value.trim();
  const subject = $('edit-subject').value.trim();
  if (!client || !subject) return;

  const now = new Date().toISOString();
  if (id) {
    // Edit existing
    const existing = STATE.db.tasks.find(t => t.id === id);
    const updated = {
      ...existing,
      clientName:  client,
      subject,
      description: $('edit-description').value.trim(),
      priority:    $('edit-priority').value,
      assignedTo:  $('edit-assignee').value.trim(),
      notes:       $('edit-notes').value.trim(),
      updatedAt:   now,
      manualOverrides: { priority: true, assignedTo: true, status: (existing.manualOverrides||{}).status || false }
    };
    if (existing.type === 'manual') {
      saveManualTask(updated);
    } else {
      saveTaskOverride(id, {
        clientName: updated.clientName, subject: updated.subject,
        description: updated.description, priority: updated.priority,
        assignedTo: updated.assignedTo, notes: updated.notes,
        manualOverrides: updated.manualOverrides, updatedAt: now
      });
    }
    showToast('Task updated');
  } else {
    // New manual task
    const newTask = {
      id:          genId(),
      type:        'manual',
      clientName:  client,
      subject,
      description: $('edit-description').value.trim(),
      priority:    $('edit-priority').value,
      status:      'pending',
      assignedTo:  $('edit-assignee').value.trim(),
      notes:       $('edit-notes').value.trim(),
      summary:     '',
      actionables: [],
      nextStepPerson: '',
      createdAt:   now,
      updatedAt:   now,
      manualOverrides: { priority: true, status: true, assignedTo: true }
    };
    saveManualTask(newTask);
    showToast('Task added');
  }

  closeEditModal();
  STATE.db.clients   = deriveClients(STATE.db.tasks);
  STATE.db.employees = deriveEmployees(STATE.db.tasks);
  renderAll();
});

// ── Settings modal ────────────────────────────────────────────────────────────
function openSettings() {
  $('settings-gh-pat').value    = localStorage.getItem(K.GH_PAT)    || '';
  $('settings-gh-owner').value  = localStorage.getItem(K.GH_OWNER)  || '';
  $('settings-gh-repo').value   = localStorage.getItem(K.GH_REPO)   || '';
  $('settings-gh-branch').value = localStorage.getItem(K.GH_BRANCH) || 'main';
  $('settings-modal').style.display = 'flex';
}
function closeSettings() { $('settings-modal').style.display = 'none'; }

$('save-settings-btn').addEventListener('click', () => {
  localStorage.setItem(K.GH_PAT,    $('settings-gh-pat').value.trim());
  localStorage.setItem(K.GH_OWNER,  $('settings-gh-owner').value.trim());
  localStorage.setItem(K.GH_REPO,   $('settings-gh-repo').value.trim());
  localStorage.setItem(K.GH_BRANCH, $('settings-gh-branch').value.trim() || 'main');
  closeSettings();
  showToast('Settings saved');
});

$('reset-pattern-btn').addEventListener('click', () => {
  if (!confirm('Reset your unlock pattern? You will need to set a new one.')) return;
  localStorage.removeItem(K.PATTERN_HASH);
  localStorage.removeItem(K.SETUP_DONE);
  closeSettings();
  lockDashboard();
  showToast('Pattern reset — please set a new one');
});

// ── Filter handlers ───────────────────────────────────────────────────────────
$('search-input').addEventListener('input', e => { STATE.filters.search = e.target.value; renderAll(); });
$('filter-status').addEventListener('change',   e => { STATE.filters.status   = e.target.value; renderAll(); });
$('filter-priority').addEventListener('change', e => { STATE.filters.priority = e.target.value; renderAll(); });
$('filter-employee').addEventListener('change', e => { STATE.filters.employee = e.target.value; renderAll(); });
$('filter-client').addEventListener('change',   e => { STATE.filters.client   = e.target.value; renderAll(); });

// Stat card click → quick filter
$('stat-urgent').addEventListener('click',    () => quickFilter('priority', 'urgent'));
$('stat-medium').addEventListener('click',    () => quickFilter('priority', 'medium'));
$('stat-low').addEventListener('click',       () => quickFilter('priority', 'low'));
$('stat-completed').addEventListener('click', () => quickFilter('status', 'completed'));
$('stat-total').addEventListener('click',     () => { STATE.filters = { status:'all', priority:'all', employee:'all', client:'all', search:'' }; $('search-input').value=''; syncSelectValues(); renderAll(); });

function quickFilter(key, val) {
  STATE.filters[key] = (STATE.filters[key] === val) ? 'all' : val;
  if (key === 'status' && val === 'completed') STATE.filters.status = 'completed';
  syncSelectValues();
  renderAll();
}

function syncSelectValues() {
  $('filter-status').value   = STATE.filters.status;
  $('filter-priority').value = STATE.filters.priority;
  $('filter-employee').value = STATE.filters.employee;
  $('filter-client').value   = STATE.filters.client;
  $('search-input').value    = STATE.filters.search;
}

// ── Completed section toggle ──────────────────────────────────────────────────
$('completed-toggle').addEventListener('click', () => {
  const section = document.getElementById('completed-section');
  const box     = $('completed-tasks');
  section.classList.toggle('open');
  box.style.display = section.classList.contains('open') ? '' : 'none';
});

// ── Header buttons ────────────────────────────────────────────────────────────
$('refresh-btn').addEventListener('click', () => { showToast('Refreshing…'); loadAndRender(); });
$('lock-btn').addEventListener('click',    () => lockDashboard());
$('settings-btn').addEventListener('click', openSettings);
$('close-settings-modal').addEventListener('click', closeSettings);
$('add-task-btn').addEventListener('click', () => openEditModal(null));
$('close-task-modal').addEventListener('click', closeTaskModal);
$('close-edit-modal').addEventListener('click', closeEditModal);
$('cancel-edit-btn').addEventListener('click', closeEditModal);

// Close modals on backdrop click
['task-modal','edit-modal','settings-modal'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).style.display = 'none'; });
});

// ── Auto refresh ──────────────────────────────────────────────────────────────
function startAutoRefresh() {
  stopAutoRefresh();
  STATE.refreshTimer = setInterval(() => loadAndRender(), 30000); // every 30s
}
function stopAutoRefresh() {
  if (STATE.refreshTimer) { clearInterval(STATE.refreshTimer); STATE.refreshTimer = null; }
}

function updateSyncTime() {
  const ls = STATE.db.lastSync;
  $('sync-time').textContent = ls ? `Last sync: ${fmtRelative(ls)}` : 'Not synced yet';
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => initAuth());
