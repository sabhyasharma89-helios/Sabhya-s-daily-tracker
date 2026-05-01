/**
 * Pattern Lock Authentication
 * 3×3 dot grid, touch+mouse support, SHA-256 hash storage.
 */

const Auth = (() => {
  const STORAGE_KEY = 'sdt_pattern_hash';
  const SETUP_CONFIRM_KEY = 'sdt_setup_confirm';
  const MIN_DOTS = 4;

  let canvas, ctx, dots, selectedDots, isDrawing, setupMode, confirmPattern;
  let onUnlockCallback, onSetupCallback;

  // ── Dot layout (3×3) ──────────────────────────────────────
  function buildDots(size) {
    const pad = size * 0.15;
    const step = (size - 2 * pad) / 2;
    const result = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        result.push({
          index: r * 3 + c,
          x: pad + c * step,
          y: pad + r * step,
          activated: false,
        });
      }
    }
    return result;
  }

  // ── SHA-256 via Web Crypto ────────────────────────────────
  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Hit test ──────────────────────────────────────────────
  function dotRadius() { return canvas.width * 0.06; }

  function hitTest(x, y) {
    const r = dotRadius() + 8;
    return dots.find(d => !d.activated && Math.hypot(d.x - x, d.y - y) < r);
  }

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  }

  // ── Draw ──────────────────────────────────────────────────
  function draw(cursorX, cursorY, color) {
    const r = dotRadius();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Connection lines
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;

    if (selectedDots.length > 0) {
      ctx.beginPath();
      ctx.moveTo(selectedDots[0].x, selectedDots[0].y);
      for (let i = 1; i < selectedDots.length; i++) {
        ctx.lineTo(selectedDots[i].x, selectedDots[i].y);
      }
      if (isDrawing && cursorX !== undefined) {
        ctx.lineTo(cursorX, cursorY);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // Dots
    dots.forEach(d => {
      const active = d.activated;

      // Outer ring (active)
      if (active) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, r * 1.7, 0, Math.PI * 2);
        ctx.fillStyle = color + '28';
        ctx.fill();
      }

      // Core dot
      ctx.beginPath();
      ctx.arc(d.x, d.y, active ? r * 0.85 : r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = active ? color : 'rgba(255,255,255,0.45)';
      ctx.fill();
    });
  }

  // ── Event handlers ────────────────────────────────────────
  function onStart(e) {
    e.preventDefault();
    isDrawing = true;
    selectedDots = [];
    dots.forEach(d => (d.activated = false));
    const pos = getCanvasPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit) { hit.activated = true; selectedDots.push(hit); }
    draw(pos.x, pos.y, '#4a90e2');
  }

  function onMove(e) {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getCanvasPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit) { hit.activated = true; selectedDots.push(hit); }
    draw(pos.x, pos.y, '#4a90e2');
  }

  async function onEnd(e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false;
    if (selectedDots.length < MIN_DOTS) {
      showMessage(`Connect at least ${MIN_DOTS} dots`, 'error');
      setTimeout(reset, 800);
      return;
    }
    const pattern = selectedDots.map(d => d.index).join(',');
    await handlePattern(pattern);
  }

  // ── Pattern logic ─────────────────────────────────────────
  async function handlePattern(pattern) {
    const hash = await sha256(pattern);

    if (setupMode === 'set') {
      confirmPattern = pattern;
      setupMode = 'confirm';
      draw(undefined, undefined, '#69db7c');
      showMessage('Draw pattern again to confirm', '');
      setTimeout(reset, 600);
      return;
    }

    if (setupMode === 'confirm') {
      if (pattern === confirmPattern) {
        // Save hash
        localStorage.setItem(STORAGE_KEY, hash);
        draw(undefined, undefined, '#69db7c');
        showMessage('Pattern set successfully!', 'success');
        setTimeout(() => { if (onSetupCallback) onSetupCallback(); }, 700);
      } else {
        draw(undefined, undefined, '#e53935');
        showMessage('Patterns do not match. Try again.', 'error');
        setupMode = 'set';
        confirmPattern = null;
        setTimeout(reset, 800);
      }
      return;
    }

    // Unlock mode — verify
    const storedHash = localStorage.getItem(STORAGE_KEY);
    if (hash === storedHash) {
      draw(undefined, undefined, '#69db7c');
      showMessage('Unlocked!', 'success');
      setTimeout(() => { if (onUnlockCallback) onUnlockCallback(); }, 400);
    } else {
      draw(undefined, undefined, '#e53935');
      showMessage('Incorrect pattern', 'error');
      canvas.closest('.auth-card')?.classList.add('shake');
      setTimeout(() => {
        canvas.closest('.auth-card')?.classList.remove('shake');
        reset();
      }, 800);
    }
  }

  function reset() {
    selectedDots = [];
    dots.forEach(d => (d.activated = false));
    isDrawing = false;
    draw();
  }

  // ── UI helpers ────────────────────────────────────────────
  function showMessage(msg, type) {
    const el = document.getElementById('auth-message');
    if (!el) return;
    el.textContent = msg;
    el.className = 'auth-message' + (type ? ` ${type}` : '');
  }

  // ── Public API ────────────────────────────────────────────
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');

    const size = Math.min(canvas.offsetWidth || 240, 260);
    canvas.width = size;
    canvas.height = size;

    dots = buildDots(size);
    selectedDots = [];
    isDrawing = false;

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });

    draw();
  }

  function isPatternSet() {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  function startSetup(onDone) {
    setupMode = 'set';
    confirmPattern = null;
    onSetupCallback = onDone;
    showMessage('Draw your unlock pattern', '');
    reset();
  }

  function startVerify(onDone) {
    setupMode = null;
    onUnlockCallback = onDone;
    showMessage('Draw your pattern to unlock', '');
    reset();
  }

  function clearPattern() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { init, isPatternSet, startSetup, startVerify, clearPattern };
})();
