/* ════════════════════════════════════════════════════
   auth.js — Canvas-based pattern lock authentication
════════════════════════════════════════════════════ */

class PatternLock {
  constructor(canvasEl) {
    this.canvas  = canvasEl;
    this.ctx     = canvasEl.getContext('2d');
    this.dots    = [];
    this.path    = [];         // sequence of dot indices
    this.drawing = false;
    this.cursor  = null;
    this.flash   = null;       // 'error' | 'success' | null
    this.flashTimer = null;

    this._initDots();
    this._bindEvents();
    this._raf();
  }

  /* ── Layout ── */
  _initDots() {
    const W   = this.canvas.width;
    const pad = 60;
    const gap = (W - pad * 2) / 2;
    this.dots = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        this.dots.push({ x: pad + c * gap, y: pad + r * gap, idx: r * 3 + c });
      }
    }
  }

  /* ── Event binding (mouse + touch) ── */
  _bindEvents() {
    const el = this.canvas;
    const on = (type, fn) => el.addEventListener(type, fn, { passive: false });

    on('mousedown',  e => { this._start(this._pos(e)); });
    on('mousemove',  e => { if (this.drawing) this._move(this._pos(e)); });
    on('mouseup',    e => { if (this.drawing) this._end(); });
    on('mouseleave', e => { if (this.drawing) this._end(); });

    on('touchstart', e => { e.preventDefault(); this._start(this._pos(e.touches[0])); });
    on('touchmove',  e => { e.preventDefault(); if (this.drawing) this._move(this._pos(e.touches[0])); });
    on('touchend',   e => { e.preventDefault(); if (this.drawing) this._end(); });
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width  / r.width;
    const sy = this.canvas.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  /* ── Gesture handlers ── */
  _start(pos) {
    const d = this._hitDot(pos);
    if (!d) return;
    this.drawing = true;
    this.path    = [d.idx];
    this.cursor  = pos;
    this.flash   = null;
  }

  _move(pos) {
    this.cursor = pos;
    const d = this._hitDot(pos);
    if (d && !this.path.includes(d.idx)) {
      this.path.push(d.idx);
    }
  }

  _end() {
    this.drawing = false;
    this.cursor  = null;
    const pattern = this.path.join('-');
    this.path = [];
    this.onComplete(pattern);
  }

  _hitDot(pos) {
    const R = 26;   // hit-test radius (generous for touch)
    return this.dots.find(d => Math.hypot(d.x - pos.x, d.y - pos.y) < R) || null;
  }

  /* ── Public: flash feedback ── */
  showFlash(type) {
    this.flash = type;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flash = null; }, 800);
  }

  /* ── Render loop ── */
  _raf() {
    requestAnimationFrame(() => {
      this._draw();
      this._raf();
    });
  }

  _draw() {
    const ctx   = this.ctx;
    const W     = this.canvas.width;
    const H     = this.canvas.height;
    const color = this.flash === 'error'   ? '#f85149'
                : this.flash === 'success' ? '#3fb950'
                : '#58a6ff';

    ctx.clearRect(0, 0, W, H);

    /* lines between selected dots */
    const activePath = [...(this.drawing ? this.path : [])];

    if (activePath.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.globalAlpha = 0.7;

      const first = this.dots[activePath[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < activePath.length; i++) {
        const d = this.dots[activePath[i]];
        ctx.lineTo(d.x, d.y);
      }
      if (this.cursor) ctx.lineTo(this.cursor.x, this.cursor.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* dots */
    this.dots.forEach(d => {
      const selected = activePath.includes(d.idx);
      const order    = selected ? activePath.indexOf(d.idx) + 1 : null;

      if (selected) {
        /* glow ring */
        ctx.beginPath();
        ctx.arc(d.x, d.y, 22, 0, Math.PI * 2);
        ctx.fillStyle = color + '30';
        ctx.fill();

        /* filled circle */
        ctx.beginPath();
        ctx.arc(d.x, d.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        /* order number */
        ctx.fillStyle = '#fff';
        ctx.font      = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(order, d.x, d.y);
      } else {
        /* idle dot */
        ctx.beginPath();
        ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#4d5566';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#7d8590';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }

  /* callback — override externally */
  onComplete(pattern) {}
}

/* ═══════════════════════════════════════════════════
   Auth controller — manages setup vs verify flow
═══════════════════════════════════════════════════ */
const Auth = (() => {
  let lock       = null;
  let mode       = 'verify';   // 'setup' | 'setup-confirm' | 'verify'
  let pendingHash = null;      // hash captured during first setup step

  const overlay  = () => document.getElementById('auth-overlay');
  const msgEl    = () => document.getElementById('auth-message');
  const hintEl   = () => document.getElementById('auth-hint');
  const confirmBtn = () => document.getElementById('auth-confirm-btn');
  const resetBtn   = () => document.getElementById('auth-reset-btn');

  async function sha256(str) {
    const data = new TextEncoder().encode(str + '_stt_v1');
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function setHint(text, type = '') {
    const el = hintEl();
    el.textContent = text;
    el.className   = 'auth-hint' + (type ? ' ' + type : '');
  }

  function init() {
    const canvas = document.getElementById('pattern-canvas');
    lock = new PatternLock(canvas);
    lock.onComplete = handlePattern;

    const stored = localStorage.getItem(CFG.LS.PATTERN_HASH);
    if (stored) {
      mode = 'verify';
      msgEl().textContent = 'Draw your pattern to unlock';
      resetBtn().style.display = 'block';
    } else {
      mode = 'setup';
      msgEl().textContent  = 'Create a security pattern';
      setHint('Connect at least 4 dots to set your pattern');
    }

    resetBtn().addEventListener('click', () => {
      if (confirm('Reset your pattern? You will need to create a new one.')) {
        localStorage.removeItem(CFG.LS.PATTERN_HASH);
        location.reload();
      }
    });
  }

  async function handlePattern(raw) {
    if (raw.split('-').length < 4) {
      lock.showFlash('error');
      setHint('Connect at least 4 dots', 'error');
      return;
    }

    const hash = await sha256(raw);

    if (mode === 'setup') {
      pendingHash = hash;
      mode = 'setup-confirm';
      lock.showFlash('success');
      msgEl().textContent = 'Confirm your pattern';
      setHint('Draw the same pattern again to confirm');
      confirmBtn().style.display = 'none';
      return;
    }

    if (mode === 'setup-confirm') {
      if (hash !== pendingHash) {
        lock.showFlash('error');
        setHint('Patterns do not match — try again', 'error');
        mode = 'setup';
        pendingHash = null;
        msgEl().textContent = 'Create a security pattern';
        setHint('Connect at least 4 dots');
        return;
      }
      localStorage.setItem(CFG.LS.PATTERN_HASH, hash);
      lock.showFlash('success');
      setHint('Pattern saved!', 'success');
      setTimeout(unlock, 600);
      return;
    }

    /* verify mode */
    const stored = localStorage.getItem(CFG.LS.PATTERN_HASH);
    if (hash === stored) {
      lock.showFlash('success');
      setHint('Unlocked!', 'success');
      setTimeout(unlock, 400);
    } else {
      lock.showFlash('error');
      setHint('Incorrect pattern — try again', 'error');
    }
  }

  function unlock() {
    overlay().style.display = 'none';
    document.getElementById('app').style.display = '';
    document.getElementById('fab-add').style.display = '';
    /* signal app to bootstrap */
    document.dispatchEvent(new Event('app:unlocked'));
  }

  /* Re-enter verify mode (used by "change pattern" button) */
  function promptChange() {
    overlay().style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('fab-add').style.display = 'none';
    localStorage.removeItem(CFG.LS.PATTERN_HASH);
    mode = 'setup';
    pendingHash = null;
    msgEl().textContent = 'Create a new security pattern';
    setHint('Connect at least 4 dots');
    resetBtn().style.display = 'none';
  }

  return { init, promptChange };
})();

document.addEventListener('DOMContentLoaded', () => Auth.init());
