/**
 * auth.js — Pattern Lock Authentication
 * 3×3 dot grid. Requires 4+ dots. Stores SHA-256 hash in localStorage.
 */

(function () {
  'use strict';

  const LS_KEY = 'tracker_pattern_hash';
  const MIN_DOTS = 4;

  // ── SHA-256 helper (Web Crypto) ────────────────────────────────────────────
  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Canvas pattern lock ────────────────────────────────────────────────────
  class PatternLock {
    constructor(canvas, onDone) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onDone = onDone;   // called with (indices[]) when pattern drawn
      this.dots = [];
      this.selected = [];
      this.isDown = false;
      this.curPos = null;
      this.flashType = null;  // 'success' | 'error' | null

      this._resize();
      this._initDots();
      this._listen();
      this._draw();
    }

    _resize() {
      // Canvas is always 240×240 logical pixels (CSS width in auth.css)
      const dpr = window.devicePixelRatio || 1;
      const side = 240;
      this.canvas.width = side * dpr;
      this.canvas.height = side * dpr;
      this.canvas.style.width = side + 'px';
      this.canvas.style.height = side + 'px';
      this.ctx.scale(dpr, dpr);
      this.side = side;
    }

    _initDots() {
      this.dots = [];
      const pad = this.side * 0.18;
      const step = (this.side - pad * 2) / 2;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          this.dots.push({ x: pad + c * step, y: pad + r * step, idx: r * 3 + c });
        }
      }
    }

    _listen() {
      const el = this.canvas;
      el.addEventListener('touchstart', e => { e.preventDefault(); this._start(this._pos(e)); }, { passive: false });
      el.addEventListener('touchmove',  e => { e.preventDefault(); this._move(this._pos(e)); },  { passive: false });
      el.addEventListener('touchend',   e => { e.preventDefault(); this._end(); });
      el.addEventListener('mousedown',  e => this._start(this._pos(e)));
      el.addEventListener('mousemove',  e => this._move(this._pos(e)));
      el.addEventListener('mouseup',    () => this._end());
      el.addEventListener('mouseleave', () => { if (this.isDown) this._end(); });
    }

    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      const sx = this.side / r.width;
      const sy = this.side / r.height;
      const src = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
    }

    _nearest(pos) {
      const thresh = this.side * 0.13;
      return this.dots.find(d => Math.hypot(d.x - pos.x, d.y - pos.y) < thresh) || null;
    }

    _start(pos) {
      if (this.flashType) return;
      this.isDown = true;
      this.selected = [];
      this.curPos = pos;
      const d = this._nearest(pos);
      if (d) this.selected.push(d.idx);
      this._draw();
    }

    _move(pos) {
      if (!this.isDown) return;
      this.curPos = pos;
      const d = this._nearest(pos);
      if (d && !this.selected.includes(d.idx)) this.selected.push(d.idx);
      this._draw();
    }

    _end() {
      if (!this.isDown) return;
      this.isDown = false;
      if (this.selected.length < MIN_DOTS) {
        this._flash('error');
      } else {
        this.onDone([...this.selected]);
      }
    }

    _flash(type) {
      this.flashType = type;
      this._draw();
      setTimeout(() => {
        this.flashType = null;
        this.selected = [];
        this.curPos = null;
        this._draw();
      }, 900);
    }

    flashResult(type) { this._flash(type); }

    reset() {
      this.flashType = null;
      this.selected = [];
      this.curPos = null;
      this.isDown = false;
      this._draw();
    }

    _colors() {
      if (this.flashType === 'success') return { line: '#10B981', dot: '#10B981', ring: '#10B98133' };
      if (this.flashType === 'error')   return { line: '#EF4444', dot: '#EF4444', ring: '#EF444433' };
      return { line: '#818CF8', dot: '#6366F1', ring: '#6366F133' };
    }

    _draw() {
      const ctx = this.ctx;
      const s = this.side;
      ctx.clearRect(0, 0, s, s);
      const c = this._colors();
      const dotR = s * 0.042;
      const ringR = s * 0.078;

      // Lines between selected dots
      if (this.selected.length >= 2) {
        ctx.beginPath();
        const first = this.dots.find(d => d.idx === this.selected[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < this.selected.length; i++) {
          const d = this.dots.find(dot => dot.idx === this.selected[i]);
          ctx.lineTo(d.x, d.y);
        }
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Line from last selected to cursor
      if (this.isDown && this.selected.length > 0 && this.curPos) {
        const last = this.dots.find(d => d.idx === this.selected[this.selected.length - 1]);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(this.curPos.x, this.curPos.y);
        ctx.strokeStyle = c.line + '99';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Dots
      this.dots.forEach(dot => {
        const isSel = this.selected.includes(dot.idx);
        if (isSel) {
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, ringR, 0, Math.PI * 2);
          ctx.fillStyle = c.ring;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, isSel ? dotR * 1.15 : dotR, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? c.dot : 'rgba(255,255,255,0.35)';
        ctx.fill();
        if (!isSel) {
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, dotR, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
    }
  }

  // ── Auth controller ────────────────────────────────────────────────────────

  const authScreen = document.getElementById('auth-screen');
  const appEl      = document.getElementById('app');
  const hintEl     = document.getElementById('auth-hint');
  const msgEl      = document.getElementById('auth-msg');
  const resetBtn   = document.getElementById('reset-pattern-btn');
  const canvas     = document.getElementById('pattern-canvas');

  let lock;
  let mode = 'verify';       // 'verify' | 'set-first' | 'set-confirm'
  let firstPattern = null;

  function setMsg(text, type = '') {
    msgEl.textContent = text;
    msgEl.className = 'auth-msg' + (type ? ' ' + type : '');
  }

  function showApp() {
    authScreen.style.display = 'none';
    appEl.classList.remove('hidden');
    if (window.AppInit) window.AppInit();
  }

  async function handlePattern(indices) {
    const hash = await sha256(indices.join('-'));

    if (mode === 'set-first') {
      firstPattern = { indices, hash };
      mode = 'set-confirm';
      lock.flashResult('success');
      hintEl.textContent = 'Draw the same pattern again to confirm';
      setMsg('Pattern set! Now confirm it.');
      return;
    }

    if (mode === 'set-confirm') {
      if (hash === firstPattern.hash) {
        localStorage.setItem(LS_KEY, hash);
        lock.flashResult('success');
        setMsg('Pattern saved! Unlocking…', 'success');
        setTimeout(showApp, 800);
      } else {
        mode = 'set-first';
        firstPattern = null;
        lock.flashResult('error');
        hintEl.textContent = 'Patterns did not match. Draw a new pattern.';
        setMsg('Patterns did not match — try again.', 'error');
      }
      return;
    }

    // mode === 'verify'
    const stored = localStorage.getItem(LS_KEY);
    if (!stored) {
      startSetup();
      return;
    }

    if (hash === stored) {
      lock.flashResult('success');
      setMsg('Unlocked!', 'success');
      setTimeout(showApp, 600);
    } else {
      lock.flashResult('error');
      setMsg('Incorrect pattern. Try again.', 'error');
    }
  }

  function startSetup() {
    mode = 'set-first';
    firstPattern = null;
    hintEl.textContent = 'Create your unlock pattern (connect 4+ dots)';
    setMsg('Draw a pattern to protect your tracker.');
  }

  function init() {
    lock = new PatternLock(canvas, handlePattern);
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      mode = 'verify';
      hintEl.textContent = 'Draw your unlock pattern';
      setMsg('');
    } else {
      startSetup();
    }
  }

  resetBtn.addEventListener('click', () => {
    if (confirm('Reset your unlock pattern? You will need to create a new one.')) {
      localStorage.removeItem(LS_KEY);
      lock.reset();
      startSetup();
    }
  });

  init();
})();
