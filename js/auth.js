/**
 * Pattern Lock Authentication
 * Stores SHA-256 hash of the pattern in localStorage.
 * Supports touch and mouse input.
 */
class PatternLock {
  constructor() {
    this.canvas    = null;
    this.ctx       = null;
    this.dots      = [];
    this.pattern   = [];
    this.drawing   = false;
    this.mode      = 'unlock';   // 'set' | 'confirm' | 'unlock' | 'change'
    this.pendingPattern = null;
    this.KEY       = 'tracker_pattern_hash';
    this.GRID      = 3;
    this.DOT_R     = 10;
    this.DOT_GAP   = 90;
    this.PAD       = 45;

    this._bound = {};
    this.init();
  }

  init() {
    this.canvas = document.getElementById('pattern-canvas');
    this.ctx    = this.canvas.getContext('2d');
    this._calcDots();
    this._bindEvents();

    const hasPattern = !!localStorage.getItem(this.KEY);
    if (!hasPattern) {
      this.setMode('set');
    } else {
      this.setMode('unlock');
      document.getElementById('btn-reset-pattern').style.display = 'inline-block';
    }
    this.redraw();
  }

  _calcDots() {
    this.dots = [];
    for (let r = 0; r < this.GRID; r++) {
      for (let c = 0; c < this.GRID; c++) {
        this.dots.push({
          x: this.PAD + c * this.DOT_GAP,
          y: this.PAD + r * this.DOT_GAP,
          idx: r * this.GRID + c,
          active: false,
        });
      }
    }
  }

  _bindEvents() {
    const c = this.canvas;
    const self = this;

    this._bound.mousedown = e => { e.preventDefault(); self._start(self._pos(e)); };
    this._bound.mousemove = e => { e.preventDefault(); if (self.drawing) self._move(self._pos(e)); };
    this._bound.mouseup   = e => { e.preventDefault(); self._end(); };
    this._bound.touchstart = e => { e.preventDefault(); self._start(self._pos(e.touches[0])); };
    this._bound.touchmove  = e => { e.preventDefault(); if (self.drawing) self._move(self._pos(e.touches[0])); };
    this._bound.touchend   = e => { e.preventDefault(); self._end(); };

    c.addEventListener('mousedown',  this._bound.mousedown);
    c.addEventListener('mousemove',  this._bound.mousemove);
    c.addEventListener('mouseup',    this._bound.mouseup);
    c.addEventListener('touchstart', this._bound.touchstart, { passive: false });
    c.addEventListener('touchmove',  this._bound.touchmove,  { passive: false });
    c.addEventListener('touchend',   this._bound.touchend,   { passive: false });
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  _start(pos) {
    this.drawing = true;
    this.pattern = [];
    this.dots.forEach(d => d.active = false);
    this.currentPos = pos;
    this._move(pos);
  }

  _move(pos) {
    this.currentPos = pos;
    this.dots.forEach(d => {
      if (!d.active) {
        const dx = pos.x - d.x, dy = pos.y - d.y;
        if (Math.sqrt(dx*dx + dy*dy) <= this.DOT_R * 2) {
          d.active = true;
          this.pattern.push(d.idx);
        }
      }
    });
    this.redraw();
  }

  _end() {
    if (!this.drawing) return;
    this.drawing = false;
    this.currentPos = null;
    this._handlePatternComplete();
  }

  async _handlePatternComplete() {
    if (this.pattern.length < 4) {
      this._showHint('Connect at least 4 dots', 'error');
      this._flashReset();
      return;
    }

    if (this.mode === 'set') {
      this.pendingPattern = [...this.pattern];
      this.setMode('confirm');
      this._showHint('Draw the same pattern to confirm', '');
      this._flashReset(400);
    } else if (this.mode === 'confirm') {
      if (this._patternsMatch(this.pattern, this.pendingPattern)) {
        const hash = await this._hash(this.pendingPattern);
        localStorage.setItem(this.KEY, hash);
        this.pendingPattern = null;
        this._showHint('Pattern set! Unlocking…', 'success');
        setTimeout(() => this._unlock(), 600);
      } else {
        this._showHint('Patterns do not match. Try again.', 'error');
        this.pendingPattern = null;
        this.setMode('set');
        this._flashReset(700);
      }
    } else if (this.mode === 'unlock' || this.mode === 'change_confirm') {
      const hash    = await this._hash(this.pattern);
      const stored  = localStorage.getItem(this.KEY);
      if (hash === stored) {
        if (this.mode === 'change_confirm') {
          this.setMode('change_new');
          this._showHint('Draw your new pattern', '');
          this._flashReset(400);
        } else {
          this._showHint('', '');
          this._unlock();
        }
      } else {
        this._showHint('Wrong pattern. Try again.', 'error');
        this._flashReset(700);
      }
    } else if (this.mode === 'change_new') {
      this.pendingPattern = [...this.pattern];
      this.setMode('change_set');
      this._showHint('Confirm your new pattern', '');
      this._flashReset(400);
    } else if (this.mode === 'change_set') {
      if (this._patternsMatch(this.pattern, this.pendingPattern)) {
        const hash = await this._hash(this.pendingPattern);
        localStorage.setItem(this.KEY, hash);
        this.pendingPattern = null;
        this._showHint('Pattern changed!', 'success');
        this.setMode('unlock');
        setTimeout(() => this._unlock(), 700);
      } else {
        this._showHint('Patterns do not match. Try again.', 'error');
        this.pendingPattern = null;
        this.setMode('change_new');
        this._flashReset(700);
      }
    }
  }

  _patternsMatch(a, b) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }

  async _hash(pattern) {
    const str  = pattern.join('-');
    const buf  = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  _flashReset(delay = 500) {
    setTimeout(() => {
      this.pattern = [];
      this.dots.forEach(d => d.active = false);
      this.redraw();
    }, delay);
  }

  _unlock() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('fab').classList.remove('hidden');
    if (window.app) app.onUnlock();
  }

  _showHint(msg, type) {
    const el = document.getElementById('auth-hint');
    const msgEl = document.getElementById('auth-message');
    el.textContent = msg || ' ';
    el.className = 'auth-hint' + (type ? ' ' + type : '');
    if (type === 'error') {
      msgEl.style.color = 'var(--urgent)';
      setTimeout(() => msgEl.style.color = '', 1000);
    }
  }

  setMode(mode) {
    this.mode = mode;
    const el = document.getElementById('auth-message');
    const messages = {
      set:           'Draw a new pattern (min 4 dots)',
      confirm:       'Confirm your pattern',
      unlock:        'Draw your pattern to unlock',
      change_confirm:'Draw your current pattern to verify',
      change_new:    'Draw your new pattern',
      change_set:    'Confirm new pattern',
    };
    el.textContent = messages[mode] || 'Draw your pattern';
    this.pattern = [];
    this.dots.forEach(d => d.active = false);
    this.redraw();
  }

  redraw() {
    const ctx = this.ctx;
    const w   = this.canvas.width;
    const h   = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw lines between connected dots
    if (this.pattern.length > 1) {
      ctx.beginPath();
      const first = this.dots[this.pattern[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this.pattern.length; i++) {
        const d = this.dots[this.pattern[i]];
        ctx.lineTo(d.x, d.y);
      }
      if (this.drawing && this.currentPos) {
        ctx.lineTo(this.currentPos.x, this.currentPos.y);
      }
      ctx.strokeStyle = 'rgba(108,99,255,0.6)';
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.stroke();
    } else if (this.drawing && this.currentPos && this.pattern.length === 1) {
      const first = this.dots[this.pattern[0]];
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(this.currentPos.x, this.currentPos.y);
      ctx.strokeStyle = 'rgba(108,99,255,0.4)';
      ctx.lineWidth   = 3;
      ctx.stroke();
    }

    // Draw dots
    this.dots.forEach(dot => {
      const active = dot.active;
      const r = this.DOT_R;

      // Outer ring
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, active ? r + 4 : r + 2, 0, Math.PI * 2);
      ctx.fillStyle = active ? 'rgba(108,99,255,0.2)' : 'rgba(255,255,255,0.05)';
      ctx.fill();

      // Inner dot
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, active ? r : r - 2, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#6C63FF' : 'rgba(255,255,255,0.25)';
      ctx.fill();

      // Center dot highlight
      if (active) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    });
  }

  // Public methods called from HTML
  lock() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('fab').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    const hasPattern = !!localStorage.getItem(this.KEY);
    this.setMode(hasPattern ? 'unlock' : 'set');
    this._showHint('', '');
  }

  changePattern() {
    this.lock();
    this.setMode('change_confirm');
    document.getElementById('btn-cancel-pattern').style.display = 'inline-block';
    document.getElementById('btn-reset-pattern').style.display = 'none';
  }

  beginReset() {
    if (confirm('This will remove your current pattern. You will be asked to set a new one.\n\nContinue?')) {
      localStorage.removeItem(this.KEY);
      this.setMode('set');
      this._showHint('', '');
      document.getElementById('btn-reset-pattern').style.display = 'none';
    }
  }

  cancelChange() {
    this.setMode('unlock');
    this._showHint('', '');
    document.getElementById('btn-cancel-pattern').style.display = 'none';
    document.getElementById('btn-reset-pattern').style.display = 'inline-block';
  }
}

// Instantiate
const auth = new PatternLock();
