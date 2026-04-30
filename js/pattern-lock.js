/**
 * PatternLock — canvas-based 3×3 pattern authentication.
 * Minimum 4 dots required. Supports mouse and touch.
 */
class PatternLock {
  constructor(canvas, { onComplete, minDots = 4 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onComplete = onComplete || (() => {});
    this.minDots = minDots;

    this.dots = [];
    this.selected = [];
    this.curPos = null;
    this.drawing = false;
    this.state = 'idle'; // idle | drawing | error | success

    this._resize();
    this._bindEvents();
    this._draw();
  }

  /* ---- Layout ---- */

  _resize() {
    const size = Math.min(this.canvas.offsetWidth || 280, 280);
    this.canvas.width = size;
    this.canvas.height = size;
    this._initDots(size);
    this._draw();
  }

  _initDots(size) {
    const cell = size / 3;
    this.dots = [];
    for (let i = 0; i < 9; i++) {
      this.dots.push({
        x: (i % 3 + 0.5) * cell,
        y: (Math.floor(i / 3) + 0.5) * cell,
        r: cell * 0.15,
        idx: i
      });
    }
  }

  /* ---- Event Binding ---- */

  _bindEvents() {
    const pos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const sx = this.canvas.width / rect.width;
      const sy = this.canvas.height / rect.height;
      return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
    };

    const onStart = (e) => {
      e.preventDefault();
      if (this.state === 'error' || this.state === 'success') return;
      this.drawing = true;
      this.selected = [];
      this.state = 'drawing';
      this.curPos = pos(e);
      this._hitDot(this.curPos);
      this._draw();
    };

    const onMove = (e) => {
      e.preventDefault();
      if (!this.drawing) return;
      this.curPos = pos(e);
      this._hitDot(this.curPos);
      this._draw();
    };

    const onEnd = (e) => {
      e.preventDefault();
      if (!this.drawing) return;
      this.drawing = false;
      this.curPos = null;

      if (this.selected.length >= this.minDots) {
        this.state = 'success';
        this._draw();
        setTimeout(() => {
          this.onComplete([...this.selected]);
        }, 300);
      } else {
        this._showError(this.selected.length === 0
          ? 'Draw a pattern'
          : `Connect at least ${this.minDots} dots`);
      }
    };

    this.canvas.addEventListener('mousedown', onStart);
    this.canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    this.canvas.addEventListener('touchstart', onStart, { passive: false });
    this.canvas.addEventListener('touchmove', onMove, { passive: false });
    this.canvas.addEventListener('touchend', onEnd, { passive: false });

    window.addEventListener('resize', () => this._resize());
  }

  _hitDot(p) {
    for (const d of this.dots) {
      if (this.selected.includes(d.idx)) continue;
      const dist = Math.hypot(p.x - d.x, p.y - d.y);
      if (dist <= d.r * 2) {
        this.selected.push(d.idx);
        break;
      }
    }
  }

  /* ---- Drawing ---- */

  _draw() {
    const ctx = this.ctx;
    const { width: W, height: H } = this.canvas;
    ctx.clearRect(0, 0, W, H);

    const colors = this._colors();

    // Lines between selected dots
    if (this.selected.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const first = this.dots[this.selected[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this.selected.length; i++) {
        const d = this.dots[this.selected[i]];
        ctx.lineTo(d.x, d.y);
      }
      ctx.stroke();
    }

    // Trailing line to cursor
    if (this.drawing && this.curPos && this.selected.length > 0) {
      const last = this.dots[this.selected[this.selected.length - 1]];
      ctx.beginPath();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(this.curPos.x, this.curPos.y);
      ctx.stroke();
    }

    // Dots
    for (const d of this.dots) {
      const sel = this.selected.includes(d.idx);

      // Glow ring
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.strokeStyle = sel ? colors.dotSelected : colors.dotIdle;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Fill on selected
      if (sel) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = colors.dotSelected;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = colors.dotIdle;
        ctx.fill();
      }
    }
  }

  _colors() {
    switch (this.state) {
      case 'error':
        return { dotIdle: 'rgba(255,255,255,0.25)', dotSelected: '#ef4444', line: 'rgba(239,68,68,0.5)' };
      case 'success':
        return { dotIdle: 'rgba(255,255,255,0.25)', dotSelected: '#22c55e', line: 'rgba(34,197,94,0.5)' };
      default:
        return { dotIdle: 'rgba(255,255,255,0.25)', dotSelected: '#6366f1', line: 'rgba(99,102,241,0.5)' };
    }
  }

  _showError(msg) {
    this.state = 'error';
    this._draw();
    setTimeout(() => {
      this.state = 'idle';
      this.selected = [];
      this._draw();
    }, 900);
    if (this._onError) this._onError(msg);
  }

  /* ---- Public API ---- */

  reset() {
    this.selected = [];
    this.drawing = false;
    this.curPos = null;
    this.state = 'idle';
    this._draw();
  }

  onError(fn) {
    this._onError = fn;
    return this;
  }

  /** Async helper: returns a Promise that resolves with the drawn pattern */
  static prompt(canvas, options = {}) {
    return new Promise((resolve) => {
      const lock = new PatternLock(canvas, {
        ...options,
        onComplete: (pattern) => resolve(pattern)
      });
    });
  }

  /** Hash a pattern array → hex string (SHA-256 via WebCrypto) */
  static async hash(pattern) {
    const str = pattern.join('-');
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
