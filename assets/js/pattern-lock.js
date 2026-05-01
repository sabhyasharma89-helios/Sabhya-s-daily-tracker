/**
 * PatternLock – SVG-based 3×3 pattern draw/verify
 * Supports both mouse and touch (mobile).
 */
const PatternLock = (() => {
  /* ── Layout ── */
  const COLS = 3, ROWS = 3, DOT_R = 14, HIT_R = 28;
  const W = 210, H = 210;
  const POSITIONS = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      POSITIONS.push({ x: 35 + c * 70, y: 35 + r * 70, index: r * COLS + c });

  /* ── Internal state ── */
  let _svgEl, _linesEl, _activeLineEl, _dotsEl;
  let _isDrawing = false, _pattern = [], _onDone = null, _mode = null;

  /* ── Second‑pass for "confirm pattern" ── */
  let _firstPattern = null;

  /* ── Utility ── */
  const svgPt = (clientX, clientY) => {
    const rect = _svgEl.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width)  * W,
      y: ((clientY - rect.top)  / rect.height) * H
    };
  };

  const nearestDot = (px, py) => {
    for (const d of POSITIONS) {
      const dx = d.x - px, dy = d.y - py;
      if (Math.sqrt(dx*dx + dy*dy) <= HIT_R) return d.index;
    }
    return -1;
  };

  const drawDots = () => {
    _dotsEl.innerHTML = '';
    for (const d of POSITIONS) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.dataset.idx = d.index;
      // Outer ring
      const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      outer.setAttribute('cx', d.x); outer.setAttribute('cy', d.y);
      outer.setAttribute('r', DOT_R);
      outer.setAttribute('fill', 'rgba(99,102,241,0.1)');
      outer.setAttribute('stroke', '#334155');
      outer.setAttribute('stroke-width', '1.5');
      outer.classList.add('outer');
      // Inner dot
      const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      inner.setAttribute('cx', d.x); inner.setAttribute('cy', d.y);
      inner.setAttribute('r', 5);
      inner.setAttribute('fill', '#64748b');
      inner.classList.add('inner');
      g.appendChild(outer); g.appendChild(inner);
      _dotsEl.appendChild(g);
    }
  };

  const dotEl = idx => _dotsEl.querySelector(`[data-idx="${idx}"]`);

  const activateDot = idx => {
    const g = dotEl(idx); if (!g) return;
    g.querySelector('.outer').setAttribute('fill', 'rgba(99,102,241,0.25)');
    g.querySelector('.outer').setAttribute('stroke', '#6366f1');
    g.querySelector('.inner').setAttribute('fill', '#818cf8');
    g.querySelector('.inner').setAttribute('r', '7');
  };

  const errorDots = () => {
    for (const idx of _pattern) {
      const g = dotEl(idx); if (!g) continue;
      g.querySelector('.outer').setAttribute('stroke', '#ef4444');
      g.querySelector('.inner').setAttribute('fill', '#ef4444');
    }
  };

  const addLine = (x1, y1, x2, y2) => {
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
    ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
    ln.setAttribute('stroke', '#6366f1');
    ln.setAttribute('stroke-width', '2.5');
    ln.setAttribute('stroke-linecap', 'round');
    ln.setAttribute('opacity', '0.7');
    _linesEl.appendChild(ln);
  };

  const resetVisuals = () => {
    _linesEl.innerHTML = '';
    _activeLineEl.setAttribute('opacity', '0');
    drawDots();
  };

  /* ── Public API ── */
  const init = (svgId, linesId, activeLineId, dotsId, onDone) => {
    _svgEl        = document.getElementById(svgId);
    _linesEl      = document.getElementById(linesId);
    _activeLineEl = document.getElementById(activeLineId);
    _dotsEl       = document.getElementById(dotsId);
    _onDone       = onDone;
    _isDrawing    = false;
    _pattern      = [];
    _firstPattern = null;
    drawDots();
    attachEvents(_svgEl);
  };

  const attachEvents = (svg) => {
    svg.addEventListener('mousedown',  onStart);
    svg.addEventListener('mousemove',  onMove);
    svg.addEventListener('mouseup',    onEnd);
    svg.addEventListener('mouseleave', onEnd);
    svg.addEventListener('touchstart', onTouchStart, { passive: false });
    svg.addEventListener('touchmove',  onTouchMove,  { passive: false });
    svg.addEventListener('touchend',   onEnd);
  };

  const onStart = e => {
    const { x, y } = svgPt(e.clientX, e.clientY);
    const idx = nearestDot(x, y);
    if (idx < 0) return;
    _isDrawing = true;
    _pattern = [idx];
    resetVisuals();
    activateDot(idx);
  };

  const onMove = e => {
    if (!_isDrawing) return;
    const { x, y } = svgPt(e.clientX, e.clientY);
    const last = POSITIONS[_pattern[_pattern.length - 1]];
    _activeLineEl.setAttribute('x1', last.x); _activeLineEl.setAttribute('y1', last.y);
    _activeLineEl.setAttribute('x2', x);       _activeLineEl.setAttribute('y2', y);
    _activeLineEl.setAttribute('stroke', '#6366f1');
    _activeLineEl.setAttribute('opacity', '0.5');
    const idx = nearestDot(x, y);
    if (idx >= 0 && !_pattern.includes(idx)) {
      addLine(last.x, last.y, POSITIONS[idx].x, POSITIONS[idx].y);
      _pattern.push(idx);
      activateDot(idx);
    }
  };

  const onEnd = () => {
    if (!_isDrawing) return;
    _isDrawing = false;
    _activeLineEl.setAttribute('opacity', '0');
    if (_pattern.length >= 4 && _onDone) _onDone(_pattern.slice());
    else if (_pattern.length > 0 && _pattern.length < 4) {
      errorDots();
      setTimeout(clearPattern, 900);
    }
  };

  const onTouchStart = e => {
    e.preventDefault();
    const t = e.touches[0];
    onStart({ clientX: t.clientX, clientY: t.clientY });
  };
  const onTouchMove = e => {
    e.preventDefault();
    const t = e.touches[0];
    onMove({ clientX: t.clientX, clientY: t.clientY });
  };

  const clearPattern = () => {
    _pattern = [];
    _isDrawing = false;
    resetVisuals();
  };

  /* SHA-256 pattern hash using SubtleCrypto */
  const hashPattern = async (pattern) => {
    const str = pattern.join('-');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  };

  /* AES-GCM key derived from pattern */
  const deriveKey = async (pattern) => {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pattern.join('-')),
      { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('tasktracker-salt-v1'), iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  };

  const encrypt = async (pattern, plaintext) => {
    const key = await deriveKey(pattern);
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv); combined.set(new Uint8Array(ct), iv.length);
    return btoa(String.fromCharCode(...combined));
  };

  const decrypt = async (pattern, b64) => {
    try {
      const key  = await deriveKey(pattern);
      const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const iv   = data.slice(0, 12);
      const ct   = data.slice(12);
      const pt   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(pt);
    } catch { return null; }
  };

  return { init, clearPattern, hashPattern, encrypt, decrypt };
})();
