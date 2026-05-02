/* ============================================================
   Pattern-Lock Authentication
   ============================================================ */

async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode("sdt_v1:" + str);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

class PatternLock {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext("2d");
    this.dots    = [];
    this.path    = [];
    this.drawing = false;
    this.mouse   = { x: 0, y: 0 };
    this._flash  = null;
    this._raf    = null;

    this._resize();
    this._initDots();
    this._bindEvents();
    this._render();
  }

  _resize() {
    const dim = Math.min(window.innerWidth - 80, 260);
    this.canvas.width  = dim;
    this.canvas.height = dim;
    this._dim = dim;
  }

  _initDots() {
    this.dots = [];
    const pad  = this._dim * 0.18;
    const step = (this._dim - 2 * pad) / 2;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        this.dots.push({
          idx:      r * 3 + c,
          x:        pad + c * step,
          y:        pad + r * step,
          selected: false,
        });
      }
    }
  }

  _hitDot(x, y) {
    const thr = this._dim * 0.1;
    return this.dots.find(d => Math.hypot(d.x - x, d.y - y) < thr);
  }

  _getPos(e) {
    const rect   = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("mousedown",  e => this._onStart(e));
    c.addEventListener("mousemove",  e => this._onMove(e));
    c.addEventListener("mouseup",    e => this._onEnd(e));
    c.addEventListener("mouseleave", e => this._onEnd(e));
    c.addEventListener("touchstart", e => { e.preventDefault(); this._onStart(e); }, { passive: false });
    c.addEventListener("touchmove",  e => { e.preventDefault(); this._onMove(e);  }, { passive: false });
    c.addEventListener("touchend",   e => this._onEnd(e));
    window.addEventListener("resize", () => {
      this._resize();
      this._initDots();
      this.reset();
    });
  }

  _onStart(e) {
    const pos = this._getPos(e);
    const dot = this._hitDot(pos.x, pos.y);
    if (dot && !dot.selected) {
      this.drawing = true;
      dot.selected = true;
      this.path.push(dot.idx);
      this.mouse = pos;
      this._kick();
    }
  }

  _onMove(e) {
    if (!this.drawing) return;
    const pos = this._getPos(e);
    this.mouse = pos;
    const dot = this._hitDot(pos.x, pos.y);
    if (dot && !dot.selected) {
      dot.selected = true;
      this.path.push(dot.idx);
      if (navigator.vibrate) navigator.vibrate(8);
    }
    this._render();
  }

  _onEnd() {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.path.length >= 4) {
      this.onComplete && this.onComplete([...this.path]);
    } else if (this.path.length > 0) {
      this._flashError();
    }
    this._render();
  }

  _flashError() {
    this._flash = "#ef4444";
    setTimeout(() => { this._flash = null; this.reset(); }, 700);
  }

  flashSuccess() {
    this._flash = "#22c55e";
    setTimeout(() => { this._flash = null; this.reset(); }, 500);
  }

  reset() {
    this.path    = [];
    this.drawing = false;
    this.dots.forEach(d => (d.selected = false));
    this._flash  = null;
    this._render();
  }

  _kick() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this._render());
  }

  _render() {
    const ctx  = this.ctx;
    const dim  = this._dim;
    const col  = this._flash || "#6366f1";
    ctx.clearRect(0, 0, dim, dim);

    // Lines between selected dots
    if (this.path.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = "round";
      ctx.globalAlpha = 0.55;
      const first = this.dots[this.path[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this.path.length; i++) {
        const d = this.dots[this.path[i]];
        ctx.lineTo(d.x, d.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Trailing line to cursor
    if (this.drawing && this.path.length > 0) {
      const last = this.dots[this.path[this.path.length - 1]];
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.3;
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(this.mouse.x, this.mouse.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const R = dim * 0.055;

    this.dots.forEach(dot => {
      // Outer ring
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, R, 0, Math.PI * 2);
      if (dot.selected) {
        ctx.fillStyle   = col;
        ctx.shadowColor = col;
        ctx.shadowBlur  = 12;
      } else {
        ctx.fillStyle  = "#334155";
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Centre highlight
      if (dot.selected) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, R * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.fill();
      }
    });

    if (this.drawing || this._flash) {
      this._raf = requestAnimationFrame(() => this._render());
    }
  }
}


/* ============================================================
   AuthManager — wraps pattern storage + verification
   ============================================================ */
class AuthManager {
  isPatternSet() {
    return localStorage.getItem(CONFIG.LS_PATTERN_SET) === "true";
  }

  async setPattern(path) {
    const hash = await sha256(path.join(","));
    localStorage.setItem(CONFIG.LS_PATTERN_HASH, hash);
    localStorage.setItem(CONFIG.LS_PATTERN_SET,  "true");
  }

  async verify(path) {
    const stored = localStorage.getItem(CONFIG.LS_PATTERN_HASH);
    if (!stored) return false;
    const hash = await sha256(path.join(","));
    return hash === stored;
  }

  clearPattern() {
    localStorage.removeItem(CONFIG.LS_PATTERN_HASH);
    localStorage.removeItem(CONFIG.LS_PATTERN_SET);
  }
}


/* ============================================================
   Auth UI controller — drives the overlay flow
   ============================================================ */
class AuthUI {
  constructor(onSuccess) {
    this.auth      = new AuthManager();
    this.onSuccess = onSuccess;
    this.overlay   = document.getElementById("auth-overlay");
    this.msg       = document.getElementById("auth-message");
    this.hint      = document.getElementById("auth-hint");
    this.canvas    = document.getElementById("pattern-canvas");
    this.lock      = new PatternLock(this.canvas);
    this._confirmBuf = null;
    this._mode       = "unlock"; // "unlock" | "set-1" | "set-2"

    document.getElementById("auth-clear-btn").addEventListener("click", () => {
      this.lock.reset();
      if (this._mode === "set-2") {
        this._mode = "set-1";
        this._confirmBuf = null;
        this.msg.textContent = "Draw your new pattern";
      }
    });

    this.lock.onComplete = path => this._handlePattern(path);
  }

  start() {
    this.overlay.classList.remove("hidden");
    if (this.auth.isPatternSet()) {
      this._mode = "unlock";
      this.msg.textContent  = "Draw your pattern to unlock";
      this.hint.textContent = "Connect at least 4 dots";
    } else {
      this._mode = "set-1";
      this.msg.textContent  = "Set up your pattern lock";
      this.hint.textContent = "Draw a new pattern (min 4 dots)";
    }
  }

  async _handlePattern(path) {
    if (this._mode === "unlock") {
      const ok = await this.auth.verify(path);
      if (ok) {
        this.lock.flashSuccess();
        setTimeout(() => {
          this.overlay.classList.add("hidden");
          this.onSuccess();
        }, 500);
      } else {
        this.msg.textContent = "⚠ Wrong pattern — try again";
        this.lock.reset();
      }

    } else if (this._mode === "set-1") {
      this._confirmBuf = path;
      this._mode = "set-2";
      this.lock.flashSuccess();
      setTimeout(() => {
        this.lock.reset();
        this.msg.textContent  = "Draw the same pattern again";
        this.hint.textContent = "Confirm your pattern";
      }, 450);

    } else if (this._mode === "set-2") {
      if (path.join(",") === this._confirmBuf.join(",")) {
        await this.auth.setPattern(path);
        this.lock.flashSuccess();
        setTimeout(() => {
          this.overlay.classList.add("hidden");
          this.onSuccess();
        }, 500);
      } else {
        this.msg.textContent = "⚠ Patterns don't match — start again";
        this._mode = "set-1";
        this._confirmBuf = null;
        this.lock.reset();
      }
    }
  }

  /* Call from Settings to force re-setting the pattern */
  resetPattern() {
    this.auth.clearPattern();
    this._mode       = "set-1";
    this._confirmBuf = null;
    this.overlay.classList.remove("hidden");
    this.msg.textContent  = "Set a new pattern";
    this.hint.textContent = "Draw a new pattern (min 4 dots)";
    this.lock.reset();
    // Hide app while re-setting
    document.getElementById("app").classList.add("hidden");
  }
}
