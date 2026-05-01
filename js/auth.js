/* Pattern lock authentication using Canvas API */
class PatternLock {
  constructor(canvasEl, opts = {}) {
    this.canvas = canvasEl;
    this.ctx = null;
    this.dots = [];
    this.selected = [];
    this.isDrawing = false;
    this.currentPos = null;
    this.errorMode = false;
    this.successMode = false;
    this.onComplete = opts.onComplete || (() => {});
    this.minDots = opts.minDots || 4;
    this.GRID = 3;

    this._initCanvas();
    this._initDots();
    this._bindEvents();
    this._render();
  }

  _initCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const size = this.canvas.offsetWidth || 280;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);
    this.logicalSize = size;
  }

  _initDots() {
    const pad = this.logicalSize * 0.18;
    const step = (this.logicalSize - 2 * pad) / (this.GRID - 1);
    this.dots = [];
    for (let r = 0; r < this.GRID; r++) {
      for (let c = 0; c < this.GRID; c++) {
        this.dots.push({
          id: r * this.GRID + c,
          x: pad + c * step,
          y: pad + r * step,
          active: false
        });
      }
    }
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.logicalSize / rect.width;
    const scaleY = this.logicalSize / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY
    };
  }

  _bindEvents() {
    const start = e => { e.preventDefault(); this._startDraw(e); };
    const move = e => { e.preventDefault(); this._moveDraw(e); };
    const end = e => { e.preventDefault(); this._endDraw(); };

    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', move);
    this.canvas.addEventListener('mouseup', end);
    this.canvas.addEventListener('touchstart', start, { passive: false });
    this.canvas.addEventListener('touchmove', move, { passive: false });
    this.canvas.addEventListener('touchend', end, { passive: false });
  }

  _startDraw(e) {
    this.isDrawing = true;
    this.selected = [];
    this.errorMode = false;
    this.successMode = false;
    this.dots.forEach(d => { d.active = false; });
    this._moveDraw(e);
  }

  _moveDraw(e) {
    if (!this.isDrawing) return;
    this.currentPos = this._getPos(e);
    const hitRadius = this.logicalSize * 0.09;

    for (const dot of this.dots) {
      if (dot.active) continue;
      const dx = dot.x - this.currentPos.x;
      const dy = dot.y - this.currentPos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
        dot.active = true;
        this.selected.push(dot.id);
        if (navigator.vibrate) navigator.vibrate(12);
        break;
      }
    }
    this._render();
  }

  _endDraw() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.currentPos = null;

    if (this.selected.length < this.minDots) {
      this._showError(`Connect at least ${this.minDots} dots`);
      return;
    }
    this._render();
    const pattern = this.selected.join('-');
    this.onComplete(pattern);
  }

  _showError(msg) {
    this.errorMode = true;
    this._render();
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    setTimeout(() => this.reset(), 1400);
  }

  showSuccess() {
    this.successMode = true;
    this._render();
  }

  showError(msg) {
    this.errorMode = true;
    this._render();
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    setTimeout(() => this.reset(), 1400);
  }

  reset() {
    this.selected = [];
    this.errorMode = false;
    this.successMode = false;
    this.isDrawing = false;
    this.currentPos = null;
    this.dots.forEach(d => { d.active = false; });
    this._render();
  }

  _render() {
    const ctx = this.ctx;
    const sz = this.logicalSize;
    ctx.clearRect(0, 0, sz, sz);

    const lineColor = this.errorMode
      ? 'rgba(239,68,68,0.7)'
      : this.successMode
      ? 'rgba(16,185,129,0.7)'
      : 'rgba(99,102,241,0.7)';

    const dotActive = this.errorMode ? '#ef4444' : this.successMode ? '#10b981' : '#6366f1';
    const dotGlow = this.errorMode
      ? 'rgba(239,68,68,0.25)'
      : this.successMode
      ? 'rgba(16,185,129,0.25)'
      : 'rgba(99,102,241,0.25)';

    // Draw connection lines
    const activeDots = this.selected.map(id => this.dots.find(d => d.id === id));
    if (activeDots.length > 1) {
      ctx.beginPath();
      ctx.moveTo(activeDots[0].x, activeDots[0].y);
      for (let i = 1; i < activeDots.length; i++) {
        ctx.lineTo(activeDots[i].x, activeDots[i].y);
      }
      if (this.isDrawing && this.currentPos) {
        ctx.lineTo(this.currentPos.x, this.currentPos.y);
      }
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (this.isDrawing && this.currentPos && activeDots.length === 1) {
      ctx.beginPath();
      ctx.moveTo(activeDots[0].x, activeDots[0].y);
      ctx.lineTo(this.currentPos.x, this.currentPos.y);
      ctx.strokeStyle = 'rgba(99,102,241,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw dots
    const dotR = sz * 0.045;
    const glowR = sz * 0.075;
    for (const dot of this.dots) {
      if (dot.active) {
        // Glow ring
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = dotGlow;
        ctx.fill();
        // Filled dot
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = dotActive;
        ctx.fill();
        // Center highlight
        ctx.beginPath();
        ctx.arc(dot.x - dotR * 0.25, dot.y - dotR * 0.25, dotR * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Center dot
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotR * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
      }
    }
  }

  resize() {
    this._initCanvas();
    this._initDots();
    this._render();
  }
}

/* Two-phase pattern setup: draw → confirm */
class PatternSetup {
  constructor(canvasEl, onConfirmed, onError) {
    this.stage = 'first'; // 'first' | 'confirm'
    this.firstPattern = null;
    this.onConfirmed = onConfirmed;
    this.onError = onError;
    this.lock = new PatternLock(canvasEl, {
      minDots: 4,
      onComplete: pattern => this._handleComplete(pattern)
    });
  }

  _handleComplete(pattern) {
    if (this.stage === 'first') {
      this.firstPattern = pattern;
      this.stage = 'confirm';
      this.lock.showSuccess();
      setTimeout(() => {
        this.lock.reset();
        this._emitStageChange('confirm');
      }, 700);
    } else {
      if (pattern === this.firstPattern) {
        this.lock.showSuccess();
        setTimeout(() => this.onConfirmed(pattern), 600);
      } else {
        this.lock.showError('Patterns do not match');
        this.stage = 'first';
        this.firstPattern = null;
        setTimeout(() => this._emitStageChange('first'), 1400);
        if (this.onError) this.onError('Patterns do not match');
      }
    }
  }

  _emitStageChange(stage) {
    const ev = new CustomEvent('patternStageChange', { detail: { stage } });
    document.dispatchEvent(ev);
  }

  reset() {
    this.stage = 'first';
    this.firstPattern = null;
    this.lock.reset();
  }
}
