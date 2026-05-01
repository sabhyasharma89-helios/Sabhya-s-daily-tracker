/**
 * Pattern Lock Authentication
 * Renders a 3×3 dot grid on <canvas> and lets the user draw a path.
 * The pattern (sequence of dot indices 0–8) is SHA-256-hashed and stored
 * in localStorage.  A minimum of 4 dots is required.
 */

const PatternAuth = (() => {
  /* ── DOM refs ────────────────────────────────────────────── */
  let canvas, ctx;
  let dots = [];          // [{x, y, index}]
  let selected = [];      // indices of chosen dots in order
  let isDrawing = false;
  let currentPos = null;  // mouse/touch current position
  let mode = 'verify';    // 'set' | 'confirm' | 'verify'
  let firstPattern = [];  // stored during 'set' → 'confirm' flow
  let onSuccess = null;

  const COLS = 3, ROWS = 3;
  const DOT_R = 10, HIT_R = 30;
  const COLORS = {
    dot:      '#334155',
    dotHover: '#6366f1',
    dotSel:   '#6366f1',
    line:     'rgba(99,102,241,.6)',
    lineErr:  'rgba(239,68,68,.7)',
  };

  /* ── Hashing ─────────────────────────────────────────────── */
  async function hashPattern(pattern) {
    const encoder = new TextEncoder();
    const data  = encoder.encode(pattern.join('-'));
    const buf   = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ── Canvas geometry ─────────────────────────────────────── */
  function computeDots() {
    const size  = canvas.width;
    const step  = size / (COLS + 1);
    dots = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        dots.push({ x: step * (c + 1), y: step * (r + 1), index: r * COLS + c });
      }
    }
  }

  /* ── Drawing ─────────────────────────────────────────────── */
  function draw(lineColor) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Connection lines between selected dots
    if (selected.length > 0) {
      ctx.strokeStyle = lineColor || COLORS.line;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = dots[selected[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < selected.length; i++) {
        const d = dots[selected[i]];
        ctx.lineTo(d.x, d.y);
      }
      // Line to current pointer if drawing
      if (isDrawing && currentPos) {
        ctx.lineTo(currentPos.x, currentPos.y);
      }
      ctx.stroke();
    }

    // Dots
    dots.forEach(dot => {
      const isSel = selected.includes(dot.index);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? COLORS.dotSel : COLORS.dot;
      ctx.fill();

      if (isSel) {
        // Outer ring for selected
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, DOT_R + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(99,102,241,.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }

  function flashError() {
    draw(COLORS.lineErr);
    setTimeout(() => { selected = []; draw(); }, 600);
  }

  /* ── Hit-testing ─────────────────────────────────────────── */
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function nearestDot(pos) {
    for (const dot of dots) {
      const dx = dot.x - pos.x, dy = dot.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= HIT_R) return dot;
    }
    return null;
  }

  /* ── Event handlers ──────────────────────────────────────── */
  function onStart(e) {
    e.preventDefault();
    const pos = getPos(e);
    const dot = nearestDot(pos);
    if (!dot) return;
    isDrawing = true;
    selected = [dot.index];
    currentPos = pos;
    draw();
  }

  function onMove(e) {
    e.preventDefault();
    if (!isDrawing) return;
    currentPos = getPos(e);
    const dot = nearestDot(currentPos);
    if (dot && !selected.includes(dot.index)) {
      selected.push(dot.index);
    }
    draw();
  }

  async function onEnd(e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false;
    currentPos = null;

    if (selected.length < 4) {
      setMessage('Draw at least 4 dots', 'error');
      flashError();
      return;
    }

    await handlePattern([...selected]);
    selected = [];
    draw();
  }

  /* ── Pattern handling ────────────────────────────────────── */
  async function handlePattern(pattern) {
    if (mode === 'set') {
      firstPattern = pattern;
      mode = 'confirm';
      setMessage('Draw the same pattern again to confirm', '');
    } else if (mode === 'confirm') {
      if (pattern.join(',') !== firstPattern.join(',')) {
        setMessage('Patterns do not match — try again', 'error');
        flashError();
        firstPattern = [];
        mode = 'set';
        setTitle('Set your pattern');
        return;
      }
      const hash = await hashPattern(pattern);
      localStorage.setItem('tracker_pattern_hash', hash);
      setMessage('Pattern saved!', 'success');
      setTimeout(() => { onSuccess && onSuccess(); }, 600);
    } else {
      // verify
      const stored = localStorage.getItem('tracker_pattern_hash');
      const hash = await hashPattern(pattern);
      if (hash === stored) {
        setMessage('Unlocked!', 'success');
        setTimeout(() => { onSuccess && onSuccess(); }, 400);
      } else {
        setMessage('Incorrect pattern — try again', 'error');
        flashError();
      }
    }
  }

  /* ── UI helpers ──────────────────────────────────────────── */
  function setMessage(msg, type) {
    const el = document.getElementById('auth-message');
    if (!el) return;
    el.textContent = msg;
    el.className = 'auth-message' + (type ? ' ' + type : '');
  }

  function setTitle(text) {
    const el = document.getElementById('auth-title');
    if (el) el.textContent = text;
  }

  /* ── Public API ──────────────────────────────────────────── */
  function init(canvasEl, _mode, _onSuccess) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    mode = _mode;
    onSuccess = _onSuccess;
    firstPattern = [];
    selected = [];
    isDrawing = false;

    const size = Math.min(window.innerWidth - 64, 280);
    canvas.width  = size;
    canvas.height = size;
    computeDots();
    draw();

    canvas.addEventListener('mousedown',  onStart);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove',  onMove,  { passive: false });
    canvas.addEventListener('touchend',   onEnd,   { passive: false });
  }

  function destroy() {
    if (!canvas) return;
    canvas.removeEventListener('mousedown',  onStart);
    canvas.removeEventListener('mousemove',  onMove);
    canvas.removeEventListener('mouseup',    onEnd);
    canvas.removeEventListener('touchstart', onStart);
    canvas.removeEventListener('touchmove',  onMove);
    canvas.removeEventListener('touchend',   onEnd);
  }

  function hasStoredPattern() {
    return !!localStorage.getItem('tracker_pattern_hash');
  }

  function clearStoredPattern() {
    localStorage.removeItem('tracker_pattern_hash');
  }

  return { init, destroy, hasStoredPattern, clearStoredPattern };
})();
