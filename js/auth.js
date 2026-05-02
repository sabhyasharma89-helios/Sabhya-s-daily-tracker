/**
 * Pattern Lock Authentication
 * 3x3 grid pattern — stores hashed pattern in localStorage.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'sdt_pattern_hash';
  const ATTEMPT_KEY = 'sdt_failed_attempts';
  const LOCKOUT_KEY = 'sdt_lockout_until';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 30000; // 30 seconds

  const DOT_POSITIONS = [];
  const DOT_RADIUS = 10;
  let canvas, ctx, dots, selectedDots, isDrawing, currentX, currentY;
  let mode = 'unlock'; // 'unlock' | 'set' | 'confirm'
  let pendingPattern = null;

  // Generate dot grid positions (in canvas space, 240x240)
  function initDotPositions() {
    DOT_POSITIONS.length = 0;
    const padding = 40;
    const step = (240 - padding * 2) / 2;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        DOT_POSITIONS.push({ x: padding + c * step, y: padding + r * step, idx: r * 3 + c });
      }
    }
  }

  // Simple hash (FNV-1a variant)
  function hashPattern(arr) {
    let h = 0x811c9dc5;
    for (const n of arr) {
      h ^= n;
      h = (Math.imul(h, 0x01000193) >>> 0);
    }
    return h.toString(16);
  }

  function savePattern(pattern) {
    localStorage.setItem(STORAGE_KEY, hashPattern(pattern));
  }

  function hasPattern() {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  function verifyPattern(pattern) {
    return hashPattern(pattern) === localStorage.getItem(STORAGE_KEY);
  }

  function isLockedOut() {
    const until = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10);
    return Date.now() < until;
  }

  function remainingLockout() {
    const until = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10);
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  function recordFailure() {
    let attempts = parseInt(localStorage.getItem(ATTEMPT_KEY) || '0', 10) + 1;
    localStorage.setItem(ATTEMPT_KEY, attempts);
    if (attempts >= MAX_ATTEMPTS) {
      localStorage.setItem(LOCKOUT_KEY, Date.now() + LOCKOUT_MS);
      localStorage.setItem(ATTEMPT_KEY, '0');
    }
    return attempts;
  }

  function resetFailures() {
    localStorage.removeItem(ATTEMPT_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  }

  // ── Canvas drawing ──────────────────────────────────────────────

  function drawDots() {
    DOT_POSITIONS.forEach((dot, i) => {
      const el = document.getElementById(`dot-${i}`);
      const isSelected = selectedDots.includes(i);
      if (el) {
        el.classList.toggle('selected', isSelected);
      }
    });
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawLines() {
    if (selectedDots.length < 2) return;
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    selectedDots.forEach((idx, i) => {
      const d = DOT_POSITIONS[idx];
      if (i === 0) ctx.moveTo(d.x, d.y);
      else ctx.lineTo(d.x, d.y);
    });
    ctx.stroke();
  }

  function drawCurrentLine() {
    if (selectedDots.length === 0 || !isDrawing) return;
    const last = DOT_POSITIONS[selectedDots[selectedDots.length - 1]];
    ctx.strokeStyle = 'rgba(167,139,250,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
  }

  function render() {
    clearCanvas();
    drawLines();
    drawCurrentLine();
    drawDots();
  }

  // ── Event handling ──────────────────────────────────────────────

  function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function hitTest(x, y) {
    for (const dot of DOT_POSITIONS) {
      const dx = dot.x - x, dy = dot.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= DOT_RADIUS * 2) return dot.idx;
    }
    return -1;
  }

  function onStart(e) {
    e.preventDefault();
    if (isLockedOut()) return;
    isDrawing = true;
    selectedDots = [];
    const pt = getCanvasPoint(e);
    currentX = pt.x; currentY = pt.y;
    const hit = hitTest(pt.x, pt.y);
    if (hit >= 0) selectedDots.push(hit);
    render();
  }

  function onMove(e) {
    e.preventDefault();
    if (!isDrawing) return;
    const pt = getCanvasPoint(e);
    currentX = pt.x; currentY = pt.y;
    const hit = hitTest(pt.x, pt.y);
    if (hit >= 0 && !selectedDots.includes(hit)) {
      selectedDots.push(hit);
    }
    render();
  }

  function onEnd(e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false;
    if (selectedDots.length < 4) {
      setStatus('Pattern too short — connect at least 4 dots', 'error');
      setTimeout(resetPattern, 800);
      return;
    }
    handlePattern([...selectedDots]);
  }

  function resetPattern() {
    selectedDots = [];
    clearCanvas();
    drawDots();
  }

  // ── Pattern logic ───────────────────────────────────────────────

  function setStatus(msg, type = '') {
    const el = document.getElementById('auth-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'auth-status ' + type;
  }

  function setSubtitle(msg) {
    const el = document.getElementById('auth-subtitle');
    if (el) el.textContent = msg;
  }

  function handlePattern(pattern) {
    if (mode === 'set') {
      pendingPattern = pattern;
      mode = 'confirm';
      setSubtitle('Confirm your pattern');
      setStatus('Draw the same pattern again to confirm');
      setTimeout(resetPattern, 400);
      return;
    }

    if (mode === 'confirm') {
      if (hashPattern(pattern) === hashPattern(pendingPattern)) {
        savePattern(pattern);
        resetFailures();
        setStatus('Pattern saved! Unlocking…', 'success');
        setTimeout(unlockApp, 700);
      } else {
        setStatus('Patterns do not match. Try again.', 'error');
        pendingPattern = null;
        mode = 'set';
        setSubtitle('Draw your new pattern');
        setTimeout(resetPattern, 600);
      }
      return;
    }

    // mode === 'unlock'
    if (isLockedOut()) {
      setStatus(`Too many attempts. Wait ${remainingLockout()}s`, 'error');
      setTimeout(resetPattern, 600);
      return;
    }

    if (verifyPattern(pattern)) {
      resetFailures();
      setStatus('Unlocked!', 'success');
      setTimeout(unlockApp, 400);
    } else {
      const attempts = recordFailure();
      const left = MAX_ATTEMPTS - parseInt(localStorage.getItem(ATTEMPT_KEY) || '0', 10);
      if (isLockedOut()) {
        setStatus(`Locked for ${remainingLockout()}s`, 'error');
      } else {
        setStatus(`Wrong pattern. ${left} attempt(s) left.`, 'error');
      }
      setTimeout(resetPattern, 600);
    }
  }

  function unlockApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    if (typeof window.onAppUnlocked === 'function') window.onAppUnlocked();
  }

  // ── DOM setup ───────────────────────────────────────────────────

  function buildDotGrid() {
    const container = document.getElementById('pattern-dots');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'pattern-dot';
      wrap.id = `dot-${i}`;
      const inner = document.createElement('div');
      inner.className = 'pattern-dot-inner';
      wrap.appendChild(inner);
      container.appendChild(wrap);
    }
  }

  function init() {
    canvas = document.getElementById('pattern-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    selectedDots = [];
    isDrawing = false;

    initDotPositions();
    buildDotGrid();

    // Attach events
    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });

    const btnSet = document.getElementById('btn-set-pattern');
    if (btnSet) {
      btnSet.addEventListener('click', () => {
        mode = 'set';
        pendingPattern = null;
        setSubtitle('Draw your new pattern');
        setStatus('');
        resetPattern();
      });
    }

    // Determine initial mode
    if (!hasPattern()) {
      mode = 'set';
      setSubtitle('Create your unlock pattern');
      setStatus('Connect at least 4 dots to set your pattern');
      const hint = document.getElementById('auth-hint');
      if (hint) hint.textContent = 'First time? Draw a pattern of at least 4 dots.';
    } else {
      mode = 'unlock';
      const actions = document.getElementById('auth-actions');
      if (actions) actions.style.display = 'flex';
    }

    if (isLockedOut()) {
      setStatus(`Too many attempts. Wait ${remainingLockout()}s`, 'error');
    }

    render();
  }

  // Expose for settings panel
  window.AuthModule = {
    enterSetMode() {
      mode = 'set';
      pendingPattern = null;
      document.getElementById('auth-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-subtitle').textContent = 'Draw your new pattern';
      setStatus('Connect at least 4 dots');
      resetPattern && resetPattern();
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
