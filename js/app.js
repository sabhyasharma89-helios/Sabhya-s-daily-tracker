/**
 * Main application controller — bootstraps auth, sync, and the dashboard.
 */
const App = {
  _syncInterval: null,
  _SYNC_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes

  async init() {
    await DB.open();
    const isSetup = await Auth.isSetup();

    if (!isSetup) {
      this._showSetupWizard();
    } else {
      this._showLockScreen();
    }
  },

  // ── Setup Wizard ──────────────────────────────────────

  _showSetupWizard() {
    const root = document.getElementById('root');
    root.innerHTML = `
      <div class="setup-wrap">
        <div class="setup-card">
          <div class="setup-logo">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="24" fill="#6366f1"/>
              <path d="M14 34L24 14L34 34" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M17 28H31" stroke="white" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <h1>Daily Tracker</h1>
            <p>One-time setup</p>
          </div>

          <div class="setup-steps">
            <div class="step active" id="step1">
              <div class="step-num">1</div>
              <div class="step-label">Set Pattern</div>
            </div>
            <div class="step-line"></div>
            <div class="step" id="step2">
              <div class="step-num">2</div>
              <div class="step-label">GitHub Config</div>
            </div>
          </div>

          <div id="setupContent"></div>
        </div>
      </div>
    `;

    this._renderSetupStep1();
  },

  _renderSetupStep1() {
    document.getElementById('step1').classList.add('active');
    document.getElementById('step2').classList.remove('active');
    Auth.render(document.getElementById('setupContent'), 'setup', {
      onSetupComplete: () => this._renderSetupStep2(),
    });
  },

  _renderSetupStep2() {
    document.getElementById('step1').classList.remove('active');
    document.getElementById('step2').classList.add('active');
    document.getElementById('setupContent').innerHTML = `
      <form id="setupForm" class="setup-form">
        <h3>GitHub Configuration</h3>
        <p class="setup-desc">
          Your tasks are stored in a JSON file in your GitHub repo.
          A Personal Access Token with <code>repo</code> scope is needed to sync user changes back.
        </p>

        <label>GitHub Repository Owner (username/org)
          <input name="repoOwner" required placeholder="e.g. sabhyasharma89-helios">
        </label>
        <label>Repository Name
          <input name="repoName" required placeholder="e.g. sabhya-s-daily-tracker">
        </label>
        <label>Branch
          <input name="repoBranch" placeholder="main" value="main">
        </label>
        <label>GitHub Personal Access Token
          <input name="githubToken" type="password" required placeholder="ghp_…"
                 autocomplete="new-password">
          <small>
            <a href="https://github.com/settings/tokens/new?scopes=repo&description=SabhyaTracker"
               target="_blank" rel="noopener">Generate token ↗</a>
            — select <strong>repo</strong> scope only.
          </small>
        </label>

        <details class="setup-help">
          <summary>How to set up email processing (GitHub Secrets required)</summary>
          <div class="help-content">
            <p>Add these secrets to your GitHub repository (<em>Settings → Secrets → Actions</em>):</p>
            <ul>
              <li><code>GMAIL_CLIENT_ID</code> — Google OAuth client ID</li>
              <li><code>GMAIL_CLIENT_SECRET</code> — Google OAuth client secret</li>
              <li><code>GMAIL_REFRESH_TOKEN</code> — Gmail API refresh token</li>
              <li><code>ANTHROPIC_API_KEY</code> — Your Anthropic API key</li>
            </ul>
            <p>To get Gmail credentials: create a project in
              <a href="https://console.cloud.google.com" target="_blank">Google Cloud Console</a>,
              enable the Gmail API, create OAuth 2.0 credentials (Desktop app), and run the auth flow once
              to get a refresh token. A helper script is available in <code>scripts/get_token.py</code>.
            </p>
          </div>
        </details>

        <div class="setup-footer">
          <button type="submit" class="btn-primary btn-full">Complete Setup →</button>
        </div>
      </form>
    `;

    document.getElementById('setupForm').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      await DB.setSetting('repoOwner', data.repoOwner.trim());
      await DB.setSetting('repoName', data.repoName.trim());
      await DB.setSetting('repoBranch', (data.repoBranch || 'main').trim());
      await Sync.init();
      await Sync.setToken(data.githubToken.trim());
      this._showLockScreen();
    });
  },

  // ── Lock Screen ────────────────────────────────────────

  _showLockScreen() {
    const root = document.getElementById('root');
    root.innerHTML = '<div id="authContainer"></div>';
    Auth.render(document.getElementById('authContainer'), 'login', {
      onSuccess: () => this._showDashboard(),
    });
  },

  // ── Dashboard ──────────────────────────────────────────

  async _showDashboard() {
    await Sync.init();
    const root = document.getElementById('root');
    root.innerHTML = `
      <div class="app-layout">
        <!-- Header -->
        <header class="app-header">
          <button class="hamburger" id="menuToggle" aria-label="Toggle sidebar">
            <span></span><span></span><span></span>
          </button>
          <div class="header-logo">
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="24" fill="#6366f1"/>
              <path d="M14 34L24 14L34 34" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M17 28H31" stroke="white" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <span>Daily Tracker</span>
          </div>
          <div class="header-actions">
            <span class="sync-status" id="syncStatus" title="Sync status">⟳</span>
            <button class="icon-btn" id="syncBtn" title="Sync now">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"/>
                <polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
              </svg>
            </button>
            <button class="icon-btn" id="settingsBtn" title="Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </button>
            <button class="icon-btn" id="lockBtn" title="Lock">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
            </button>
          </div>
        </header>

        <!-- Stats Bar -->
        <div class="stats-bar" id="statsBar"></div>

        <!-- Body -->
        <div class="app-body">
          <!-- Sidebar (desktop) -->
          <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">Clients</div>
            <div id="clientSidebar"></div>
          </aside>

          <!-- Main content -->
          <main class="main-content">
            <div id="filtersBar"></div>
            <div id="taskList" class="task-list"></div>
          </main>
        </div>

        <!-- Modal -->
        <div class="modal-overlay" id="modal"></div>

        <!-- Settings Panel -->
        <div class="settings-panel" id="settingsPanel">
          <div class="settings-inner">
            <div class="settings-header">
              <h3>Settings</h3>
              <button class="icon-btn" id="closeSettings">✕</button>
            </div>
            <div id="settingsContent"></div>
          </div>
        </div>
      </div>
    `;

    this._bindHeaderEvents();
    await Tasks.load();
    Tasks.renderAll();

    // Initial pull
    this._doSync();
    this._syncInterval = setInterval(() => this._doSync(), this._SYNC_INTERVAL_MS);

    // Close modal on overlay click
    document.getElementById('modal').addEventListener('click', e => {
      if (e.target === document.getElementById('modal')) {
        document.getElementById('modal').classList.remove('open');
      }
    });
  },

  _bindHeaderEvents() {
    document.getElementById('menuToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    document.getElementById('lockBtn').addEventListener('click', () => {
      clearInterval(this._syncInterval);
      sessionStorage.clear();
      this._showLockScreen();
    });

    document.getElementById('syncBtn').addEventListener('click', async () => {
      await this._doSync(true);
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
      this._openSettings();
    });

    document.getElementById('closeSettings').addEventListener('click', () => {
      document.getElementById('settingsPanel').classList.remove('open');
    });
  },

  async _doSync(manual = false) {
    const el = document.getElementById('syncStatus');
    if (el) { el.textContent = '⟳'; el.className = 'sync-status syncing'; }

    const pullResult = await Sync.pull();
    if (pullResult.ok) {
      await Tasks.load();
      Tasks.renderAll();
      if (el) { el.textContent = '✓'; el.className = 'sync-status ok'; }
      if (manual) this._toast('Synced successfully');
    } else {
      if (el) { el.textContent = '!'; el.className = 'sync-status error'; }
      if (manual) this._toast(`Sync error: ${pullResult.msg}`, 'error');
    }

    // Push any queued local changes
    const queue = await DB.getSyncQueue();
    if (queue.length > 0) {
      await Sync.push();
    }
  },

  _openSettings() {
    const panel = document.getElementById('settingsPanel');
    const content = document.getElementById('settingsContent');

    content.innerHTML = `
      <div class="settings-section">
        <h4>Account</h4>
        <button class="btn-outline btn-full" id="changePattern">Change Unlock Pattern</button>
        <button class="btn-outline btn-full" id="manualSync">Force Full Sync Now</button>
      </div>
      <div class="settings-section">
        <h4>GitHub Token</h4>
        <input type="password" id="newToken" placeholder="ghp_… (new token)">
        <button class="btn-primary btn-sm" id="saveToken">Save Token</button>
      </div>
      <div class="settings-section">
        <h4>About</h4>
        <p style="font-size:0.8rem;opacity:0.6">
          Data is processed every 10 minutes via GitHub Actions.<br>
          Last local sync: <span id="lastSyncTime">checking…</span>
        </p>
      </div>
    `;

    const lastSync = Sync.getLastSyncTime();
    document.getElementById('lastSyncTime').textContent =
      lastSync ? lastSync.toLocaleString() : 'Never';

    document.getElementById('changePattern').addEventListener('click', () => {
      panel.classList.remove('open');
      const root = document.getElementById('root');
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.innerHTML = '<div id="patternChangeContainer"></div>';
      root.appendChild(overlay);
      Auth.render(document.getElementById('patternChangeContainer'), 'setup', {
        onSetupComplete: () => { overlay.remove(); this._toast('Pattern updated'); },
      });
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    });

    document.getElementById('manualSync').addEventListener('click', async () => {
      panel.classList.remove('open');
      await this._doSync(true);
    });

    document.getElementById('saveToken').addEventListener('click', async () => {
      const val = document.getElementById('newToken').value.trim();
      if (val) {
        await Sync.setToken(val);
        this._toast('Token saved');
      }
    });

    panel.classList.add('open');
  },

  _toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3000);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
