class PatternLock {
  constructor(canvasId, { minDots = 4, onComplete } = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.minDots = minDots;
    this.onComplete = onComplete || (() => {});
    this.dots = [];
    this.selected = [];
    this.drawing = false;
    this.cur = null;
    this._setupDots();
    this._listen();
    this._render();
  }

  _setupDots() {
    const w = this.canvas.width;
    const pad = w * 0.18;
    const gap = (w - 2 * pad) / 2;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        this.dots.push({ x: pad + c * gap, y: pad + r * gap, i: r * 3 + c, on: false });
  }

  _listen() {
    const c = this.canvas;
    c.addEventListener('mousedown', e => this._start(this._pos(e)));
    c.addEventListener('mousemove', e => this._move(this._pos(e)));
    c.addEventListener('mouseup', () => this._end());
    c.addEventListener('touchstart', e => { e.preventDefault(); this._start(this._pos(e.touches[0])); }, { passive: false });
    c.addEventListener('touchmove', e => { e.preventDefault(); this._move(this._pos(e.touches[0])); }, { passive: false });
    c.addEventListener('touchend', () => this._end());
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / r.width, sy = this.canvas.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  _hit(pos) {
    const radius = this.canvas.width * 0.11;
    return this.dots.find(d => Math.hypot(d.x - pos.x, d.y - pos.y) < radius) || null;
  }

  _start(pos) {
    this.selected = []; this.dots.forEach(d => d.on = false); this.drawing = false;
    const d = this._hit(pos);
    if (d) { this.drawing = true; d.on = true; this.selected.push(d.i); this.cur = pos; this._render(); }
  }

  _move(pos) {
    if (!this.drawing) return;
    this.cur = pos;
    const d = this._hit(pos);
    if (d && !d.on) { d.on = true; this.selected.push(d.i); }
    this._render();
  }

  _end() {
    if (!this.drawing) return;
    this.drawing = false; this.cur = null;
    if (this.selected.length >= this.minDots) this.onComplete([...this.selected]);
    this._render();
    setTimeout(() => this.reset(), 700);
  }

  _render(err = false) {
    const ctx = this.ctx, w = this.canvas.width;
    ctx.clearRect(0, 0, w, w);
    if (this.selected.length > 0) {
      ctx.beginPath();
      const f = this.dots[this.selected[0]];
      ctx.moveTo(f.x, f.y);
      for (let i = 1; i < this.selected.length; i++) { const d = this.dots[this.selected[i]]; ctx.lineTo(d.x, d.y); }
      if (this.drawing && this.cur) ctx.lineTo(this.cur.x, this.cur.y);
      ctx.strokeStyle = err ? 'rgba(230,57,70,.6)' : 'rgba(108,99,255,.6)';
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    }
    this.dots.forEach(dot => {
      const a = dot.on;
      ctx.beginPath(); ctx.arc(dot.x, dot.y, 20, 0, Math.PI * 2);
      ctx.strokeStyle = a ? (err ? 'rgba(230,57,70,.35)' : 'rgba(108,99,255,.35)') : 'rgba(255,255,255,.07)';
      ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(dot.x, dot.y, a ? 9 : 5, 0, Math.PI * 2);
      ctx.fillStyle = a ? (err ? '#e63946' : '#6c63ff') : 'rgba(255,255,255,.22)'; ctx.fill();
      if (a && !err) { ctx.beginPath(); ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
    });
  }

  reset() { this.selected = []; this.dots.forEach(d => d.on = false); this.drawing = false; this.cur = null; this._render(); }
  showError() { this._render(true); setTimeout(() => this.reset(), 600); }
}

const Auth = {
  SK: 'tracker_ph',
  LK: 'tracker_lk',
  MAX: 5,

  async hash(p) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p.join('-')));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  has() { return !!localStorage.getItem(this.SK); },

  async set(p) { localStorage.setItem(this.SK, await this.hash(p)); },

  async verify(p) { return await this.hash(p) === localStorage.getItem(this.SK); },

  locked() {
    const d = JSON.parse(localStorage.getItem(this.LK) || '{}');
    return d.until && Date.now() < d.until ? d.until : false;
  },

  fail() {
    const d = JSON.parse(localStorage.getItem(this.LK) || '{"c":0}');
    d.c = (d.c || 0) + 1;
    if (d.c >= this.MAX) { d.until = Date.now() + 5 * 60 * 1000; d.c = 0; }
    localStorage.setItem(this.LK, JSON.stringify(d));
    return d;
  },

  clear() { localStorage.removeItem(this.LK); },

  resetPattern() {
    if (confirm('Reset pattern? You will need to create a new one.')) {
      localStorage.removeItem(this.SK); localStorage.removeItem(this.LK); location.reload();
    }
  }
};
