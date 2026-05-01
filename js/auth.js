/* ═══════════════════════════════════════════════════════════════
   auth.js — Canvas-based Pattern Lock Authentication
   ═══════════════════════════════════════════════════════════════ */

const Auth = (() => {
  const STORAGE_KEY = 'tracker_pattern_hash';
  const MIN_DOTS = 4;

  // Canvas layout
  const GRID = 3;
  const DOT_RADIUS = 14;
  const DOT_GLOW   = 22;
  const LINE_WIDTH  = 4;

  let canvas, ctx, W, H, dots = [], currentPattern = [], isDrawing = false;
  let mode = 'verify';    // 'setup-first' | 'setup-confirm' | 'verify' | 'change-first' | 'change-confirm'
  let firstPattern = [];  // for confirm step
  let animFrame   = null;
  let errorTimer  = null;
  let resolveAuth = null;

  // ─── Crypto helpers ─────────────────────────────────────────────
  async function sha256(text) {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function deriveKey(hash) {
    const raw = new Uint8Array(32);
    for (let i = 0; i < 32; i++) raw[i] = parseInt(hash.slice(i*2, i*2+2), 16);
    return crypto.subtle.importKey('raw', raw, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  }

  async function encryptData(plaintext, hash) {
    const key = await deriveKey(hash);
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return JSON.stringify({
      iv:   btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(enc)))
    });
  }

  async function decryptData(json, hash) {
    try {
      const { iv: ivB64, data: dataB64 } = JSON.parse(json);
      const key  = await deriveKey(hash);
      const iv   = Uint8Array.from(atob(ivB64),   c => c.charCodeAt(0));
      const data = Uint8Array.from(atob(dataB64),  c => c.charCodeAt(0));
      const dec  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, data);
      return new TextDecoder().decode(dec);
    } catch { return null; }
  }

  // ─── Dot layout ─────────────────────────────────────────────────
  function buildDots() {
    dots = [];
    const pad = W / (GRID + 1);
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        dots.push({ x: pad * (c+1), y: pad * (r+1), idx: r*GRID+c, selected: false });
      }
    }
  }

  function getDotAt(x, y) {
    for (const d of dots) {
      if (Math.hypot(x - d.x, y - d.y) <= DOT_GLOW) return d;
    }
    return null;
  }

  // ─── Drawing ────────────────────────────────────────────────────
  function draw(cursor, color) {
    ctx.clearRect(0, 0, W, H);
    const col = color || '#4361ee';

    // Lines between selected dots
    if (currentPattern.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = col + 'cc';
      ctx.lineWidth   = LINE_WIDTH;
      ctx.lineCap     = 'round';
      const first = dots[currentPattern[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < currentPattern.length; i++) {
        const d = dots[currentPattern[i]];
        ctx.lineTo(d.x, d.y);
      }
      if (cursor && isDrawing) ctx.lineTo(cursor.x, cursor.y);
      ctx.stroke();
    }

    // Dots
    for (const d of dots) {
      const selected = currentPattern.includes(d.idx);

      // Glow ring
      if (selected) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, DOT_GLOW, 0, Math.PI*2);
        ctx.fillStyle = col + '22';
        ctx.fill();
      }

      // Outer circle
      ctx.beginPath();
      ctx.arc(d.x, d.y, DOT_RADIUS, 0, Math.PI*2);
      ctx.strokeStyle = selected ? col : '#364872';
      ctx.lineWidth   = 2;
      ctx.stroke();

      // Inner fill
      ctx.beginPath();
      ctx.arc(d.x, d.y, selected ? 8 : 5, 0, Math.PI*2);
      ctx.fillStyle = selected ? col : '#364872';
      ctx.fill();
    }
  }

  // ─── Event helpers ───────────────────────────────────────────────
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * (W / rect.width), y: (src.clientY - rect.top) * (H / rect.height) };
  }

  function onDown(e) {
    e.preventDefault();
    clearError();
    isDrawing = true;
    currentPattern = [];
    dots.forEach(d => d.selected = false);
    const pos = getPos(e);
    const d   = getDotAt(pos.x, pos.y);
    if (d && !currentPattern.includes(d.idx)) { d.selected = true; currentPattern.push(d.idx); }
    draw(pos);
  }

  function onMove(e) {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getPos(e);
    const d   = getDotAt(pos.x, pos.y);
    if (d && !currentPattern.includes(d.idx)) { d.selected = true; currentPattern.push(d.idx); }
    draw(pos);
  }

  async function onUp(e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false;
    if (currentPattern.length < MIN_DOTS) {
      showError(`Connect at least ${MIN_DOTS} dots`);
      resetCanvas();
      return;
    }
    await handlePattern([...currentPattern]);
    resetCanvas();
  }

  // ─── Pattern handling ────────────────────────────────────────────
  async function handlePattern(pattern) {
    const hash = await sha256(pattern.join(','));

    if (mode === 'setup-first' || mode === 'change-first') {
      firstPattern = pattern;
      document.getElementById('auth-subtitle').textContent = 'Confirm your pattern';
      document.getElementById('setup-confirm-wrap').style.display = 'block';
      mode = mode === 'setup-first' ? 'setup-confirm' : 'change-confirm';
      draw(null, '#4895ef');
      return;
    }

    if (mode === 'setup-confirm' || mode === 'change-confirm') {
      if (pattern.join(',') === firstPattern.join(',')) {
        localStorage.setItem(STORAGE_KEY, hash);
        showSuccess();
        if (resolveAuth) { resolveAuth({ hash, success: true }); resolveAuth = null; }
      } else {
        firstPattern = [];
        mode = mode === 'setup-confirm' ? 'setup-first' : 'change-first';
        document.getElementById('setup-confirm-wrap').style.display = 'none';
        document.getElementById('auth-subtitle').textContent = "Patterns didn't match. Draw again.";
        showError("Patterns didn't match");
        draw(null, '#e63946');
      }
      return;
    }

    if (mode === 'verify') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) { startSetup(); return; }
      if (hash === stored) {
        showSuccess();
        if (resolveAuth) { resolveAuth({ hash, success: true }); resolveAuth = null; }
      } else {
        showError('Incorrect pattern. Try again.');
        draw(null, '#e63946');
      }
    }
  }

  function resetCanvas() {
    currentPattern = [];
    dots.forEach(d => d.selected = false);
    draw();
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = msg;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { if (el) el.textContent = ''; }, 3000);
  }

  function clearError() {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = '';
    clearTimeout(errorTimer);
  }

  function showSuccess() {
    draw(null, '#2a9d8f');
    setTimeout(() => draw(), 400);
  }

  // ─── Public API ──────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('pattern-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    W = canvas.width; H = canvas.height;
    buildDots();

    canvas.addEventListener('mousedown',  onDown,  { passive: false });
    canvas.addEventListener('mousemove',  onMove,  { passive: false });
    canvas.addEventListener('mouseup',    onUp,    { passive: false });
    canvas.addEventListener('touchstart', onDown,  { passive: false });
    canvas.addEventListener('touchmove',  onMove,  { passive: false });
    canvas.addEventListener('touchend',   onUp,    { passive: false });

    draw();
  }

  function startSetup() {
    mode = 'setup-first';
    const el = document.getElementById('auth-subtitle');
    if (el) el.textContent = 'Create your secret pattern';
    resetCanvas();
  }

  function startChangePattern() {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    mode = 'change-first';
    const el = document.getElementById('auth-subtitle');
    if (el) el.textContent = 'Draw your NEW pattern';
    document.getElementById('setup-confirm-wrap').style.display = 'none';
    resetCanvas();
    return new Promise(res => { resolveAuth = res; });
  }

  function hasPattern() {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  function getStoredHash() {
    return localStorage.getItem(STORAGE_KEY);
  }

  /**
   * Returns a Promise that resolves with { hash, success:true } when auth passes.
   */
  function prompt() {
    return new Promise(res => {
      resolveAuth = res;
      if (!hasPattern()) {
        startSetup();
      } else {
        mode = 'verify';
        const el = document.getElementById('auth-subtitle');
        if (el) el.textContent = 'Draw your pattern to unlock';
        document.getElementById('setup-confirm-wrap').style.display = 'none';
        resetCanvas();
      }
    });
  }

  // Expose encrypt/decrypt for use by sync module (token encryption)
  async function encryptWithHash(plaintext) {
    const hash = getStoredHash();
    if (!hash) throw new Error('No pattern set');
    return encryptData(plaintext, hash);
  }

  async function decryptWithHash(cipher) {
    const hash = getStoredHash();
    if (!hash) throw new Error('No pattern set');
    return decryptData(cipher, hash);
  }

  return { init, prompt, hasPattern, startSetup, startChangePattern, encryptWithHash, decryptWithHash, getStoredHash };
})();
