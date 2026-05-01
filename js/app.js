/* Main application controller — orchestrates auth, sync, and UI */
const App = (() => {
  const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  let syncTimer = null;
  let syncTimerDisplay = null;
  let isSyncing = false;
  let lockInstance = null;
  let setupInstance = null;
  let isFirstRun = false;

  /* ---------- Boot ---------- */
  async function boot() {
    try {
      await db.init();
    } catch (e) {
      UI.toast('Database init failed: ' + e.message, 'error');
      return;
    }

    const setupComplete = await db.getConfig('setup_complete');
    const patternHash = await db.getConfig('pattern_hash');

    if (!setupComplete || !patternHash) {
      startSetupWizard();
    } else {
      startLockScreen();
    }
  }

  /* ---------- Lock screen ---------- */
  function startLockScreen() {
    UI.showScreen('screen-lock');
    const canvas = document.getElementById('pattern-canvas');
    lockInstance = new PatternLock(canvas, {
      minDots: 4,
      onComplete: async pattern => {
        const hash = await hashPattern(pattern);
        const storedHash = await db.getConfig('pattern_hash');
        if (hash === storedHash) {
          lockInstance.showSuccess();
          setTimeout(() => startDashboard(), 500);
        } else {
          lockInstance.showError('Wrong pattern. Try again.');
        }
      }
    });

    document.getElementById('btn-forgot-pattern')?.addEventListener('click', () => {
      if (confirm('Reset your pattern? You will need to re-configure the tracker.')) {
        db.setConfig('setup_complete', false).then(() => {
          db.setConfig('pattern_hash', null).then(() => location.reload());
        });
      }
    });
  }

  /* ---------- Setup wizard ---------- */
  function startSetupWizard() {
    UI.showScreen('screen-setup');
    showSetupStep('step-pattern');

    const canvas = document.getElementById('setup-pattern-canvas');
    const msgEl = document.getElementById('setup-pattern-msg');

    document.addEventListener('patternStageChange', e => {
      if (e.detail.stage === 'confirm') {
        if (msgEl) msgEl.textContent = 'Draw the same pattern to confirm';
      } else {
        if (msgEl) msgEl.textContent = 'Draw a pattern (connect at least 4 dots)';
      }
    });

    setupInstance = new PatternSetup(canvas,
      async pattern => {
        // Pattern confirmed
        const hash = await hashPattern(pattern);
        await db.setConfig('pattern_hash', hash);
        showSetupStep('step-google');
        setupGoogleStep();
      },
      err => {
        const msgEl = document.getElementById('setup-pattern-msg');
        if (msgEl) { msgEl.textContent = err; msgEl.classList.add('error-text'); }
        setTimeout(() => { if (msgEl) { msgEl.textContent = 'Draw a pattern (connect at least 4 dots)'; msgEl.classList.remove('error-text'); } }, 2000);
      }
    );
  }

  function showSetupStep(stepId) {
    document.querySelectorAll('.setup-step').forEach(s => s.classList.remove('active'));
    document.getElementById(stepId)?.classList.add('active');
    // Update progress indicators
    const steps = ['step-pattern', 'step-google', 'step-done'];
    const idx = steps.indexOf(stepId);
    document.querySelectorAll('.setup-progress-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i <= idx);
    });
  }

  function setupGoogleStep() {
    const btn = document.getElementById('btn-connect-google');
    const input = document.getElementById('setup-client-id');
    const skipBtn = document.getElementById('btn-skip-google');

    btn?.addEventListener('click', async () => {
      const cid = input?.value.trim();
      if (!cid) { UI.toast('Please paste your Google OAuth Client ID', 'error'); return; }
      await db.setConfig('google_client_id', cid);
      showSetupStep('step-done');
      setupDoneStep();
    });

    skipBtn?.addEventListener('click', async () => {
      showSetupStep('step-done');
      setupDoneStep();
    });
  }

  function setupDoneStep() {
    document.getElementById('btn-start-tracker')?.addEventListener('click', async () => {
      await db.setConfig('setup_complete', true);
      await startDashboard();
    });
  }

  /* ---------- Dashboard ---------- */
  async function startDashboard() {
    UI.showScreen('screen-dashboard');
    UI.initFilters();
    UI.initCompletedToggle();

    await UI.refreshAll();

    // Bind header buttons
    document.getElementById('btn-sync')?.addEventListener('click', () => manualSync());
    document.getElementById('btn-settings')?.addEventListener('click', () => UI.openSettings());
    document.getElementById('btn-add-task')?.addEventListener('click', () => UI.openEditTaskModal(null));
    document.getElementById('btn-add-employee')?.addEventListener('click', () => UI.openEmployeeModal());

    // Hamburger for mobile
    document.getElementById('btn-menu')?.addEventListener('click', () => {
      document.getElementById('clients-sidebar')?.classList.toggle('sidebar-open');
    });
    document.getElementById('sidebar-close')?.addEventListener('click', () => {
      document.getElementById('clients-sidebar')?.classList.remove('sidebar-open');
    });

    // Initialise Google & sync
    await initGoogleAndSync();

    // Update sync timer label every minute
    syncTimerDisplay = setInterval(updateSyncLabel, 60000);
  }

  async function initGoogleAndSync() {
    const clientId = await db.getConfig('google_client_id');
    if (!clientId) {
      UI.updateSyncStatus('idle');
      UI.toast('No Google Client ID configured. Open Settings to connect Gmail.', 'warning', 7000);
      return;
    }

    // Wait for Google Identity Services to load
    await waitForGIS();

    try {
      await GmailAPI.init(clientId);
    } catch (e) {
      UI.toast('Google API init failed: ' + e.message, 'error');
      return;
    }

    const lastSync = await db.getConfig('last_sync_time');
    isFirstRun = !lastSync;

    // Start sync if overdue or first run
    if (isFirstRun || !lastSync || (Date.now() - new Date(lastSync).getTime()) > SYNC_INTERVAL_MS) {
      await runSync();
    } else {
      UI.updateSyncStatus('success', lastSync);
    }

    // Schedule recurring sync
    syncTimer = setInterval(runSync, SYNC_INTERVAL_MS);
  }

  async function manualSync() {
    await runSync();
  }

  async function runSync() {
    if (isSyncing) return;
    isSyncing = true;

    UI.updateSyncStatus('syncing');

    try {
      const authed = await GmailAPI.ensureAuth();
      if (!authed) {
        UI.toast('Google sign-in required to sync emails', 'warning');
        UI.updateSyncStatus('error');
        return;
      }
    } catch (e) {
      UI.toast('Auth error: ' + e.message, 'error');
      UI.updateSyncStatus('error');
      isSyncing = false;
      return;
    }

    const lastEmailDate = await db.getConfig('last_email_date');
    const firstRun = isFirstRun;

    if (firstRun) {
      UI.showLoading('Fetching emails from the last 30 days…');
    }

    try {
      let processed = 0, created = 0, updated = 0;
      let latestDate = lastEmailDate;

      const emails = await GmailAPI.fetchEmails(
        lastEmailDate,
        firstRun,
        (current, total) => {
          if (firstRun && total) {
            UI.setLoadingMsg(`Fetching emails… ${current}/${total}`);
            UI.setLoadingProgress(current, total);
          }
        }
      );

      if (firstRun) UI.setLoadingMsg(`Processing ${emails.length} emails…`);

      for (const email of emails) {
        const result = await TaskManager.processEmail(email);
        processed++;
        if (result.isNew) created++; else if (result.task) updated++;
        if (!latestDate || new Date(email.date) > new Date(latestDate)) {
          latestDate = email.date;
        }
        if (firstRun && processed % 20 === 0) {
          UI.setLoadingMsg(`Processed ${processed}/${emails.length} emails…`);
          UI.setLoadingProgress(processed, emails.length);
        }
      }

      const now = new Date().toISOString();
      await db.setConfig('last_sync_time', now);
      if (latestDate) await db.setConfig('last_email_date', latestDate);
      if (firstRun) {
        await db.setConfig('last_sync_time', now);
        isFirstRun = false;
      }

      await UI.refreshAll();
      UI.updateSyncStatus('success', now);

      if (created > 0 || updated > 0) {
        UI.toast(`Sync complete: ${created} new task${created !== 1 ? 's' : ''}, ${updated} updated`, 'success');
      } else if (emails.length > 0) {
        UI.toast(`Synced ${emails.length} emails — no new tasks`, 'info');
      }
    } catch (e) {
      console.error('Sync error:', e);
      UI.updateSyncStatus('error');
      UI.toast('Sync failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      isSyncing = false;
      UI.hideLoading();
    }
  }

  async function updateSyncLabel() {
    const lastSync = await db.getConfig('last_sync_time');
    if (lastSync && !isSyncing) {
      UI.updateSyncStatus('success', lastSync);
    }
    // Show countdown to next sync
    if (lastSync && syncTimer) {
      const elapsed = Date.now() - new Date(lastSync).getTime();
      const remaining = Math.max(0, SYNC_INTERVAL_MS - elapsed);
      const mins = Math.ceil(remaining / 60000);
      const label = document.getElementById('sync-next');
      if (label) label.textContent = mins > 1 ? `Next sync in ${mins}m` : 'Syncing soon…';
    }
  }

  function waitForGIS() {
    return new Promise(resolve => {
      if (window.google?.accounts?.oauth2) { resolve(); return; }
      let tries = 0;
      const check = setInterval(() => {
        tries++;
        if (window.google?.accounts?.oauth2) { clearInterval(check); resolve(); }
        else if (tries > 30) { clearInterval(check); resolve(); } // give up after 3s
      }, 100);
    });
  }

  /* Register service worker */
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sabhya-s-daily-tracker/sw.js').catch(() => {});
    }
  }

  return { boot, registerSW };
})();

/* Init on DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  App.registerSW();
  App.boot();
});
