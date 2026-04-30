/* ═══════════════════════════════════════════════════════════════
   Pattern Lock — Android-style 3×3 canvas pattern authentication
   ═══════════════════════════════════════════════════════════════ */

const PatternLock = (() => {

  const STORAGE_KEY = 'sdt_pattern_hash';
  const FAIL_KEY    = 'sdt_fail_data';
  const MIN_DOTS    = 4;
  const MAX_FAILS   = 5;
  const LOCKOUT_MS  = 30_000;

  /* Canvas + context */
  let canvas, ctx;

  /* Dot positions (populated on init) */
  let dots = [];

  /* Current draw state */
  let active      = false;
  let selected    = [];   // dot indices in draw order
  let currentPos  = { x: 0, y: 0 };

  /* Auth flow mode: 'setup-1' | 'setup-2' | 'unlock' */
  let mode    = 'unlock';
  let tempPat = null;    // pattern from first setup draw

  /* ── DOM refs ── */
  const $screen    = () => document.getElementById('lock-screen');
  const $app       = () => document.getElementById('app');
  const $title     = () => document.getElementById('lock-title');
  const $msg       = () => document.getElementById('lock-message');
  const $canvasWrap = () => document.querySelector('.canvas-wrap');
  const $resetBtn  = () => document.getElementById('lock-reset-btn');
  const $clearBtn  = () => document.getElementById('lock-clear-btn');

  /* ══════════════════ Crypto ══════════════════ */
  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /* ══════════════════ Fail tracking ══════════════════ */
  function getFailData() {
    try { return JSON.parse(localStorage.getItem(FAIL_KEY) || '{"count":0,"until":0}'); }
    catch { return { count: 0, until: 0 }; }
  }
  function setFailData(d) { localStorage.setItem(FAIL_KEY, JSON.stringify(d)); }

  function isLockedOut() {
    const { until } = getFailData();
    return Date.now() < until;
  }
  function getLockoutRemaining() {
    return Math.max(0, Math.ceil((getFailData().until - Date.now()) / 1000));
  }
  function recordFail() {
    const d = getFailData();
    d.count = (d.count || 0) + 1;
    d.until = d.count >= MAX_FAILS ? Date.now() + LOCKOUT_MS : 0;
    setFailData(d);
    return d;
  }
  function clearFails() { setFailData({ count: 0, until: 0 }); }

  /* ══════════════════ Dot Layout ══════════════════ */
  function buildDots() {
    const size    = canvas.width;
    const pad     = size * 0.16;
    const step    = (size - pad * 2) / 2;
    dots = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        dots.push({ x: pad + c * step, y: pad + r * step, idx: r * 3 + c });
      }
    }
  }

  /* ══════════════════ Drawing ══════════════════ */
  const COLORS = {
    dot:      '#343a52',
    dotActive:'#6c63ff',
    dotError: '#ef4444',
    dotOk:    '#22c55e',
    line:     'rgba(108,99,255,.55)',
    lineError:'rgba(239,68,68,.55)',
    lineOk:   'rgba(34,197,94,.55)',
  };

  function draw(state = 'idle') {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lineColor = state === 'error' ? COLORS.lineError
                    : state === 'ok'    ? COLORS.lineOk
                    :                     COLORS.line;
    const activeColor = state === 'error' ? COLORS.dotError
                      : state === 'ok'    ? COLORS.dotOk
                      :                     COLORS.dotActive;

    /* Lines between selected dots */
    if (selected.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      dots[selected[0]] && ctx.moveTo(dots[selected[0]].x, dots[selected[0]].y);
      for (let i = 1; i < selected.length; i++) {
        dots[selected[i]] && ctx.lineTo(dots[selected[i]].x, dots[selected[i]].y);
      }
      ctx.stroke();
    }

    /* Line to current finger/cursor position */
    if (active && selected.length > 0) {
      const last = dots[selected[selected.length - 1]];
      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* Dots */
    dots.forEach(d => {
      const isSelected = selected.includes(d.idx);
      const isLast     = selected.length > 0 && selected[selected.length - 1] === d.idx;

      /* Outer ring for selected */
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 16, 0, Math.PI * 2);
        ctx.fillStyle = state === 'error' ? 'rgba(239,68,68,.12)'
                      : state === 'ok'    ? 'rgba(34,197,94,.12)'
                      :                     'rgba(108,99,255,.12)';
        ctx.fill();
      }

      /* Main dot */
      ctx.beginPath();
      ctx.arc(d.x, d.y, isLast ? 9 : isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? activeColor : COLORS.dot;
      ctx.fill();

      /* Dot index number (subtle) */
      if (!isSelected) {
        ctx.fillStyle = 'rgba(122,132,158,.3)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.idx + 1, d.x, d.y);
      }
    });
  }

  /* ══════════════════ Pointer helpers ══════════════════ */
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  }

  function nearestDot(pos) {
    const R = canvas.width * 0.085;
    for (const d of dots) {
      const dist = Math.hypot(d.x - pos.x, d.y - pos.y);
      if (dist < R) return d.idx;
    }
    return -1;
  }

  /* ══════════════════ Events ══════════════════ */
  function onStart(e) {
    e.preventDefault();
    if (isLockedOut()) return;
    active = true;
    selected = [];
    currentPos = getPos(e);
    const hit = nearestDot(currentPos);
    if (hit !== -1) selected.push(hit);
    draw();
  }

  function onMove(e) {
    e.preventDefault();
    if (!active) return;
    currentPos = getPos(e);
    const hit = nearestDot(currentPos);
    if (hit !== -1 && !selected.includes(hit)) selected.push(hit);
    draw();
  }

  function onEnd(e) {
    e.preventDefault();
    if (!active) return;
    active = false;
    if (selected.length >= MIN_DOTS) {
      handlePattern(selected.join(''));
    } else if (selected.length > 0) {
      setMessage('Connect at least ' + MIN_DOTS + ' dots', 'error');
      draw('error');
      setTimeout(() => { selected = []; draw(); setMessage(''); }, 900);
    } else {
      draw();
    }
  }

  /* ══════════════════ Pattern handling ══════════════════ */
  async function handlePattern(pat) {
    if (mode === 'setup-1') {
      tempPat = pat;
      mode    = 'setup-2';
      setTitle('Confirm Pattern');
      setMessage('Draw the same pattern again to confirm', '');
      selected = []; draw('ok');
      return;
    }

    if (mode === 'setup-2') {
      if (pat === tempPat) {
        const hash = await sha256(pat);
        localStorage.setItem(STORAGE_KEY, hash);
        clearFails();
        draw('ok');
        setMessage('Pattern set! Unlocking…', 'success');
        setTimeout(() => unlock(), 700);
      } else {
        draw('error');
        setMessage('Patterns do not match — try again', 'error');
        mode    = 'setup-1';
        tempPat = null;
        setTitle('Set a Pattern');
        setTimeout(() => { selected = []; draw(); setMessage(''); }, 1000);
      }
      return;
    }

    /* mode === 'unlock' */
    const stored = localStorage.getItem(STORAGE_KEY);
    const hash   = await sha256(pat);
    if (hash === stored) {
      clearFails();
      draw('ok');
      setMessage('Unlocked!', 'success');
      setTimeout(() => unlock(), 400);
    } else {
      draw('error');
      shake();
      const d = recordFail();
      if (d.count >= MAX_FAILS) {
        setMessage('Too many attempts — locked for 30s', 'error');
        startLockoutTimer();
      } else {
        setMessage('Wrong pattern (' + (MAX_FAILS - d.count) + ' left)', 'error');
        setTimeout(() => { selected = []; draw(); setMessage(''); }, 1000);
      }
    }
  }

  /* ══════════════════ UI helpers ══════════════════ */
  function setTitle(t) { $title() && ($title().textContent = t); }
  function setMessage(t, cls = '') {
    const el = $msg();
    if (!el) return;
    el.textContent = t;
    el.className   = 'lock-message' + (cls ? ' ' + cls : '');
  }
  function shake() { $canvasWrap()?.classList.add('shake'); setTimeout(() => $canvasWrap()?.classList.remove('shake'), 500); }

  function startLockoutTimer() {
    const tick = () => {
      const rem = getLockoutRemaining();
      if (rem <= 0) {
        clearFails();
        setMessage('Try again', '');
        setTitle('Draw Pattern to Unlock');
        selected = []; draw();
      } else {
        setMessage('Locked — wait ' + rem + 's', 'error');
        setTimeout(tick, 1000);
      }
    };
    setTimeout(tick, 1000);
  }

  /* ══════════════════ App lock/unlock ══════════════════ */
  function unlock() {
    $screen().classList.add('hidden');
    $app().classList.remove('hidden');
    selected = []; draw();
    if (typeof App !== 'undefined') App.init();
  }

  function lockApp() {
    $app().classList.add('hidden');
    $screen().classList.remove('hidden');
    mode     = 'unlock';
    selected = [];
    setTitle('Draw Pattern to Unlock');
    setMessage('');
    draw();
  }

  /* ══════════════════ Public API ══════════════════ */
  function clear() {
    selected = [];
    draw();
    setMessage('');
  }

  function startReset() {
    if (confirm('Reset your pattern? You will need to set a new one.')) {
      localStorage.removeItem(STORAGE_KEY);
      clearFails();
      mode    = 'setup-1';
      selected = [];
      setTitle('Set a Pattern');
      setMessage('Draw a new pattern (at least 4 dots)');
      draw();
    }
  }

  /* ══════════════════ Initialisation ══════════════════ */
  function init() {
    canvas = document.getElementById('pattern-canvas');
    ctx    = canvas.getContext('2d');

    /* Scale for HiDPI */
    const dpr = window.devicePixelRatio || 1;
    const cssW = 270;
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssW + 'px';
    canvas.width  = cssW * dpr;
    canvas.height = cssW * dpr;
    ctx.scale(dpr, dpr);

    /* Recalc dot coords at css-pixel scale */
    canvas._cssSize = cssW;
    buildDots();

    /* Events */
    canvas.addEventListener('mousedown',  onStart, { passive: false });
    canvas.addEventListener('mousemove',  onMove,  { passive: false });
    canvas.addEventListener('mouseup',    onEnd,   { passive: false });
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove',  onMove,  { passive: false });
    canvas.addEventListener('touchend',   onEnd,   { passive: false });

    /* Determine initial mode */
    const hasPattern = !!localStorage.getItem(STORAGE_KEY);
    if (hasPattern) {
      mode = 'unlock';
      setTitle('Draw Pattern to Unlock');
      if (isLockedOut()) {
        startLockoutTimer();
      }
    } else {
      mode = 'setup-1';
      setTitle('Set a Pattern');
      setMessage('Draw a pattern to protect your tracker (min. 4 dots)');
    }

    draw();
  }

  /* Re-build dots if canvas is resized (rare on desktop) */
  function onResize() {
    buildDots();
    draw();
  }
  window.addEventListener('resize', onResize);

  /* Auto-init when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { lockApp, clear, startReset };

})();
