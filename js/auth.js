/**
 * Pattern-lock authentication (3×3 grid, Android-style).
 */
const Auth = {
  SETTING_KEY: 'patternHash',
  MIN_DOTS: 4,
  _canvas: null,
  _ctx: null,
  _dots: [],
  _selected: [],
  _drawing: false,
  _mode: 'login',  // 'login' | 'setup' | 'confirm'
  _setupFirst: null,
  _onSuccess: null,
  _onSetupComplete: null,

  async isSetup() {
    const hash = await DB.getSetting(this.SETTING_KEY);
    return !!hash;
  },

  async verify(pattern) {
    const stored = await DB.getSetting(this.SETTING_KEY);
    const hash = await this._hash(pattern);
    return hash === stored;
  },

  async save(pattern) {
    const hash = await this._hash(pattern);
    await DB.setSetting(this.SETTING_KEY, hash);
    // Store pattern key for data encryption (never store plain pattern)
    sessionStorage.setItem('_pk', hash.slice(0, 32));
  },

  getSessionKey() {
    return sessionStorage.getItem('_pk');
  },

  async _hash(pattern) {
    const str = pattern.join('-');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // ── UI ─────────────────────────────────────────────────

  render(container, mode, callbacks = {}) {
    this._mode = mode;
    this._onSuccess = callbacks.onSuccess;
    this._onSetupComplete = callbacks.onSetupComplete;
    this._selected = [];
    this._setupFirst = null;

    container.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="24" fill="#6366f1"/>
            <path d="M14 34L24 14L34 34" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M17 28H31" stroke="white" stroke-width="3" stroke-linecap="round"/>
          </svg>
          <h1>Daily Tracker</h1>
        </div>
        <p class="auth-hint" id="authHint">${mode === 'setup' ? 'Draw your unlock pattern' : 'Draw pattern to unlock'}</p>
        <div class="pattern-container">
          <canvas id="patternCanvas" width="270" height="270"></canvas>
        </div>
        <p class="auth-error" id="authError"></p>
        ${mode === 'setup' ? '<button class="btn-ghost" id="authReset">Clear</button>' : ''}
      </div>
    `;

    this._canvas = document.getElementById('patternCanvas');
    this._ctx = this._canvas.getContext('2d');
    this._initDots();
    this._draw();
    this._bindEvents();

    if (mode === 'setup') {
      document.getElementById('authReset')?.addEventListener('click', () => this._reset());
    }
  },

  _initDots() {
    this._dots = [];
    const size = 270;
    const gap = size / 3;
    const offset = gap / 2;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        this._dots.push({
          x: offset + c * gap,
          y: offset + r * gap,
          index: r * 3 + c,
        });
      }
    }
  },

  _bindEvents() {
    const canvas = this._canvas;
    const getPos = e => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const src = e.touches ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top) * scaleY,
      };
    };

    const start = e => {
      e.preventDefault();
      this._drawing = true;
      this._selected = [];
      this._currentPos = null;
      const pos = getPos(e);
      this._checkDot(pos);
      this._draw();
    };
    const move = e => {
      e.preventDefault();
      if (!this._drawing) return;
      this._currentPos = getPos(e);
      this._checkDot(this._currentPos);
      this._draw();
    };
    const end = e => {
      e.preventDefault();
      if (!this._drawing) return;
      this._drawing = false;
      this._currentPos = null;
      this._draw();
      this._onPatternEnd();
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end, { passive: false });
  },

  _checkDot(pos) {
    for (const dot of this._dots) {
      const dist = Math.hypot(pos.x - dot.x, pos.y - dot.y);
      if (dist < 30 && !this._selected.includes(dot.index)) {
        this._selected.push(dot.index);
      }
    }
  },

  _draw() {
    const ctx = this._ctx;
    const { width, height } = this._canvas;
    ctx.clearRect(0, 0, width, height);

    // Draw lines
    if (this._selected.length > 1) {
      ctx.beginPath();
      const first = this._dots[this._selected[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this._selected.length; i++) {
        const d = this._dots[this._selected[i]];
        ctx.lineTo(d.x, d.y);
      }
      if (this._drawing && this._currentPos) {
        ctx.lineTo(this._currentPos.x, this._currentPos.y);
      }
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (this._drawing && this._currentPos && this._selected.length === 1) {
      const d = this._dots[this._selected[0]];
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(this._currentPos.x, this._currentPos.y);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw dots
    for (const dot of this._dots) {
      const active = this._selected.includes(dot.index);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, active ? 14 : 10, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#6366f1' : 'rgba(99,102,241,0.25)';
      ctx.fill();

      if (active) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    }
  },

  _reset() {
    this._selected = [];
    this._drawing = false;
    this._currentPos = null;
    this._setupFirst = null;
    document.getElementById('authHint').textContent = 'Draw your unlock pattern';
    document.getElementById('authError').textContent = '';
    this._draw();
  },

  async _onPatternEnd() {
    const pattern = [...this._selected];
    if (pattern.length < this.MIN_DOTS) {
      this._showError(`Connect at least ${this.MIN_DOTS} dots`);
      setTimeout(() => this._reset(), 1200);
      return;
    }

    if (this._mode === 'login') {
      const ok = await this.verify(pattern);
      if (ok) {
        await this.save(pattern); // refresh session key
        this._showSuccess();
        setTimeout(() => this._onSuccess?.(), 500);
      } else {
        this._showError('Incorrect pattern. Try again.');
        setTimeout(() => this._reset(), 1200);
      }
    } else if (this._mode === 'setup') {
      if (!this._setupFirst) {
        this._setupFirst = pattern;
        document.getElementById('authHint').textContent = 'Draw pattern again to confirm';
        document.getElementById('authError').textContent = '';
        this._selected = [];
        this._draw();
      } else {
        if (JSON.stringify(pattern) === JSON.stringify(this._setupFirst)) {
          await this.save(pattern);
          this._showSuccess();
          setTimeout(() => this._onSetupComplete?.(), 500);
        } else {
          this._showError('Patterns do not match. Try again.');
          setTimeout(() => this._reset(), 1400);
        }
      }
    }
  },

  _showError(msg) {
    document.getElementById('authError').textContent = msg;
    this._canvas.style.animation = 'shake 0.4s ease';
    setTimeout(() => { this._canvas.style.animation = ''; }, 400);
    // Flash dots red
    for (const dot of this._dots) {
      if (this._selected.includes(dot.index)) {
        const ctx = this._ctx;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    }
  },

  _showSuccess() {
    document.getElementById('authHint').textContent = '✓ Unlocked';
    document.getElementById('authError').textContent = '';
    for (const dot of this._dots) {
      if (this._selected.includes(dot.index)) {
        const ctx = this._ctx;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    }
  },
};
