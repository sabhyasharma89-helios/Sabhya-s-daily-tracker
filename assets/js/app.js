/* =====================================================================
   app.js — Sabhya's Task Tracker  (main application logic)
   ===================================================================== */

/* ─── State ─── */
let DB = null;           // { meta, tasks }
let currentTaskId = null;
let _debounceTimer = null;
let _unlockedPattern = null; // raw pattern array kept in memory for re-encryption
let _writeInProgress = false;

const EMPTY_DB = () => ({
  meta: {
    last_updated: '',
    last_email_check: '',
    first_run_complete: false,
    version: '1.0'
  },
  tasks: []
});

/* ─── Filters ─── */
let filters = { search: '', priority: '', status: 'pending', assignee: '', client: '' };

/* =====================================================================
   BOOT
   ===================================================================== */
window.addEventListener('DOMContentLoaded', async () => {
  const hasPattern = !!localStorage.getItem('pattern_hash');
  const hasConfig  = !!localStorage.getItem('gh_repo');

  if (!hasPattern || !hasConfig) {
    if (!hasPattern) {
      showScreen('setup-screen');
      initSetupPattern();
    } else {
      showScreen('setup-screen');
      showSetupStep('step-github');
    }
  } else {
    showScreen('lock-screen');
    initLockScreen();
  }
});

/* =====================================================================
   SCREEN MANAGEMENT
   ===================================================================== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* =====================================================================
   LOCK SCREEN
   ===================================================================== */
function initLockScreen() {
  PatternLock.init('pattern-svg', 'pattern-lines', 'active-line', 'pattern-dots', async (pattern) => {
    const hash = await PatternLock.hashPattern(pattern);
    const storedHash = localStorage.getItem('pattern_hash');

    if (hash === storedHash) {
      _unlockedPattern = pattern;
      await loadPATFromStorage(pattern);
      document.getElementById('lock-msg').textContent = '';
      document.getElementById('lock-msg').className = 'lock-msg success';
      document.getElementById('lock-msg').textContent = 'Unlocked!';
      await loadAndShowDashboard();
    } else {
      document.getElementById('lock-msg').className = 'lock-msg error';
      document.getElementById('lock-msg').textContent = 'Incorrect pattern. Try again.';
      setTimeout(() => {
        PatternLock.clearPattern();
        document.getElementById('lock-msg').textContent = '';
        document.getElementById('lock-msg').className = 'lock-msg';
      }, 900);
    }
  });
}

async function loadPATFromStorage(pattern) {
  const enc = localStorage.getItem('gh_pat_enc');
  if (!enc) return;
  const plain = await PatternLock.decrypt(pattern, enc);
  if (plain) sessionStorage.setItem('gh_pat_plain', plain);
}

async function loadAndShowDashboard() {
  showScreen('dashboard');
  await refreshData();
}

/* =====================================================================
   SETUP FLOW
   ===================================================================== */
let _setupFirstPattern = null;
let _setupConfirmMode  = false;

function initSetupPattern() {
  PatternLock.init('setup-svg', 'setup-lines', 'setup-active-line', 'setup-dots', async (pattern) => {
    const msg = document.getElementById('setup-msg');
    const btn = document.getElementById('setup-pattern-next');

    if (!_setupConfirmMode) {
      _setupFirstPattern = pattern;
      _setupConfirmMode  = true;
      PatternLock.clearPattern();
      msg.className = 'lock-msg success';
      msg.textContent = 'Pattern recorded. Draw again to confirm.';
    } else {
      const h1 = await PatternLock.hashPattern(_setupFirstPattern);
      const h2 = await PatternLock.hashPattern(pattern);
      if (h1 === h2) {
        _unlockedPattern = pattern;
        msg.className = 'lock-msg success';
        msg.textContent = 'Pattern confirmed!';
        btn.disabled = false;
        btn.onclick = confirmSetupPattern;
      } else {
        msg.className = 'lock-msg error';
        msg.textContent = "Patterns don't match. Start again.";
        _setupConfirmMode = false;
        _setupFirstPattern = null;
        setTimeout(() => {
          PatternLock.clearPattern();
          msg.textContent = 'Draw a pattern of at least 4 dots.';
          msg.className = 'lock-msg';
        }, 900);
      }
    }
  });
  const msg = document.getElementById('setup-msg');
  msg.textContent = 'Draw a pattern of at least 4 dots.';
}

function confirmSetupPattern() {
  if (!_unlockedPattern) return;
  PatternLock.hashPattern(_unlockedPattern).then(h => {
    localStorage.setItem('pattern_hash', h);
    showSetupStep('step-github');
    // Pre-fill repo
    const repo = localStorage.getItem('gh_repo') || 'sabhyasharma89-helios/sabhya-s-daily-tracker';
    document.getElementById('setup-repo').value = repo;
  });
}

function showSetupStep(id) {
  document.querySelectorAll('.setup-step').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

async function saveGithubConfig() {
  const pat  = document.getElementById('setup-pat').value.trim();
  const repo = document.getElementById('setup-repo').value.trim();
  if (!pat || !repo) { showToast('Please fill all fields.', 'error'); return; }

  showToast('Validating token…');
  const ok = await GitHubAPI.validatePAT(pat, repo);
  if (!ok) { showToast('Token invalid or no repo access.', 'error'); return; }

  localStorage.setItem('gh_repo', repo);
  // Encrypt PAT with pattern before storing
  if (_unlockedPattern) {
    const enc = await PatternLock.encrypt(_unlockedPattern, pat);
    localStorage.setItem('gh_pat_enc', enc);
  }
  sessionStorage.setItem('gh_pat_plain', pat);

  showToast('Config saved!', 'success');
  await loadAndShowDashboard();
}

/* =====================================================================
   DATA LOAD & REFRESH
   ===================================================================== */
async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  try {
    DB = await GitHubAPI.fetchTasks();
    renderDashboard();
    const ts = DB?.meta?.last_email_check;
    document.getElementById('last-sync-label').textContent =
      ts ? `Synced ${timeAgo(ts)}` : '';
    showToast('Tasks refreshed', 'success');
  } catch (e) {
    console.error(e);
    if (!DB) DB = EMPTY_DB();
    renderDashboard();
    showToast('Could not fetch latest data: ' + e.message, 'error');
  } finally {
    btn.classList.remove('spinning');
  }
}

/* =====================================================================
   RENDER
   ===================================================================== */
function renderDashboard() {
  if (!DB) return;
  updateStats();
  populateFilterDropdowns();
  renderClientSections();
}

function updateStats() {
  const tasks = DB.tasks || [];
  const pending   = tasks.filter(t => t.status === 'pending');
  const completed = tasks.filter(t => t.status === 'completed');
  document.getElementById('s-urgent').textContent  = pending.filter(t => t.priority === 'urgent').length;
  document.getElementById('s-medium').textContent  = pending.filter(t => t.priority === 'medium').length;
  document.getElementById('s-low').textContent     = pending.filter(t => t.priority === 'low').length;
  document.getElementById('s-pending').textContent = pending.length;
  document.getElementById('s-done').textContent    = completed.length;
  document.getElementById('s-total').textContent   = tasks.length;
}

function populateFilterDropdowns() {
  const tasks = DB.tasks || [];
  const assignees = [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort();
  const clients   = [...new Set(tasks.map(t => t.client).filter(Boolean))].sort();

  const fA = document.getElementById('f-assignee');
  const fC = document.getElementById('f-client');
  const savedA = fA.value, savedC = fC.value;

  fA.innerHTML = '<option value="">All Assignees</option>' +
    assignees.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  fC.innerHTML = '<option value="">All Clients</option>' +
    clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  if (savedA) fA.value = savedA;
  if (savedC) fC.value = savedC;
}

function renderClientSections() {
  const content = document.getElementById('main-content');
  // Remove old client sections (keep completed-section and no-tasks-msg)
  content.querySelectorAll('.client-section:not(.completed-section)').forEach(el => el.remove());

  const tasks = filteredTasks();
  const pending   = tasks.filter(t => t.status === 'pending');
  const completed = tasks.filter(t => t.status === 'completed');

  // Client grouping for pending
  const clientMap = {};
  for (const t of pending) {
    const c = t.client || 'Uncategorised';
    if (!clientMap[c]) clientMap[c] = [];
    clientMap[c].push(t);
  }

  // Sort clients: alphabetical
  const sortedClients = Object.keys(clientMap).sort();
  const noTasksMsg = document.getElementById('no-tasks-msg');
  const completedSection = document.getElementById('completed-section');

  if (sortedClients.length === 0 && completed.length === 0) {
    noTasksMsg.style.display = 'flex';
  } else {
    noTasksMsg.style.display = 'none';
  }

  // Insert client sections before the completed section
  for (const client of sortedClients) {
    const section = buildClientSection(client, clientMap[client]);
    content.insertBefore(section, completedSection);
  }

  // Completed section
  if (completed.length > 0) {
    completedSection.style.display = 'block';
    document.getElementById('completed-count-badge').textContent = completed.length;
    const body = document.getElementById('completed-tasks-body');
    body.innerHTML = '';
    const sorted = [...completed].sort((a, b) =>
      new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
    );
    for (const t of sorted) body.appendChild(buildTaskCard(t));
  } else {
    completedSection.style.display = 'none';
  }
}

function buildClientSection(client, tasks) {
  const section = document.createElement('div');
  section.className = 'client-section';
  section.dataset.client = client;

  const priorityOrder = { urgent: 0, medium: 1, low: 2 };
  const sorted = [...tasks].sort((a, b) =>
    (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
  );

  const urgentCount  = tasks.filter(t => t.priority === 'urgent').length;
  const mediumCount  = tasks.filter(t => t.priority === 'medium').length;
  const lowCount     = tasks.filter(t => t.priority === 'low').length;

  const badges = [
    urgentCount  ? `<span class="mini-badge urgent"></span>` : '',
    mediumCount  ? `<span class="mini-badge medium"></span>` : '',
    lowCount     ? `<span class="mini-badge low"></span>`    : ''
  ].join('');

  section.innerHTML = `
    <div class="section-head" onclick="toggleSection(this)">
      <div class="section-head-left">
        <svg class="chevron" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="client-name">${esc(client)}</span>
        <span class="task-count">${tasks.length}</span>
      </div>
      <div class="section-head-right">
        <div class="priority-badges">${badges}</div>
      </div>
    </div>
    <div class="section-body" id="body-${slugify(client)}"></div>
  `;

  const body = section.querySelector('.section-body');
  for (const t of sorted) body.appendChild(buildTaskCard(t));
  return section;
}

function buildTaskCard(task) {
  const card = document.createElement('div');
  card.className = `task-card ${task.priority || 'low'} ${task.status === 'completed' ? 'completed-card' : ''}`;
  card.dataset.id = task.id;

  const dateStr = task.updated_at || task.created_at;
  const checked = task.status === 'completed';

  card.innerHTML = `
    <button class="task-check ${checked ? 'checked' : ''}"
      onclick="toggleCheck(event,'${task.id}')" title="Toggle completion"></button>
    <div class="task-body" onclick="openTask('${task.id}')">
      <div class="task-title">${esc(task.subject || task.title || 'Untitled Task')}</div>
      <div class="task-meta">
        <span class="tag ${task.priority}">${task.priority || 'low'}</span>
        ${task.assignee ? `<span class="tag assignee-tag">${esc(task.assignee)}</span>` : ''}
        <span class="task-date">${dateStr ? timeAgo(dateStr) : ''}</span>
      </div>
    </div>
  `;
  return card;
}

/* =====================================================================
   FILTERS
   ===================================================================== */
function filteredTasks() {
  if (!DB) return [];
  let tasks = DB.tasks || [];

  const { search, priority, status, assignee, client } = filters;

  if (status === 'pending')   tasks = tasks.filter(t => t.status !== 'completed');
  if (status === 'completed') tasks = tasks.filter(t => t.status === 'completed');

  if (priority) tasks = tasks.filter(t => t.priority === priority);
  if (assignee) tasks = tasks.filter(t => t.assignee === assignee);
  if (client)   tasks = tasks.filter(t => t.client === client);

  if (search) {
    const q = search.toLowerCase();
    tasks = tasks.filter(t =>
      (t.subject || '').toLowerCase().includes(q) ||
      (t.title   || '').toLowerCase().includes(q) ||
      (t.client  || '').toLowerCase().includes(q) ||
      (t.assignee|| '').toLowerCase().includes(q) ||
      (t.summary || '').toLowerCase().includes(q)
    );
  }
  return tasks;
}

function applyFilters() {
  filters.search   = document.getElementById('search-input').value;
  filters.priority = document.getElementById('f-priority').value;
  filters.status   = document.getElementById('f-status').value;
  filters.assignee = document.getElementById('f-assignee').value;
  filters.client   = document.getElementById('f-client').value;

  const clearBtn = document.getElementById('clear-search-btn');
  clearBtn.style.display = filters.search ? 'block' : 'none';

  const isFiltered = filters.priority || filters.assignee || filters.client || filters.search;
  const banner = document.getElementById('filter-banner');
  if (isFiltered) {
    banner.style.display = 'flex';
    const parts = [];
    if (filters.priority) parts.push(`Priority: ${filters.priority}`);
    if (filters.client)   parts.push(`Client: ${filters.client}`);
    if (filters.assignee) parts.push(`Assignee: ${filters.assignee}`);
    if (filters.search)   parts.push(`"${filters.search}"`);
    document.getElementById('filter-banner-text').textContent = 'Filtered by: ' + parts.join(' · ');
  } else {
    banner.style.display = 'none';
  }

  renderClientSections();
}

function filterBy(type, value) {
  if (type === 'priority') {
    filters.priority = value;
    filters.status   = 'pending';
    document.getElementById('f-priority').value = value;
    document.getElementById('f-status').value   = 'pending';
  }
  if (type === 'status') {
    filters.status = value;
    document.getElementById('f-status').value = value;
  }
  applyFilters();
}

function clearFilters() {
  filters = { search: '', priority: '', status: 'pending', assignee: '', client: '' };
  document.getElementById('search-input').value = '';
  document.getElementById('f-priority').value   = '';
  document.getElementById('f-status').value     = 'pending';
  document.getElementById('f-assignee').value   = '';
  document.getElementById('f-client').value     = '';
  document.getElementById('filter-banner').style.display = 'none';
  document.getElementById('clear-search-btn').style.display = 'none';
  renderClientSections();
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  filters.search = '';
  applyFilters();
}

/* =====================================================================
   SECTION TOGGLE
   ===================================================================== */
function toggleSection(headEl) {
  const body    = headEl.nextElementSibling;
  const isOpen  = !headEl.classList.contains('collapsed');
  if (isOpen) {
    headEl.classList.add('collapsed');
    body.style.display = 'none';
  } else {
    headEl.classList.remove('collapsed');
    body.style.display = 'flex';
  }
}

function toggleSidebar() {} // placeholder for future sidebar

/* =====================================================================
   TASK DETAIL MODAL
   ===================================================================== */
function openTask(id) {
  const task = (DB.tasks || []).find(t => t.id === id);
  if (!task) return;
  currentTaskId = id;

  document.getElementById('td-title').textContent = task.subject || task.title || 'Untitled';
  const dot = document.getElementById('td-priority-dot');
  dot.className = 'priority-dot ' + (task.priority || 'low');

  document.getElementById('td-client').textContent      = task.client || '';
  document.getElementById('td-priority-tag').textContent = task.priority || 'low';
  document.getElementById('td-priority-tag').className   = `tag priority-tag ${task.priority || 'low'}`;
  document.getElementById('td-status-tag').textContent   = task.status === 'completed' ? 'Completed' : 'Pending';

  const aTag = document.getElementById('td-assignee-tag');
  if (task.assignee) {
    aTag.textContent = task.assignee;
    aTag.style.display = 'inline-block';
  } else {
    aTag.style.display = 'none';
  }

  document.getElementById('td-summary').textContent      = task.summary || 'No summary available.';
  document.getElementById('td-next-resp').textContent    = task.next_responsible || 'Not specified';
  document.getElementById('td-conv-summary').textContent = task.conversation_summary || task.notes || '';

  // Actionables
  const ul = document.getElementById('td-actionables');
  ul.innerHTML = '';
  const actions = task.actionables || [];
  if (actions.length) {
    actions.forEach(a => {
      const li = document.createElement('li');
      li.textContent = a;
      ul.appendChild(li);
    });
  } else {
    ul.innerHTML = '<li>No actionables identified.</li>';
  }

  // Thread
  const threadList = document.getElementById('td-thread-list');
  threadList.innerHTML = '';
  const history = task.conversation_history || [];
  if (history.length) {
    history.forEach(m => {
      const fromName = (m.from_name || m.from || 'Unknown').split(' ')[0];
      const initials = fromName.slice(0,2).toUpperCase();
      threadList.innerHTML += `
        <div class="thread-item">
          <div class="thread-avatar">${initials}</div>
          <div class="thread-content">
            <div>
              <span class="thread-from">${esc(m.from_name || m.from || '')}</span>
              <span class="thread-date">${m.date ? new Date(m.date).toLocaleDateString() : ''}</span>
            </div>
            <div class="thread-subject">${esc(m.subject || '')}</div>
            <div class="thread-preview">${esc(m.body_preview || '')}</div>
          </div>
        </div>`;
    });
  } else {
    threadList.innerHTML = '<p style="color:var(--text3);font-size:13px;">No email thread data.</p>';
  }

  // Edit tab
  document.getElementById('td-edit-priority').value  = task.priority  || 'medium';
  document.getElementById('td-edit-assignee').value  = task.assignee  || '';
  document.getElementById('td-edit-client').value    = task.client    || '';
  document.getElementById('td-edit-status').checked  = task.status === 'completed';

  switchTab('summary', document.querySelector('#task-modal .tab-btn'));
  document.getElementById('task-modal').style.display = 'flex';
}

function closeTaskModal() {
  document.getElementById('task-modal').style.display = 'none';
  currentTaskId = null;
}
function closeTaskModalIfBg(e) {
  if (e.target === e.currentTarget) closeTaskModal();
}

function switchTab(name, btn) {
  document.querySelectorAll('#task-modal .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#task-modal .tab-pane').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const pane = document.getElementById('tab-' + name);
  if (pane) pane.classList.add('active');
}

/* =====================================================================
   TASK MUTATIONS
   ===================================================================== */
async function toggleCheck(e, id) {
  e.stopPropagation();
  const task = (DB.tasks || []).find(t => t.id === id);
  if (!task) return;
  task.status     = task.status === 'completed' ? 'pending' : 'completed';
  task.updated_at = new Date().toISOString();
  if (task.status === 'completed') task.completed_at = new Date().toISOString();
  renderDashboard();
  await persistDB(`Task marked ${task.status}`);
}

async function updateTaskField(field, value) {
  const task = (DB.tasks || []).find(t => t.id === currentTaskId);
  if (!task) return;
  task[field]     = value;
  task.updated_at = new Date().toISOString();
  if (field === 'priority') task.priority_manual = true;
  renderDashboard();
  await persistDB('Task updated');
}

const debouncedUpdateAssignee = debounce(v => updateTaskField('assignee', v), 800);
const debouncedUpdateClient   = debounce(v => updateTaskField('client',   v), 800);

async function toggleTaskStatus(completed) {
  const task = (DB.tasks || []).find(t => t.id === currentTaskId);
  if (!task) return;
  task.status     = completed ? 'completed' : 'pending';
  task.updated_at = new Date().toISOString();
  if (completed) task.completed_at = new Date().toISOString();
  renderDashboard();
  closeTaskModal();
  await persistDB(`Task marked ${task.status}`);
}

async function deleteTask() {
  if (!currentTaskId) return;
  if (!confirm('Delete this task? This cannot be undone.')) return;
  DB.tasks = DB.tasks.filter(t => t.id !== currentTaskId);
  closeTaskModal();
  renderDashboard();
  await persistDB('Task deleted');
}

/* =====================================================================
   ADD TASK
   ===================================================================== */
function openAddTask() {
  document.getElementById('add-modal').style.display = 'flex';
  document.getElementById('new-title').value    = '';
  document.getElementById('new-client').value   = '';
  document.getElementById('new-priority').value = 'medium';
  document.getElementById('new-assignee').value = '';
  document.getElementById('new-notes').value    = '';
  setTimeout(() => document.getElementById('new-title').focus(), 100);
}

function closeAddTask() {
  document.getElementById('add-modal').style.display = 'none';
}
function closeAddIfBg(e) { if (e.target === e.currentTarget) closeAddTask(); }

async function saveNewTask() {
  const title    = document.getElementById('new-title').value.trim();
  const client   = document.getElementById('new-client').value.trim();
  const priority = document.getElementById('new-priority').value;
  const assignee = document.getElementById('new-assignee').value.trim();
  const notes    = document.getElementById('new-notes').value.trim();

  if (!title)  { showToast('Title is required', 'error'); return; }
  if (!client) { showToast('Client name is required', 'error'); return; }

  const task = {
    id:           crypto.randomUUID(),
    source:       'manual',
    client,
    subject:      title,
    priority,
    status:       'pending',
    assignee,
    notes,
    summary:      notes,
    actionables:  [],
    conversation_history: [],
    next_responsible: assignee,
    created_at:   new Date().toISOString(),
    updated_at:   new Date().toISOString(),
    priority_manual: true
  };

  if (!DB) DB = EMPTY_DB();
  DB.tasks.push(task);
  closeAddTask();
  renderDashboard();
  await persistDB('New task added');
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
function openSettings() {
  document.getElementById('settings-pat').value  = '';
  document.getElementById('settings-repo').value = localStorage.getItem('gh_repo') || '';
  document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}
function closeSettingsIfBg(e) { if (e.target === e.currentTarget) closeSettings(); }

async function saveSettings() {
  const pat  = document.getElementById('settings-pat').value.trim();
  const repo = document.getElementById('settings-repo').value.trim();
  if (repo) localStorage.setItem('gh_repo', repo);
  if (pat) {
    sessionStorage.setItem('gh_pat_plain', pat);
    if (_unlockedPattern) {
      const enc = await PatternLock.encrypt(_unlockedPattern, pat);
      localStorage.setItem('gh_pat_enc', enc);
    }
    showToast('Settings saved', 'success');
  } else {
    showToast('Settings saved (no PAT change)', 'success');
  }
  closeSettings();
}

function resetPattern() {
  if (!confirm('This will log you out and require you to set a new pattern.')) return;
  localStorage.removeItem('pattern_hash');
  localStorage.removeItem('gh_pat_enc');
  sessionStorage.clear();
  _unlockedPattern = null;
  closeSettings();
  location.reload();
}

function lockApp() {
  sessionStorage.clear();
  _unlockedPattern = null;
  closeSettings();
  showScreen('lock-screen');
  initLockScreen();
}

function showForgotPattern() {
  if (!confirm(
    'Resetting your pattern will remove your stored credentials.\n' +
    'You will need to re-enter your GitHub PAT.\n\nContinue?'
  )) return;
  localStorage.removeItem('pattern_hash');
  localStorage.removeItem('gh_pat_enc');
  sessionStorage.clear();
  _unlockedPattern = null;
  location.reload();
}

/* =====================================================================
   PERSIST TO GITHUB
   ===================================================================== */
async function persistDB(action) {
  if (_writeInProgress) return;
  _writeInProgress = true;
  DB.meta.last_updated = new Date().toISOString();
  try {
    await GitHubAPI.writeTasks(DB);
    document.getElementById('last-sync-label').textContent = 'Saved just now';
    if (action) showToast(action, 'success');
  } catch (e) {
    console.error('Write error:', e);
    showToast('Saved locally only. ' + e.message, 'error');
  } finally {
    _writeInProgress = false;
  }
}

/* =====================================================================
   UTILITIES
   ===================================================================== */
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)    return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast visible' + (type ? ' ' + type : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 3000);
}
