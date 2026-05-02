/* ══════════════════════════════════════════════════════════════════
   auth.js — Pattern Lock Authentication
   Canvas-based 3x3 grid. Pattern hashed with SHA-256 and stored in
   localStorage. Supports setup (first time), verify, and change flows.
   ══════════════════════════════════════════════════════════════════ */

'use strict';

class PatternLock {
  constructor(canvasId, dotsContainerId, options = {}) {
    this.canvas     = document.getElementById(canvasId);
    this.ctx        = this.canvas ? this.canvas.getContext('2d') : null;
    this.dotsEl     = document.getElementById(dotsContainerId);
    this.options    = Object.assign({ minDots: 4, lineColor: '#9f67ff', dotSize: 10 }, options);

    this.dots       = [];   // { x, y, index, el }
    this.selected   = [];   // indices in order
    this.active     = false;
    this.currentPos = null;
    this.locked     = false;
    this.onComplete = null; // callback(pattern: string)

    if (this.canvas && this.dotsEl) this._init();
  }

  _init() {
    this._buildDots();
    this._attachEvents();
  }

  _buildDots() {
    this.dotsEl.innerHTML = '';
    this.dots = [];

    const size = this.canvas.offsetWidth || 280;
    const step = size / 3;
    const offset = step / 2;

    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = offset + col * step;
      const y = offset + row * step;

      const dotDiv = document.createElement('div');
      dotDiv.className = 'pattern-dot';
      dotDiv.dataset.index = i;

      const inner = document.createElement('div');
      inner.className = 'dot-inner';
      dotDiv.appendChild(inner);
      this.dotsEl.appendChild(dotDiv);

      this.dots.push({ x, y, index: i, el: dotDiv });
    }
  }

  _attachEvents() {
    const el = this.dotsEl;
    el.addEventListener('mousedown',  (e) => this._onStart(e));
    el.addEventListener('mousemove',  (e) => this._onMove(e));
    el.addEventListener('mouseup',    (e) => this._onEnd(e));
    el.addEventListener('mouseleave', (e) => this._onEnd(e));

    el.addEventListener('touchstart', (e) => { e.preventDefault(); this._onStart(e.touches[0]); }, { passive: false });
    el.addEventListener('touchmove',  (e) => { e.preventDefault(); this._onMove(e.touches[0]); }, { passive: false });
    el.addEventListener('touchend',   (e) => { e.preventDefault(); this._onEnd(e); }, { passive: false });
  }

  _getPos(e) {
    const rect = this.dotsEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top)  * (this.canvas.height / rect.height)
    };
  }

  _nearestDot(x, y, threshold = 32) {
    let best = null, bestDist = Infinity;
    for (const d of this.dots) {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < threshold && dist < bestDist) { best = d; bestDist = dist; }
    }
    return best;
  }

  _onStart(e) {
    if (this.locked) return;
    this.active = true;
    this.selected = [];
    this._clearCanvas();
    this.dots.forEach(d => {
      d.el.classList.remove('selected', 'error');
    });
    this._onMove(e);
  }

  _onMove(e) {
    if (!this.active) return;
    const pos = this._getPos(e);
    this.currentPos = pos;

    const dot = this._nearestDot(pos.x, pos.y);
    if (dot && !this.selected.includes(dot.index)) {
      this.selected.push(dot.index);
      dot.el.classList.add('selected');
    }

    this._redraw();
  }

  _onEnd() {
    if (!this.active) return;
    this.active = false;
    this.currentPos = null;
    this._redraw(false);

    const pattern = this.selected.join('');
    if (this.selected.length < this.options.minDots) {
      this._flashError();
      return;
    }
    if (this.onComplete) this.onComplete(pattern);
  }

  _redraw(withCursor = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (this.selected.length < 2) {
      if (withCursor && this.currentPos && this.selected.length === 1) {
        const from = this.dots[this.selected[0]];
        this._drawLine(from.x, from.y, this.currentPos.x, this.currentPos.y, 0.4);
      }
      return;
    }

    for (let i = 0; i < this.selected.length - 1; i++) {
      const a = this.dots[this.selected[i]];
      const b = this.dots[this.selected[i + 1]];
      this._drawLine(a.x, a.y, b.x, b.y, 0.85);
    }

    if (withCursor && this.currentPos) {
      const last = this.dots[this.selected[this.selected.length - 1]];
      this._drawLine(last.x, last.y, this.currentPos.x, this.currentPos.y, 0.4);
    }
  }

  _drawLine(x1, y1, x2, y2, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.options.lineColor;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  _clearCanvas() {
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _flashError() {
    this.dots.forEach(d => {
      if (this.selected.includes(d.index)) d.el.classList.add('error');
    });
    setTimeout(() => {
      this.dots.forEach(d => d.el.classList.remove('selected', 'error'));
      this._clearCanvas();
    }, 600);
  }

  reset() {
    this.selected = [];
    this.active = false;
    this.currentPos = null;
    this._clearCanvas();
    this.dots.forEach(d => d.el.classList.remove('selected', 'error'));
  }

  setLocked(v) { this.locked = v; }
}

/* ── SHA-256 via Web Crypto API ── */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ════════════════════════════════════ Auth Manager ═══ */

const Auth = (() => {
  const STORAGE_KEY   = 'sdt_pattern_hash';
  const SALT          = 'sabhya_daily_tracker_v1';
  const SESSION_KEY   = 'sdt_session';
  const SESSION_TTL   = 30 * 60 * 1000; // 30 minutes

  let mainLock = null;

  function isConfigured() { return !!localStorage.getItem(STORAGE_KEY); }

  function isSessionValid() {
    const ts = sessionStorage.getItem(SESSION_KEY);
    if (!ts) return false;
    return (Date.now() - parseInt(ts, 10)) < SESSION_TTL;
  }

  function refreshSession() { sessionStorage.setItem(SESSION_KEY, Date.now().toString()); }

  function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

  async function hashPattern(pattern) {
    return sha256(SALT + pattern);
  }

  async function setPattern(pattern) {
    const hash = await hashPattern(pattern);
    localStorage.setItem(STORAGE_KEY, hash);
  }

  async function verifyPattern(pattern) {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    const hash = await hashPattern(pattern);
    return hash === stored;
  }

  function lock() {
    clearSession();
    location.reload();
  }

  /* ── Main unlock screen ── */
  function initUnlockScreen(onUnlocked) {
    const overlay    = document.getElementById('patternOverlay');
    const instruction = document.getElementById('patternInstruction');
    const feedback   = document.getElementById('patternFeedback');
    const forgotBtn  = document.getElementById('patternForgotBtn');

    mainLock = new PatternLock('patternCanvas', 'patternDots');

    let attempts = 0;
    mainLock.onComplete = async (pattern) => {
      const ok = await verifyPattern(pattern);
      if (ok) {
        feedback.textContent = 'Unlocked!';
        feedback.className = 'pattern-feedback success';
        refreshSession();
        setTimeout(() => {
          overlay.style.display = 'none';
          onUnlocked();
        }, 400);
      } else {
        attempts++;
        feedback.textContent = `Wrong pattern. Try again. (${attempts})`;
        feedback.className = 'pattern-feedback error';
        mainLock.reset();
        if (attempts >= 5) forgotBtn.style.display = 'block';
      }
    };

    forgotBtn.addEventListener('click', () => {
      if (confirm('This will reset the pattern and clear ALL local data. Continue?')) {
        localStorage.clear();
        sessionStorage.clear();
        location.reload();
      }
    });
  }

  /* ── Setup wizard — step 1: set pattern ── */
  function initSetupPatternLocks(onPatternSet) {
    const lock1    = new PatternLock('setupCanvas', 'setupDots', { minDots: 4 });
    const lock2    = new PatternLock('setupCanvasConfirm', 'setupDotsConfirm', { minDots: 4 });
    const fb1      = document.getElementById('setupFeedback');
    const fb2      = document.getElementById('setupFeedbackConfirm');
    const confirm  = document.getElementById('setupStep1Confirm');
    const nextBtn  = document.getElementById('setupStep1Next');

    let firstPattern = null;

    lock1.onComplete = (pattern) => {
      firstPattern = pattern;
      fb1.textContent = `Pattern set (${pattern.length} dots). Draw again to confirm.`;
      fb1.className = 'pattern-feedback success';
      confirm.style.display = 'block';
    };

    lock2.onComplete = async (pattern) => {
      if (pattern === firstPattern) {
        fb2.textContent = 'Pattern confirmed!';
        fb2.className = 'pattern-feedback success';
        await setPattern(pattern);
        nextBtn.disabled = false;
        nextBtn.click();
      } else {
        fb2.textContent = 'Patterns do not match. Try again.';
        fb2.className = 'pattern-feedback error';
        lock2.reset();
        firstPattern = null;
        confirm.style.display = 'none';
        lock1.reset();
        fb1.textContent = 'Draw your pattern (min 4 dots)';
        fb1.className = 'pattern-feedback';
      }
    };

    nextBtn.addEventListener('click', () => {
      if (!nextBtn.disabled) onPatternSet();
    });
  }

  return { isConfigured, isSessionValid, refreshSession, setPattern, verifyPattern, lock, initUnlockScreen, initSetupPatternLocks };
})();
