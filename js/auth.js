/* ── Pattern Lock Authentication ─────────────────────────────────────
   Supports set-pattern (first time) and verify-pattern flows.
   Pattern is stored as a SHA-256 hex digest in localStorage.
   ─────────────────────────────────────────────────────────────────── */

const Auth = (() => {
  const KEY_HASH    = 'tracker_pattern_hash';
  const KEY_FAILS   = 'tracker_fail_count';
  const KEY_LOCKOUT = 'tracker_lockout_until';
  const MIN_DOTS = 4;
  const MAX_FAILS = 5;
  const LOCKOUT_MS = 30_000;

  let patternInstance = null;

  /* SHA-256 of a number array → hex string */
  async function hashPattern(dotArray) {
    const str = dotArray.join('-');
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(str)
    );
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function storedHash() { return localStorage.getItem(KEY_HASH); }
  function hasPattern()  { return !!storedHash(); }

  function failCount()   { return parseInt(localStorage.getItem(KEY_FAILS) || '0'); }
  function incFails()    { localStorage.setItem(KEY_FAILS, failCount() + 1); }
  function resetFails()  { localStorage.removeItem(KEY_FAILS); localStorage.removeItem(KEY_LOCKOUT); }

  function isLockedOut() {
    const until = parseInt(localStorage.getItem(KEY_LOCKOUT) || '0');
    return Date.now() < until;
  }
  function setLockout() {
    localStorage.setItem(KEY_LOCKOUT, Date.now() + LOCKOUT_MS);
  }
  function lockoutSecondsLeft() {
    const until = parseInt(localStorage.getItem(KEY_LOCKOUT) || '0');
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  /* ── PatternLock widget ─────────────────────────────────────────── */
  class PatternLock {
    constructor(gridEl, canvasEl, onComplete) {
      this.grid = gridEl;
      this.canvas = canvasEl;
      this.ctx = canvasEl.getContext('2d');
      this.onComplete = onComplete;
      this.dots = [];
      this.pattern = [];
      this.drawing = false;
      this.currentPos = null;
      this._init();
    }

    _init() {
      this.grid.innerHTML = '';
      this.dots = [];
      for (let i = 0; i < 9; i++) {
        const d = document.createElement('div');
        d.className = 'pattern-dot';
        d.dataset.index = i;
        this.grid.appendChild(d);
        this.dots.push(d);
      }
      this._resize();
      window.addEventListener('resize', () => this._resize());
      this._addListeners();
    }

    _resize() {
      const rect = this.grid.getBoundingClientRect();
      this.canvas.width  = rect.width;
      this.canvas.height = rect.height;
    }

    _dotCenter(i) {
      const d  = this.dots[i].getBoundingClientRect();
      const gr = this.grid.getBoundingClientRect();
      return { x: d.left - gr.left + d.width / 2, y: d.top - gr.top + d.height / 2 };
    }

    _posFromEvent(e) {
      const r = this.grid.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }

    _hitTest(pos) {
      for (let i = 0; i < 9; i++) {
        if (this.pattern.includes(i)) continue;
        const c = this._dotCenter(i);
        const d = Math.hypot(pos.x - c.x, pos.y - c.y);
        if (d < 28) return i;
      }
      return -1;
    }

    _draw() {
      const { canvas, ctx } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!this.pattern.length) return;

      ctx.strokeStyle = 'rgba(99,102,241,.7)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const start = this._dotCenter(this.pattern[0]);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < this.pattern.length; i++) {
        const c = this._dotCenter(this.pattern[i]);
        ctx.lineTo(c.x, c.y);
      }
      if (this.drawing && this.currentPos) {
        ctx.lineTo(this.currentPos.x, this.currentPos.y);
      }
      ctx.stroke();

      this.pattern.forEach(i => this.dots[i].classList.add('active'));
    }

    _addListeners() {
      const start = e => {
        e.preventDefault();
        this.drawing = true;
        this.pattern = [];
        this.dots.forEach(d => d.classList.remove('active', 'error', 'success'));
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const pos = this._posFromEvent(e);
        const hit = this._hitTest(pos);
        if (hit !== -1) this.pattern.push(hit);
        this._draw();
      };

      const move = e => {
        e.preventDefault();
        if (!this.drawing) return;
        this.currentPos = this._posFromEvent(e);
        const hit = this._hitTest(this.currentPos);
        if (hit !== -1) this.pattern.push(hit);
        this._draw();
      };

      const end = e => {
        e.preventDefault();
        if (!this.drawing) return;
        this.drawing = false;
        this.currentPos = null;
        this._draw();
        if (this.pattern.length >= MIN_DOTS) {
          this.onComplete(this.pattern.slice());
        } else {
          this.flash('error');
        }
      };

      this.grid.addEventListener('mousedown', start);
      this.grid.addEventListener('mousemove', move);
      document.addEventListener('mouseup', end);
      this.grid.addEventListener('touchstart', start, { passive: false });
      this.grid.addEventListener('touchmove',  move,  { passive: false });
      this.grid.addEventListener('touchend',   end,   { passive: false });
    }

    flash(type) {
      this.dots.forEach(d => d.classList.add(type));
      setTimeout(() => {
        this.pattern = [];
        this.dots.forEach(d => d.classList.remove('active', 'error', 'success'));
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }, 700);
    }

    reset() {
      this.pattern = [];
      this.drawing = false;
      this.currentPos = null;
      this.dots.forEach(d => d.classList.remove('active', 'error', 'success'));
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /* ── Public Auth Flow ───────────────────────────────────────────── */
  let pendingSetPattern = null;
  let authResolve = null;

  function showScreen() { document.getElementById('authScreen').classList.remove('fade-out', 'hidden'); }
  function hideScreen() {
    const s = document.getElementById('authScreen');
    s.classList.add('fade-out');
    setTimeout(() => s.classList.add('hidden'), 300);
  }

  function setMsg(text, cls = '') {
    const el = document.getElementById('authMessage');
    el.textContent = text;
    el.className = 'auth-subtitle ' + cls;
  }
  function setHint(text) { document.getElementById('authHint').textContent = text; }

  async function startSetPattern() {
    pendingSetPattern = null;
    setMsg('Draw a new pattern (min 4 dots)');
    setHint('Connect at least 4 dots');
    const actionBtn = document.getElementById('authActionBtn');
    actionBtn.style.display = 'none';
    patternInstance.reset();
  }

  async function init(onAuthenticated) {
    authResolve = onAuthenticated;
    const grid   = document.getElementById('patternGrid');
    const canvas = document.getElementById('patternCanvas');

    patternInstance = new PatternLock(grid, canvas, async (pat) => {
      if (isLockedOut()) {
        setMsg(`Too many attempts. Wait ${lockoutSecondsLeft()}s`, 'error');
        patternInstance.flash('error');
        return;
      }

      if (!hasPattern()) {
        /* Setting pattern for the first time */
        if (!pendingSetPattern) {
          pendingSetPattern = pat;
          setMsg('Confirm your pattern', 'success');
          setHint('Draw the same pattern again to confirm');
          patternInstance.reset();
        } else {
          if (pendingSetPattern.join('-') === pat.join('-')) {
            const h = await hashPattern(pat);
            localStorage.setItem(KEY_HASH, h);
            resetFails();
            setMsg('Pattern set! Unlocking…', 'success');
            patternInstance.flash('success');
            setTimeout(() => { hideScreen(); onAuthenticated(); }, 700);
          } else {
            pendingSetPattern = null;
            setMsg('Patterns do not match. Try again', 'error');
            setHint('Draw a new pattern');
            patternInstance.flash('error');
          }
        }
      } else {
        /* Verifying existing pattern */
        const h = await hashPattern(pat);
        if (h === storedHash()) {
          resetFails();
          setMsg('Unlocked!', 'success');
          patternInstance.flash('success');
          setTimeout(() => { hideScreen(); onAuthenticated(); }, 500);
        } else {
          incFails();
          const f = failCount();
          if (f >= MAX_FAILS) {
            setLockout();
            setMsg(`Too many attempts. Locked for ${LOCKOUT_MS / 1000}s`, 'error');
          } else {
            setMsg(`Wrong pattern. ${MAX_FAILS - f} attempt(s) left`, 'error');
          }
          patternInstance.flash('error');
        }
      }
    });

    /* Show appropriate prompt */
    if (!hasPattern()) {
      setMsg('Set your unlock pattern (min 4 dots)');
      setHint('Connect at least 4 dots to create a pattern');
    } else if (isLockedOut()) {
      setMsg(`Too many failed attempts. Wait ${lockoutSecondsLeft()}s`, 'error');
      startLockoutTimer();
    } else {
      setMsg('Draw your unlock pattern');
      setHint('');
    }
  }

  function startLockoutTimer() {
    const id = setInterval(() => {
      if (!isLockedOut()) {
        clearInterval(id);
        setMsg('Draw your unlock pattern');
        setHint('');
      } else {
        setMsg(`Too many failed attempts. Wait ${lockoutSecondsLeft()}s`, 'error');
      }
    }, 1000);
  }

  function triggerChangePattern() {
    /* Called from settings "Change pattern" */
    localStorage.removeItem(KEY_HASH);
    pendingSetPattern = null;
    showScreen();
    document.getElementById('dashboard').classList.add('hidden');
    patternInstance.reset();
    setMsg('Draw a new pattern (min 4 dots)');
    setHint('Connect at least 4 dots');
  }

  function lock() {
    showScreen();
    document.getElementById('dashboard').classList.add('hidden');
    patternInstance.reset();
    setMsg('Draw your unlock pattern');
    setHint('');
  }

  return { init, triggerChangePattern, lock, hasPattern };
})();
