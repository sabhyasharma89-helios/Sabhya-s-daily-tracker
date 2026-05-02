/* ═══════════════════════════════════════════════════════
   APP — MAIN COORDINATOR
═══════════════════════════════════════════════════════ */

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_DAYS     = 30;              // days of history on first run

const App = {
  setupStepNum: 1,
  pollTimer: null,
  pendingEmployees: [],

  // ═══════════════════════════════════════════════════════
  //  BOOT
  // ═══════════════════════════════════════════════════════
  async boot() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Init database
    await Database.init();

    const hasPattern = await Auth.init(Database);

    if (!hasPattern) {
      this._showScreen('setup-screen');
      this.setupStepNum = 1;
      return;
    }

    // Check Gmail is configured
    const clientId  = await Database.getSetting('googleClientId');
    const claudeKey = await Database.getSetting('claudeApiKey');

    if (!clientId || !claudeKey) {
      // Need setup but pattern exists — re-run setup from step 3
      this._showScreen('setup-screen');
      this.setupStepNum = 3;
      this._gotoSetupStep(3);
      return;
    }

    // Show pattern lock
    Auth.showPatternScreen();
  },

  // Called after successful authentication
  async onAuthenticated() {
    await Processor.init(Database);
    await Gmail.init(Database);
    await UI.init(Database);

    this._showScreen('app-screen');
    await this._startPolling();

    // Render settings employees if open
  },

  // ═══════════════════════════════════════════════════════
  //  SETUP WIZARD
  // ═══════════════════════════════════════════════════════
  setupNext() {
    this.setupStepNum++;
    this._gotoSetupStep(this.setupStepNum);
  },

  _gotoSetupStep(n) {
    document.querySelectorAll('.setup-step').forEach(el => el.classList.add('hidden'));
    const step = document.getElementById(`step-${n}`);
    if (step) step.classList.remove('hidden');

    document.querySelectorAll('.step-dot').forEach(dot => {
      const sn = parseInt(dot.dataset.step);
      dot.classList.toggle('active', sn === n);
      dot.classList.toggle('done',   sn < n);
    });

    if (n === 2) {
      Auth.renderSetupLock();
    }
    if (n === 5) {
      this._renderSetupEmployees();
    }
  },

  async saveApiKeys() {
    const clientId  = document.getElementById('google-client-id').value.trim();
    const claudeKey = document.getElementById('claude-api-key').value.trim();

    if (!clientId || !claudeKey) {
      UI.toast('Both fields are required', 'error');
      return;
    }

    await Database.setSetting('googleClientId', clientId);
    await Database.setSetting('claudeApiKey',   claudeKey);
    this.setupNext();
  },

  async authorizeGmail() {
    const statusEl = document.getElementById('gmail-auth-status');
    statusEl.textContent = 'Opening Google sign-in…';
    statusEl.className = 'pattern-status';

    await Gmail.init(Database);

    try {
      await Gmail.authorize();
      statusEl.textContent = '✓ Gmail connected!';
      statusEl.className = 'pattern-status success';
      document.getElementById('authorize-gmail-btn').textContent = '✓ Connected';
      setTimeout(() => this.setupNext(), 800);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'pattern-status error';
    }
  },

  addEmployee() {
    const input = document.getElementById('employee-input');
    const name  = input.value.trim();
    if (!name) return;
    if (this.pendingEmployees.includes(name)) { input.value = ''; return; }
    this.pendingEmployees.push(name);
    input.value = '';
    this._renderSetupEmployees();
  },

  _renderSetupEmployees() {
    const list = document.getElementById('employee-list');
    list.innerHTML = this.pendingEmployees.map(n => `
      <div class="employee-chip">
        <span>${UI._escHtml(n)}</span>
        <button onclick="App.removeSetupEmployee('${UI._escHtml(n)}')">×</button>
      </div>`).join('');
  },

  removeSetupEmployee(name) {
    this.pendingEmployees = this.pendingEmployees.filter(n => n !== name);
    this._renderSetupEmployees();
  },

  async finishSetup() {
    for (const name of this.pendingEmployees) {
      await Database.saveEmployee(name);
    }
    await Processor.init(Database);
    await UI.init(Database);
    this._showScreen('app-screen');
    await this._startPolling();
  },

  // ═══════════════════════════════════════════════════════
  //  SETTINGS
  // ═══════════════════════════════════════════════════════
  async saveSettingsKeys() {
    const clientId  = document.getElementById('settings-client-id').value.trim();
    const claudeKey = document.getElementById('settings-claude-key').value.trim();
    if (clientId)  await Database.setSetting('googleClientId', clientId);
    if (claudeKey) { await Database.setSetting('claudeApiKey', claudeKey); await Processor.refreshKey(); }
    UI.toast('Settings saved', 'success');
  },

  async addEmployeeFromSettings() {
    const input = document.getElementById('settings-employee-input');
    const name  = input.value.trim();
    if (!name) return;
    await Database.saveEmployee(name);
    input.value = '';
    await UI._renderSettingsEmployees();
    await UI.populateFilterDropdowns();
    UI.toast(`${name} added`, 'success');
  },

  async resetPattern() {
    await Auth.resetPattern(Database);
    UI.closeModal('settings-modal');
    Auth.showPatternScreen();
    // Re-render setup lock in pattern screen context
    document.getElementById('pattern-subtitle').textContent = 'Draw a new pattern to set it';
    Auth.lock = null;
    // Reinit as setup
    const statusEl = document.getElementById('pattern-status');
    if (statusEl) statusEl.textContent = '';
    // Use setup lock temporarily
    Auth.renderSetupLock();
    // Swap container
    const cont = document.getElementById('pattern-lock-container');
    const setupCont = document.getElementById('setup-pattern-container');
    // Move setup lock canvas/grid into main pattern screen
    cont.innerHTML = '';
    while (setupCont.firstChild) cont.appendChild(setupCont.firstChild);
    Auth.setupLock.container = cont;
  },

  async reauthorizeGmail() {
    try {
      await Gmail.reauthorize();
      UI.toast('Gmail re-authorized', 'success');
    } catch (e) {
      UI.toast(`Failed: ${e.message}`, 'error');
    }
  },

  lockApp() {
    UI.closeModal('settings-modal');
    clearInterval(this.pollTimer);
    Auth.showPatternScreen();
  },

  // ═══════════════════════════════════════════════════════
  //  EMAIL POLLING
  // ═══════════════════════════════════════════════════════
  async _startPolling() {
    await this.syncNow();
    this.pollTimer = setInterval(() => this.syncNow(), POLL_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // If page becomes visible and last sync was >10 mins ago, sync
        Database.getSetting('lastSyncTime').then(last => {
          if (!last || Date.now() - last > POLL_INTERVAL_MS) this.syncNow();
        });
      }
    });
  },

  async syncNow() {
    if (!Gmail.isTokenValid() && !Gmail.accessToken) {
      UI.toast('Gmail not connected. Check Settings.', 'error');
      return;
    }

    UI.showSyncBar('Fetching emails…');

    try {
      let lastSync = await Database.getSetting('lastSyncTime');

      // First run: go back 30 days
      if (!lastSync) {
        lastSync = Date.now() - INITIAL_DAYS * 24 * 60 * 60 * 1000;
      }

      const threadRefs = await Gmail.fetchThreadsSince(lastSync);

      if (!threadRefs.length) {
        UI.hideSyncBar();
        const now = Date.now();
        await Database.setSetting('lastSyncTime', now);
        UI.updateSyncTime(now, now + POLL_INTERVAL_MS);
        UI.toast('Inbox up to date', 'info');
        return;
      }

      UI.showSyncBar(`Processing ${threadRefs.length} email thread(s)…`);

      // Fetch full threads (limit to 50 per sync to avoid overload)
      const toProcess = threadRefs.slice(0, 50);
      const formattedThreads = [];

      for (const ref of toProcess) {
        try {
          const full = await Gmail.fetchThread(ref.id);
          formattedThreads.push(Gmail.formatThread(full));
        } catch (e) {
          console.error('Failed to fetch thread', ref.id, e);
        }
      }

      let done = 0;
      await Processor.processThreads(formattedThreads, (current, total) => {
        done = current;
        UI.showSyncBar(`Analysing threads… (${current}/${total})`);
      });

      const now = Date.now();
      await Database.setSetting('lastSyncTime', now);
      UI.hideSyncBar();
      UI.updateSyncTime(now, now + POLL_INTERVAL_MS);
      await UI.render();
      UI.toast(`Synced ${formattedThreads.length} thread(s)`, 'success');

    } catch (err) {
      UI.hideSyncBar();
      console.error('Sync error:', err);
      UI.toast(`Sync failed: ${err.message}`, 'error');
    }
  },

  // ═══════════════════════════════════════════════════════
  //  SCREEN MANAGEMENT
  // ═══════════════════════════════════════════════════════
  _showScreen(id) {
    document.querySelectorAll('.screen, #app-screen').forEach(el => {
      el.classList.remove('active');
    });
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
  },
};

// ─── Boot on DOM ready ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.boot());

// Allow Enter key on employee input
document.addEventListener('DOMContentLoaded', () => {
  const empInput = document.getElementById('employee-input');
  if (empInput) empInput.addEventListener('keydown', e => { if (e.key === 'Enter') App.addEmployee(); });

  const settingsEmpInput = document.getElementById('settings-employee-input');
  if (settingsEmpInput) settingsEmpInput.addEventListener('keydown', e => { if (e.key === 'Enter') App.addEmployeeFromSettings(); });
});
