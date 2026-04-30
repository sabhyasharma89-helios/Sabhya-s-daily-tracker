const App = {
  async init() {
    Auth.has() ? this._auth() : this._setup();
  },

  _auth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    const lockout = Auth.locked();
    if (lockout) {
      const mins = Math.ceil((lockout - Date.now()) / 60000);
      document.getElementById('auth-message').textContent = `Locked for ${mins} min`;
      document.getElementById('auth-error').textContent = `Too many attempts. Try again in ${mins} minute(s).`;
      document.getElementById('auth-error').classList.remove('hidden');
      return;
    }
    document.getElementById('reset-pattern-btn').classList.remove('hidden');
    const lock = new PatternLock('pattern-canvas', {
      minDots: 4,
      onComplete: async pattern => {
        if (await Auth.verify(pattern)) {
          Auth.clear(); lock.reset(); this._dashboard();
        } else {
          lock.showError();
          const d = Auth.fail();
          const err = document.getElementById('auth-error');
          err.classList.remove('hidden');
          err.textContent = d.until
            ? 'Too many attempts. Locked for 5 minutes.'
            : `Incorrect pattern. ${Auth.MAX - (d.c || 0)} attempt(s) left.`;
        }
      }
    });
  },

  _setup() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('setup-screen').classList.remove('hidden');
    let first = null;
    const lock = new PatternLock('setup-canvas', {
      minDots: 4,
      onComplete: async pattern => {
        if (!first) {
          first = pattern;
          document.getElementById('setup-message').textContent = 'Draw the same pattern again to confirm';
          document.getElementById('setup-hint').textContent = `Pattern: ${pattern.length} dots`;
          lock.reset();
        } else if (first.join('-') === pattern.join('-')) {
          await Auth.set(pattern);
          document.getElementById('setup-hint').textContent = 'Pattern saved!';
          setTimeout(() => this._dashboard(), 500);
        } else {
          first = null;
          document.getElementById('setup-message').textContent = 'Patterns did not match. Try again.';
          document.getElementById('setup-hint').textContent = '';
          lock.showError();
        }
      }
    });
  },

  _dashboard() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    UI.init();
    Sync.start();
  },

  lock() { Sync.stop(); document.getElementById('dashboard').classList.add('hidden'); this._auth(); }
};

document.addEventListener('DOMContentLoaded', () => App.init());
