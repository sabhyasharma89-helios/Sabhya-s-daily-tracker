/* ═══════════════════════════════════════════════════════
   PATTERN LOCK AUTHENTICATION
═══════════════════════════════════════════════════════ */

class PatternLock {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      minDots: 4,
      onComplete: null,
      ...options,
    };

    this.path = [];
    this.isDrawing = false;
    this.currentMousePos = null;
    this.dots = [];
    this.dotPositions = [];
    this.canvas = null;
    this.ctx = null;
    this.SIZE = 3; // 3×3 grid

    this._render();
    this._attachEvents();
  }

  _render() {
    this.container.innerHTML = '';
    this.container.style.cssText = 'position:relative;display:inline-block;touch-action:none;';

    const CELL = 80;
    const GAP = 10;
    const PAD = 20;
    const TOTAL = this.SIZE * CELL + (this.SIZE - 1) * GAP + PAD * 2;

    // Canvas underneath
    this.canvas = document.createElement('canvas');
    this.canvas.width = TOTAL;
    this.canvas.height = TOTAL;
    this.canvas.style.cssText = `position:absolute;top:0;left:0;width:${TOTAL}px;height:${TOTAL}px;pointer-events:none;z-index:1;`;
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    // Dot grid
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(3,${CELL}px);grid-template-rows:repeat(3,${CELL}px);gap:${GAP}px;padding:${PAD}px;position:relative;z-index:2;`;
    this.dots = [];

    for (let i = 0; i < 9; i++) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center;`;

      const dot = document.createElement('div');
      dot.dataset.index = i;
      dot.style.cssText = `
        width:56px;height:56px;border-radius:50%;
        background:#1e293b;border:2px solid #334155;
        display:flex;align-items:center;justify-content:center;
        transition:all 0.12s;cursor:pointer;
      `;

      const inner = document.createElement('div');
      inner.style.cssText = `width:12px;height:12px;border-radius:50%;background:#475569;transition:all 0.12s;`;
      dot.appendChild(inner);
      wrapper.appendChild(dot);
      grid.appendChild(wrapper);
      this.dots.push(dot);
    }

    this.container.appendChild(grid);
    requestAnimationFrame(() => this._calcPositions());
  }

  _calcPositions() {
    const containerRect = this.container.getBoundingClientRect();
    this.dotPositions = this.dots.map(dot => {
      const r = dot.getBoundingClientRect();
      return { x: r.left - containerRect.left + r.width / 2, y: r.top - containerRect.top + r.height / 2 };
    });
  }

  _getEventPos(e) {
    const rect = this.container.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  _nearestDot(pos) {
    for (let i = 0; i < this.dotPositions.length; i++) {
      if (this.path.includes(i)) continue;
      const dp = this.dotPositions[i];
      const dist = Math.hypot(pos.x - dp.x, pos.y - dp.y);
      if (dist < 32) return i;
    }
    return null;
  }

  _activateDot(i) {
    const dot = this.dots[i];
    dot.style.background = '#312e81';
    dot.style.borderColor = '#6366f1';
    dot.querySelector('div').style.cssText = 'width:18px;height:18px;border-radius:50%;background:#6366f1;box-shadow:0 0 12px rgba(99,102,241,0.6);';
  }

  _drawLines() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.path.length) return;

    ctx.strokeStyle = 'rgba(99,102,241,0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const start = this.dotPositions[this.path[0]];
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < this.path.length; i++) {
      const p = this.dotPositions[this.path[i]];
      ctx.lineTo(p.x, p.y);
    }
    if (this.isDrawing && this.currentMousePos) {
      ctx.lineTo(this.currentMousePos.x, this.currentMousePos.y);
    }
    ctx.stroke();
  }

  _onStart(e) {
    if (e.type === 'touchstart') e.preventDefault();
    this._calcPositions();
    const pos = this._getEventPos(e);
    const idx = this._nearestDot(pos);
    if (idx === null) return;
    this.isDrawing = true;
    this.path = [idx];
    this._activateDot(idx);
    this.currentMousePos = pos;
    this._drawLines();
  }

  _onMove(e) {
    if (!this.isDrawing) return;
    if (e.type === 'touchmove') e.preventDefault();
    const pos = this._getEventPos(e);
    this.currentMousePos = pos;
    const idx = this._nearestDot(pos);
    if (idx !== null) {
      this.path.push(idx);
      this._activateDot(idx);
    }
    this._drawLines();
  }

  _onEnd(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.currentMousePos = null;
    this._drawLines();

    if (this.path.length < this.options.minDots) {
      this.showError(`Use at least ${this.options.minDots} dots`);
      setTimeout(() => this.reset(), 900);
      return;
    }
    if (this.options.onComplete) {
      this.options.onComplete([...this.path]);
    }
  }

  _attachEvents() {
    const c = this.container;
    c.addEventListener('mousedown', e => this._onStart(e));
    c.addEventListener('mousemove', e => this._onMove(e));
    document.addEventListener('mouseup', e => this._onEnd(e));
    c.addEventListener('touchstart', e => this._onStart(e), { passive: false });
    c.addEventListener('touchmove', e => this._onMove(e), { passive: false });
    c.addEventListener('touchend', e => this._onEnd(e));
  }

  showError(msg) {
    this.dots.forEach(d => {
      if (this.path.includes(parseInt(d.dataset.index))) {
        d.style.background = '#450a0a';
        d.style.borderColor = '#ef4444';
        d.querySelector('div').style.background = '#ef4444';
      }
    });
    this.ctx.strokeStyle = 'rgba(239,68,68,0.5)';
    this._drawLines();
    const status = document.getElementById('pattern-status') || document.getElementById('setup-pattern-status');
    if (status) { status.textContent = msg; status.className = 'pattern-status error'; }
  }

  showSuccess() {
    this.dots.forEach(d => {
      if (this.path.includes(parseInt(d.dataset.index))) {
        d.style.background = '#052e16';
        d.style.borderColor = '#22c55e';
        d.querySelector('div').style.background = '#22c55e';
      }
    });
  }

  reset() {
    this.path = [];
    this.isDrawing = false;
    this.currentMousePos = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dots.forEach(d => {
      d.style.background = '#1e293b';
      d.style.borderColor = '#334155';
      const inner = d.querySelector('div');
      inner.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#475569;transition:all 0.12s;';
    });
    const status = document.getElementById('pattern-status') || document.getElementById('setup-pattern-status');
    if (status) { status.textContent = ''; status.className = 'pattern-status'; }
  }
}

/* ═══════════════════════════════════════════════════════
   AUTH MANAGER
═══════════════════════════════════════════════════════ */
const Auth = {
  lock: null,
  setupLock: null,
  setupPattern: null, // first draw stored, waiting for confirm
  setupStep: 0,       // 0 = first draw, 1 = confirm draw

  async init(db) {
    this.db = db;
    const hasPattern = await db.getSetting('patternHash');
    return !!hasPattern;
  },

  async hashPattern(path) {
    const str = path.join(',');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  renderLock() {
    this.lock = new PatternLock('pattern-lock-container', {
      onComplete: async (path) => {
        const hash = await this.hashPattern(path);
        const stored = await this.db.getSetting('patternHash');
        if (hash === stored) {
          this.lock.showSuccess();
          document.getElementById('pattern-status').textContent = '✓ Unlocked';
          document.getElementById('pattern-status').className = 'pattern-status success';
          setTimeout(() => this._onSuccess(), 400);
        } else {
          this.lock.showError('Incorrect pattern. Try again.');
          setTimeout(() => this.lock.reset(), 1000);
        }
      },
    });
  },

  renderSetupLock() {
    this.setupStep = 0;
    this.setupPattern = null;
    const statusEl = document.getElementById('setup-pattern-status');
    const instrEl = document.getElementById('setup-pattern-instruction');

    this.setupLock = new PatternLock('setup-pattern-container', {
      onComplete: async (path) => {
        if (this.setupStep === 0) {
          this.setupPattern = path;
          this.setupStep = 1;
          this.setupLock.showSuccess();
          setTimeout(() => {
            this.setupLock.reset();
            if (instrEl) instrEl.textContent = 'Draw the same pattern again to confirm';
            if (statusEl) { statusEl.textContent = 'Confirm your pattern'; statusEl.className = 'pattern-status'; }
          }, 500);
        } else {
          const h1 = await this.hashPattern(this.setupPattern);
          const h2 = await this.hashPattern(path);
          if (h1 === h2) {
            await this.db.setSetting('patternHash', h1);
            this.setupLock.showSuccess();
            if (statusEl) { statusEl.textContent = '✓ Pattern set!'; statusEl.className = 'pattern-status success'; }
            setTimeout(() => App.setupNext(), 600);
          } else {
            this.setupLock.showError("Patterns don't match. Start again.");
            this.setupStep = 0;
            this.setupPattern = null;
            if (instrEl) instrEl.textContent = 'Draw your pattern';
            setTimeout(() => this.setupLock.reset(), 900);
          }
        }
      },
    });
  },

  _onSuccess() {
    App.onAuthenticated();
  },

  showPatternScreen() {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = ''; });
    document.getElementById('pattern-screen').classList.add('active');
    if (!this.lock) this.renderLock();
    else this.lock.reset();
    document.getElementById('pattern-subtitle').textContent = 'Draw your pattern to unlock';
    document.getElementById('pattern-hint').textContent = '';
  },

  async resetPattern(db) {
    await db.setSetting('patternHash', null);
  },
};
