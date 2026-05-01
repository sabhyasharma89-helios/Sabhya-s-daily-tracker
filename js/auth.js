/* Pattern Lock Authentication */

const PatternAuth = (() => {
  const STORAGE_KEY = 'sdt_pattern_hash';
  const DOTS = 9;
  const COLS = 3;
  const MIN_DOTS = 4;

  let canvas, ctx, dots = [], path = [], drawing = false, confirmed = false;
  let mode = 'unlock'; // 'setup' | 'confirm' | 'unlock'
  let firstPattern = null;
  let onSuccess = null;

  function hashPattern(seq) {
    const str = seq.join('-');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36) + str.length;
  }

  async function sha256(str) {
    if (window.crypto && window.crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return hashPattern(str.split('-').map(Number));
  }

  function getDotCenters(size) {
    const pad = size * 0.18;
    const step = (size - pad * 2) / (COLS - 1);
    const centers = [];
    for (let r = 0; r < COLS; r++) {
      for (let c = 0; c < COLS; c++) {
        centers.push({ x: pad + c * step, y: pad + r * step, idx: r * COLS + c });
      }
    }
    return centers;
  }

  function resize() {
    const size = Math.min(canvas.parentElement.offsetWidth - 40, 280);
    canvas.width = size;
    canvas.height = size;
    dots = getDotCenters(size);
    draw();
  }

  function draw(mx, my) {
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);

    const R = size * 0.07;
    const r = size * 0.025;

    // Draw lines between selected dots
    if (path.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#6366f188';
      ctx.lineWidth = size * 0.018;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      path.forEach((idx, i) => {
        const d = dots[idx];
        i === 0 ? ctx.moveTo(d.x, d.y) : ctx.lineTo(d.x, d.y);
      });
      if (drawing && mx !== undefined) ctx.lineTo(mx, my);
      ctx.stroke();
    }

    // Draw dots
    dots.forEach(d => {
      const selected = path.includes(d.idx);
      ctx.beginPath();
      ctx.arc(d.x, d.y, R, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#6366f122' : '#ffffff08';
      ctx.fill();
      ctx.strokeStyle = selected ? '#6366f1' : '#ffffff30';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#6366f1' : '#ffffff60';
      ctx.fill();
    });
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function nearestDot(x, y) {
    const threshold = canvas.width * 0.14;
    let best = null, bestDist = Infinity;
    dots.forEach(d => {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    });
    return best;
  }

  function onStart(e) {
    e.preventDefault();
    drawing = true;
    path = [];
    const { x, y } = getPos(e);
    const d = nearestDot(x, y);
    if (d) path.push(d.idx);
    draw(x, y);
  }

  function onMove(e) {
    e.preventDefault();
    if (!drawing) return;
    const { x, y } = getPos(e);
    const d = nearestDot(x, y);
    if (d && !path.includes(d.idx)) path.push(d.idx);
    draw(x, y);
  }

  async function onEnd(e) {
    e.preventDefault();
    if (!drawing) return;
    drawing = false;
    draw();
    if (path.length < MIN_DOTS) {
      showError(`Connect at least ${MIN_DOTS} dots`);
      setTimeout(() => { path = []; draw(); clearError(); }, 1200);
      return;
    }
    await handlePattern([...path]);
    path = [];
  }

  function showError(msg) {
    const el = document.getElementById('pattern-message');
    if (el) { el.textContent = msg; el.classList.add('error'); }
    flashRed();
  }

  function clearError() {
    const el = document.getElementById('pattern-message');
    if (el) { el.classList.remove('error'); setMessage(); }
  }

  function flashRed() {
    canvas.style.transition = 'box-shadow 0.2s';
    canvas.style.boxShadow = '0 0 0 3px #ef4444';
    setTimeout(() => { canvas.style.boxShadow = ''; }, 700);
  }

  function setMessage() {
    const el = document.getElementById('pattern-message');
    if (!el) return;
    if (mode === 'setup') el.textContent = 'Draw a new pattern (min 4 dots)';
    else if (mode === 'confirm') el.textContent = 'Draw the pattern again to confirm';
    else el.textContent = 'Draw your pattern to unlock';
  }

  async function handlePattern(seq) {
    const hash = await sha256(seq.join('-'));

    if (mode === 'setup') {
      firstPattern = hash;
      mode = 'confirm';
      setMessage();
    } else if (mode === 'confirm') {
      if (hash === firstPattern) {
        localStorage.setItem(STORAGE_KEY, hash);
        mode = 'unlock';
        unlock();
      } else {
        firstPattern = null;
        mode = 'setup';
        showError('Patterns did not match. Try again.');
        setTimeout(() => { clearError(); draw(); }, 1500);
      }
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (hash === stored) {
        unlock();
      } else {
        showError('Wrong pattern. Try again.');
        setTimeout(() => { clearError(); draw(); }, 1200);
      }
    }
  }

  function unlock() {
    const overlay = document.getElementById('pattern-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.transform = 'scale(1.05)';
      setTimeout(() => {
        overlay.style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        if (onSuccess) onSuccess();
      }, 350);
    }
  }

  function init(successCallback) {
    onSuccess = successCallback;
    canvas = document.getElementById('pattern-canvas');
    ctx = canvas.getContext('2d');

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });

    window.addEventListener('resize', resize);
    resize();

    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      mode = 'setup';
    } else {
      mode = 'unlock';
      const resetBtn = document.getElementById('pattern-reset');
      if (resetBtn) resetBtn.style.display = 'inline-block';
    }
    setMessage();
    draw();
  }

  function resetPattern() {
    localStorage.removeItem(STORAGE_KEY);
    firstPattern = null;
    mode = 'setup';
    path = [];
    const resetBtn = document.getElementById('pattern-reset');
    if (resetBtn) resetBtn.style.display = 'none';
    setMessage();
    draw();
  }

  return { init, resetPattern };
})();
