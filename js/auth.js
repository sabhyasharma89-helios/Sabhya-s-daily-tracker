/* ═══════════════════════════════════════════════════════════
   PATTERN AUTHENTICATION MODULE
   - 3×3 dot grid, touch + mouse support
   - Pattern stored as SHA-256 hash in localStorage
   - First visit: create pattern (confirm twice)
   - Subsequent: verify pattern
═══════════════════════════════════════════════════════════ */

const Auth = (() => {
  const STORAGE_KEY  = 'tracker_pattern_hash';
  const MIN_DOTS     = 4;
  const GRID_SIZE    = 3;
  const TOTAL_DOTS   = GRID_SIZE * GRID_SIZE;

  let selectedDots   = [];
  let isDrawing      = false;
  let mode           = 'verify'; // 'create' | 'confirm' | 'verify'
  let firstPattern   = null;
  let onSuccess      = null;
  let dotElements    = [];
  let svgCanvas      = null;
  let dotCenters     = [];
  let currentLine    = null;

  // ── SHA-256 hash (Web Crypto API) ──────────────────────────
  async function hashPattern(pattern) {
    const data    = new TextEncoder().encode(pattern.join('-'));
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ── Build the 3×3 dot grid ─────────────────────────────────
  function buildGrid() {
    const grid = document.getElementById('pattern-grid');
    grid.innerHTML = '';

    // Add SVG canvas for connection lines
    svgCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgCanvas.id = 'pattern-canvas';
    svgCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    grid.style.position = 'relative';
    grid.appendChild(svgCanvas);

    dotElements = [];
    for (let i = 0; i < TOTAL_DOTS; i++) {
      const dot = document.createElement('div');
      dot.className = 'pattern-dot';
      dot.dataset.index = i;
      grid.appendChild(dot);
      dotElements.push(dot);
    }

    // Attach events after render (need layout for centers)
    requestAnimationFrame(() => {
      computeDotCenters();
      attachEvents();
    });
  }

  function computeDotCenters() {
    const gridRect = document.getElementById('pattern-grid').getBoundingClientRect();
    dotCenters = dotElements.map(dot => {
      const r = dot.getBoundingClientRect();
      return {
        x: r.left - gridRect.left + r.width  / 2,
        y: r.top  - gridRect.top  + r.height / 2,
      };
    });
  }

  // ── Touch / Mouse event handling ───────────────────────────
  function getEventPos(e) {
    const touch = e.touches ? e.touches[0] : e;
    const gridRect = document.getElementById('pattern-grid').getBoundingClientRect();
    return {
      x: touch.clientX - gridRect.left,
      y: touch.clientY - gridRect.top,
    };
  }

  function nearestDot(pos) {
    let best = -1, bestDist = 40; // 40px snap radius
    dotCenters.forEach((c, i) => {
      const d = Math.hypot(pos.x - c.x, pos.y - c.y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    selectedDots = [];
    clearVisuals();
    const pos = getEventPos(e);
    const idx = nearestDot(pos);
    if (idx >= 0) selectDot(idx);
    updateCurrentLine(pos);
  }

  function moveDraw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getEventPos(e);
    const idx = nearestDot(pos);
    if (idx >= 0 && !selectedDots.includes(idx)) selectDot(idx);
    updateCurrentLine(pos);
  }

  function endDraw(e) {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentLine) { currentLine.remove(); currentLine = null; }
    handlePatternComplete();
  }

  function attachEvents() {
    const grid = document.getElementById('pattern-grid');
    grid.addEventListener('mousedown',  startDraw, { passive: false });
    grid.addEventListener('mousemove',  moveDraw,  { passive: false });
    grid.addEventListener('mouseup',    endDraw,   { passive: false });
    grid.addEventListener('mouseleave', endDraw,   { passive: false });
    grid.addEventListener('touchstart', startDraw, { passive: false });
    grid.addEventListener('touchmove',  moveDraw,  { passive: false });
    grid.addEventListener('touchend',   endDraw,   { passive: false });
  }

  // ── Visual helpers ─────────────────────────────────────────
  function selectDot(idx) {
    selectedDots.push(idx);
    dotElements[idx].classList.add('selected');

    // Draw line from previous dot
    if (selectedDots.length > 1) {
      const prev = dotCenters[selectedDots[selectedDots.length - 2]];
      const curr = dotCenters[idx];
      drawLine(prev, curr, 'connector');
    }
  }

  function drawLine(from, to, cls) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x);   line.setAttribute('y2', to.y);
    line.setAttribute('stroke', 'rgba(99,102,241,0.7)');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.classList.add(cls);
    svgCanvas.appendChild(line);
    return line;
  }

  function updateCurrentLine(pos) {
    if (currentLine) currentLine.remove();
    if (selectedDots.length === 0) return;
    const last = dotCenters[selectedDots[selectedDots.length - 1]];
    currentLine = drawLine(last, pos, 'current');
  }

  function clearVisuals() {
    dotElements.forEach(d => { d.classList.remove('selected', 'error'); });
    if (svgCanvas) svgCanvas.innerHTML = '';
    currentLine = null;
  }

  function flashError() {
    dotElements.forEach(d => {
      d.classList.remove('selected');
      d.classList.add('error');
    });
    svgCanvas.querySelectorAll('line').forEach(l => {
      l.setAttribute('stroke', 'rgba(239,68,68,0.7)');
    });
    setTimeout(clearVisuals, 600);
  }

  // ── Pattern flow ───────────────────────────────────────────
  async function handlePatternComplete() {
    if (selectedDots.length < MIN_DOTS) {
      setHint(`Connect at least ${MIN_DOTS} dots`);
      clearVisuals();
      return;
    }

    if (mode === 'create') {
      firstPattern = [...selectedDots];
      mode = 'confirm';
      setSubtitle('Confirm your pattern');
      setHint('Draw the same pattern again to confirm');
      clearVisuals();

    } else if (mode === 'confirm') {
      if (JSON.stringify(selectedDots) !== JSON.stringify(firstPattern)) {
        flashError();
        setError('Patterns do not match. Try again.');
        mode = 'create';
        firstPattern = null;
        setSubtitle('Set your unlock pattern');
        setHint(`Connect at least ${MIN_DOTS} dots`);
        return;
      }
      // Save
      const hash = await hashPattern(firstPattern);
      localStorage.setItem(STORAGE_KEY, hash);
      setError('');
      onSuccess && onSuccess();

    } else if (mode === 'verify') {
      const storedHash = localStorage.getItem(STORAGE_KEY);
      const inputHash  = await hashPattern(selectedDots);
      if (inputHash === storedHash) {
        setError('');
        onSuccess && onSuccess();
      } else {
        flashError();
        setError('Incorrect pattern. Try again.');
      }
    }
  }

  // ── UI helpers ─────────────────────────────────────────────
  function setSubtitle(text) {
    const el = document.getElementById('auth-subtitle');
    if (el) el.textContent = text;
  }
  function setHint(text) {
    const el = document.getElementById('auth-hint');
    if (el) el.textContent = text;
  }
  function setError(text) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = text;
  }

  // ── Wire up Clear button ───────────────────────────────────
  function wireButtons() {
    document.getElementById('auth-clear-btn').addEventListener('click', () => {
      clearVisuals();
      selectedDots = [];
      setError('');
      if (mode === 'confirm') {
        mode = 'create';
        firstPattern = null;
        setSubtitle('Set your unlock pattern');
        setHint(`Connect at least ${MIN_DOTS} dots`);
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────
  function init(successCallback) {
    onSuccess = successCallback;
    const hasPattern = !!localStorage.getItem(STORAGE_KEY);

    if (hasPattern) {
      mode = 'verify';
      setSubtitle('Draw your unlock pattern');
      setHint('');
    } else {
      mode = 'create';
      setSubtitle('Set your unlock pattern');
      setHint(`Connect at least ${MIN_DOTS} dots`);
    }

    buildGrid();
    wireButtons();
  }

  function lock() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    clearVisuals();
    selectedDots = [];
    setError('');
    mode = 'verify';
    setSubtitle('Draw your unlock pattern');
    setHint('');
  }

  function resetPattern() {
    localStorage.removeItem(STORAGE_KEY);
    mode = 'create';
    firstPattern = null;
    setSubtitle('Set a new unlock pattern');
    setHint(`Connect at least ${MIN_DOTS} dots`);
    clearVisuals();
    selectedDots = [];
    setError('');
  }

  return { init, lock, resetPattern };
})();

window.Auth = Auth;
