// Pattern Lock Authentication
const AuthManager = (() => {
  const PATTERN_KEY = 'tt_pattern_hash';
  const ATTEMPTS_KEY = 'tt_attempts';
  const LOCKOUT_KEY = 'tt_lockout';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 5 * 60 * 1000;

  let canvas, ctx, dots, pattern, isDrawing, currentPos, currentColor;
  let onComplete = null;
  let mode = 'verify'; // 'verify' | 'setup-first' | 'setup-confirm'
  let firstPattern = null;

  function init(canvasId, callback) {
    canvas = document.getElementById(canvasId);
    ctx = canvas.getContext('2d');
    onComplete = callback;
    dots = calcDots();
    pattern = [];
    isDrawing = false;
    currentPos = null;
    currentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a90e2';

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchend',   e => { e.preventDefault(); onEnd(); }, { passive: false });

    render();
  }

  function calcDots() {
    const size = canvas.width;
    const pad = 60;
    const gap = (size - 2 * pad) / 2;
    const result = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        result.push({ x: pad + c * gap, y: pad + r * gap, idx: r * 3 + c, active: false });
      }
    }
    return result;
  }

  function relPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function nearestDot(pos) {
    for (const d of dots) {
      if (Math.hypot(d.x - pos.x, d.y - pos.y) < 32) return d;
    }
    return null;
  }

  function onStart(e) {
    if (isLocked()) return;
    reset(false);
    isDrawing = true;
    const pos = relPos(e);
    const dot = nearestDot(pos);
    if (dot) { dot.active = true; pattern.push(dot.idx); }
    currentPos = pos;
    render();
  }

  function onMove(e) {
    if (!isDrawing) return;
    currentPos = relPos(e);
    const dot = nearestDot(currentPos);
    if (dot && !pattern.includes(dot.idx)) {
      dot.active = true;
      pattern.push(dot.idx);
    }
    render();
  }

  function onEnd() {
    if (!isDrawing) return;
    isDrawing = false;
    currentPos = null;
    if (pattern.length >= 4) {
      onComplete && onComplete(pattern.slice());
    } else if (pattern.length > 0) {
      showError('Too short — connect at least 4 dots');
    }
    render();
  }

  function render(color) {
    const c = color || currentColor;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (pattern.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.55;
      const first = dots[pattern[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pattern.length; i++) ctx.lineTo(dots[pattern[i]].x, dots[pattern[i]].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (isDrawing && currentPos && pattern.length > 0) {
      const last = dots[pattern[pattern.length - 1]];
      ctx.beginPath();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3;
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    dots.forEach(d => {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 17, 0, Math.PI * 2);
      ctx.strokeStyle = d.active ? c : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(d.x, d.y, d.active ? 11 : 4, 0, Math.PI * 2);
      ctx.fillStyle = d.active ? c : 'rgba(255,255,255,0.25)';
      ctx.fill();
    });
  }

  function showError(msg, canvasId) {
    const errEl = (canvasId === 'setup-canvas')
      ? document.getElementById('setup-pattern-msg')
      : document.getElementById('auth-error');
    if (errEl) { errEl.textContent = msg; errEl.style.color = '#e74c3c'; }
    render('#e74c3c');
    setTimeout(() => reset(true), 1500);
  }

  function showSuccess(canvasId) {
    render('#27ae60');
    setTimeout(() => reset(true), 500);
  }

  function reset(clearMsg) {
    pattern = [];
    isDrawing = false;
    currentPos = null;
    if (dots) dots.forEach(d => d.active = false);
    if (clearMsg) {
      const e = document.getElementById('auth-error');
      if (e) e.textContent = '';
    }
    render();
  }

  async function hashPattern(p) {
    const str = p.join(',');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function isLocked() {
    const lockout = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0');
    if (Date.now() < lockout) {
      const secs = Math.ceil((lockout - Date.now()) / 1000);
      document.getElementById('auth-error').textContent = `Too many attempts. Wait ${secs}s`;
      return true;
    }
    return false;
  }

  function isPatternSet() {
    return !!localStorage.getItem(PATTERN_KEY);
  }

  async function verifyPattern(p) {
    if (isLocked()) return false;
    const hash = await hashPattern(p);
    const stored = localStorage.getItem(PATTERN_KEY);
    if (hash === stored) {
      localStorage.removeItem(ATTEMPTS_KEY);
      localStorage.removeItem(LOCKOUT_KEY);
      return true;
    }
    const attempts = parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0') + 1;
    localStorage.setItem(ATTEMPTS_KEY, attempts);
    if (attempts >= MAX_ATTEMPTS) {
      localStorage.setItem(LOCKOUT_KEY, Date.now() + LOCKOUT_MS);
      localStorage.removeItem(ATTEMPTS_KEY);
    }
    return false;
  }

  async function storePattern(p) {
    const hash = await hashPattern(p);
    localStorage.setItem(PATTERN_KEY, hash);
  }

  function clearPattern() {
    localStorage.removeItem(PATTERN_KEY);
  }

  return { init, reset, showError, showSuccess, hashPattern, isPatternSet, verifyPattern, storePattern, clearPattern };
})();

// Setup flow manager
const SetupManager = (() => {
  let patternCanvas, firstPattern;

  function init() {
    patternCanvas = document.getElementById('setup-canvas');
    AuthManager.init('setup-canvas', onPatternDrawn);
  }

  function onPatternDrawn(p) {
    const msg = document.getElementById('setup-pattern-msg');
    if (!firstPattern) {
      firstPattern = p;
      msg.textContent = 'Draw the same pattern again to confirm';
      msg.style.color = '#4a90e2';
      AuthManager.reset(false);
      const btn = document.getElementById('setup-next-btn');
      if (btn) btn.disabled = false;
    } else {
      if (p.join(',') === firstPattern.join(',')) {
        msg.textContent = 'Pattern confirmed!';
        msg.style.color = '#27ae60';
        AuthManager.showSuccess('setup-canvas');
        document.getElementById('setup-next-btn').disabled = false;
      } else {
        firstPattern = null;
        msg.textContent = 'Patterns did not match — try again';
        msg.style.color = '#e74c3c';
        AuthManager.showError('Patterns did not match', 'setup-canvas');
        document.getElementById('setup-next-btn').disabled = true;
      }
    }
  }

  function clearPattern() {
    firstPattern = null;
    const msg = document.getElementById('setup-pattern-msg');
    msg.textContent = 'Draw your pattern';
    msg.style.color = '';
    AuthManager.reset(true);
    document.getElementById('setup-next-btn').disabled = true;
  }

  async function confirmPattern() {
    if (!firstPattern) {
      document.getElementById('setup-pattern-msg').textContent = 'Please draw and confirm your pattern';
      return;
    }
    await AuthManager.storePattern(firstPattern);
    goToStep(2);
  }

  function goToStep(n) {
    document.querySelectorAll('.setup-step').forEach((el, i) => {
      el.classList.toggle('active', i + 1 === n);
    });
    document.querySelectorAll('.step-dot').forEach((el, i) => {
      el.classList.toggle('active', i + 1 === n);
    });
    if (n === 2) {
      const cfg = loadConfig();
      if (cfg.githubPat) document.getElementById('setup-pat').value = cfg.githubPat;
    }
  }

  function loadConfig() {
    try { return JSON.parse(localStorage.getItem('tt_config') || '{}'); } catch { return {}; }
  }

  function saveConfig() {
    const pat = document.getElementById('setup-pat').value.trim();
    const owner = document.getElementById('setup-owner').value.trim();
    const repo = document.getElementById('setup-repo').value.trim();
    const branch = document.getElementById('setup-branch').value.trim() || 'main';

    if (!owner || !repo) {
      alert('Please enter repository owner and name');
      return;
    }

    const cfg = { githubPat: pat, repoOwner: owner, repoName: repo, repoBranch: branch };
    localStorage.setItem('tt_config', JSON.stringify(cfg));
    localStorage.setItem('tt_setup_done', '1');

    showScreen('dashboard');
    App.init();
  }

  return { init, clearPattern, confirmPattern, goToStep, saveConfig };
})();

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id + '-screen') || document.getElementById(id);
  if (el) el.classList.add('active');
}

// Boot sequence
(async function boot() {
  const setupDone = localStorage.getItem('tt_setup_done');
  const hasPattern = AuthManager.isPatternSet();

  if (!setupDone || !hasPattern) {
    showScreen('setup');
    SetupManager.init();
    return;
  }

  // Show auth screen
  showScreen('auth');
  document.getElementById('auth-instruction').textContent = 'Draw your pattern to unlock';
  AuthManager.init('pattern-canvas', async (p) => {
    const ok = await AuthManager.verifyPattern(p);
    if (ok) {
      AuthManager.showSuccess('pattern-canvas');
      setTimeout(() => {
        showScreen('dashboard');
        App.init();
      }, 400);
    } else {
      const lockout = parseInt(localStorage.getItem('tt_lockout') || '0');
      if (Date.now() < lockout) {
        const secs = Math.ceil((lockout - Date.now()) / 1000);
        AuthManager.showError(`Wrong pattern. Locked for ${secs}s`);
      } else {
        const att = parseInt(localStorage.getItem('tt_attempts') || '0');
        AuthManager.showError(`Wrong pattern. ${MAX_ATTEMPTS - att} attempts left`);
      }
    }
  });
})();
