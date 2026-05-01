/**
 * Pattern Lock Authentication
 * 3×3 grid, touch + mouse, SHA-256 hashing, localStorage persistence.
 */
(function () {
  const STORAGE_KEY = 'tracker_pattern_hash';
  const MIN_DOTS = 4;

  let isSettingPattern = false;
  let confirmStep = false;
  let firstPatternHash = null;

  let activePattern = [];   // indices 0-8
  let touching = false;

  const canvas  = document.getElementById('patternCanvas');
  const ctx     = canvas.getContext('2d');
  const dotsEl  = document.getElementById('patternDots');
  const msgEl   = document.getElementById('patternMessage');
  const statusEl = document.getElementById('patternStatus');
  const hintEl  = document.getElementById('patternSetupHint');
  const clearBtn = document.getElementById('clearPatternBtn');

  // ─── Dot centres (relative to canvas bounds) ───
  const DOT_POSITIONS = [];   // [{x, y}] for each of 9 dots

  function initDots () {
    dotsEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'dot-wrap';
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.id = `dot-${i}`;
      wrap.appendChild(dot);
      dotsEl.appendChild(wrap);
    }
    computeDotCentres();
  }

  function computeDotCentres () {
    DOT_POSITIONS.length = 0;
    const rect = dotsEl.getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const el = document.getElementById(`dot-${i}`);
      const dr = el.getBoundingClientRect();
      DOT_POSITIONS.push({
        x: dr.left + dr.width  / 2 - rect.left,
        y: dr.top  + dr.height / 2 - rect.top
      });
    }
    canvas.width  = dotsEl.offsetWidth;
    canvas.height = dotsEl.offsetHeight;
  }

  // ─── SHA-256 helper ───
  async function sha256 (str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ─── Drawing ───
  function redrawCanvas (cursorX, cursorY) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (activePattern.length === 0) return;

    ctx.strokeStyle = 'rgba(79,124,255,0.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(79,124,255,0.4)';
    ctx.shadowBlur = 6;

    ctx.beginPath();
    const first = DOT_POSITIONS[activePattern[0]];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < activePattern.length; i++) {
      const p = DOT_POSITIONS[activePattern[i]];
      ctx.lineTo(p.x, p.y);
    }
    if (cursorX !== undefined && touching) {
      ctx.lineTo(cursorX, cursorY);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function getClientPos (e) {
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    const rect = dotsEl.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  function dotIndexFromPos (x, y) {
    const HIT = 32;
    for (let i = 0; i < 9; i++) {
      const d = DOT_POSITIONS[i];
      if (Math.abs(d.x - x) < HIT && Math.abs(d.y - y) < HIT) return i;
    }
    return -1;
  }

  function activateDot (idx) {
    if (idx < 0 || activePattern.includes(idx)) return;
    activePattern.push(idx);
    const el = document.getElementById(`dot-${idx}`);
    el.classList.add('active');
  }

  function clearPattern () {
    activePattern = [];
    for (let i = 0; i < 9; i++) {
      const el = document.getElementById(`dot-${i}`);
      el.classList.remove('active', 'error');
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    statusEl.textContent = '';
  }

  function setErrorState () {
    for (let i = 0; i < 9; i++) {
      const el = document.getElementById(`dot-${i}`);
      if (el.classList.contains('active')) {
        el.classList.remove('active');
        el.classList.add('error');
      }
    }
    ctx.strokeStyle = 'rgba(255,77,77,0.6)';
    ctx.lineWidth = 3;
    if (activePattern.length > 0) {
      ctx.beginPath();
      const first = DOT_POSITIONS[activePattern[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < activePattern.length; i++) {
        const p = DOT_POSITIONS[activePattern[i]];
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    setTimeout(() => clearPattern(), 800);
  }

  // ─── Touch / Mouse handlers ───
  function onStart (e) {
    e.preventDefault();
    touching = true;
    clearPattern();
    const pos = getClientPos(e);
    activateDot(dotIndexFromPos(pos.x, pos.y));
    redrawCanvas(pos.x, pos.y);
  }

  function onMove (e) {
    if (!touching) return;
    e.preventDefault();
    const pos = getClientPos(e);
    activateDot(dotIndexFromPos(pos.x, pos.y));
    redrawCanvas(pos.x, pos.y);
  }

  function onEnd (e) {
    if (!touching) return;
    touching = false;
    e.preventDefault();
    redrawCanvas();
    handlePatternComplete();
  }

  async function handlePatternComplete () {
    if (activePattern.length < MIN_DOTS) {
      statusEl.textContent = `Please connect at least ${MIN_DOTS} dots.`;
      setTimeout(() => clearPattern(), 900);
      return;
    }

    const hash = await sha256(activePattern.join('-'));

    if (isSettingPattern) {
      if (!confirmStep) {
        // First draw — store temporarily
        firstPatternHash = hash;
        confirmStep = true;
        msgEl.textContent = 'Draw pattern again to confirm';
        statusEl.textContent = '';
        clearBtn.style.display = 'inline-block';
        setTimeout(() => clearPattern(), 600);
      } else {
        // Second draw — verify match
        if (hash === firstPatternHash) {
          localStorage.setItem(STORAGE_KEY, hash);
          isSettingPattern = false;
          confirmStep = false;
          firstPatternHash = null;
          showToast('Pattern saved! Unlocking…', 'success');
          setTimeout(() => unlockDashboard(), 800);
        } else {
          statusEl.textContent = 'Patterns do not match. Try again.';
          setErrorState();
          confirmStep = false;
          firstPatternHash = null;
          msgEl.textContent = 'Draw your new pattern';
        }
      }
      return;
    }

    // Verification mode
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      // Shouldn't happen, but handle gracefully
      enterSetupMode();
      return;
    }

    if (hash === stored) {
      statusEl.textContent = '✓ Unlocked';
      setTimeout(() => unlockDashboard(), 300);
    } else {
      statusEl.style.color = 'var(--urgent)';
      statusEl.textContent = 'Incorrect pattern. Try again.';
      setErrorState();
      setTimeout(() => { statusEl.style.color = ''; statusEl.textContent = ''; }, 1200);
    }
  }

  // ─── Public API ───
  window.patternAuth = {
    init () {
      initDots();
      window.addEventListener('resize', () => {
        computeDotCentres();
        redrawCanvas();
      });

      const wrapper = dotsEl.parentElement;
      wrapper.addEventListener('mousedown',  onStart, { passive: false });
      wrapper.addEventListener('mousemove',  onMove,  { passive: false });
      wrapper.addEventListener('mouseup',    onEnd,   { passive: false });
      wrapper.addEventListener('touchstart', onStart, { passive: false });
      wrapper.addEventListener('touchmove',  onMove,  { passive: false });
      wrapper.addEventListener('touchend',   onEnd,   { passive: false });

      clearBtn.addEventListener('click', () => {
        clearPattern();
        confirmStep = false;
        firstPatternHash = null;
        msgEl.textContent = isSettingPattern ? 'Draw your new pattern' : 'Draw your unlock pattern';
      });

      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        enterSetupMode();
      } else {
        msgEl.textContent = 'Draw your unlock pattern';
        hintEl.textContent = '';
      }
    },

    initiateChange () {
      // Called from settings
      const screen = document.getElementById('patternScreen');
      screen.classList.remove('hidden');
      document.getElementById('dashboard').classList.add('hidden');
      enterSetupMode();
    }
  };

  function enterSetupMode () {
    isSettingPattern = true;
    confirmStep = false;
    firstPatternHash = null;
    msgEl.textContent = 'Set a new unlock pattern';
    hintEl.textContent = `Connect at least ${MIN_DOTS} dots to create your pattern.`;
    clearBtn.style.display = 'none';
    clearPattern();
  }

  function unlockDashboard () {
    document.getElementById('patternScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    if (window.appInit) window.appInit();
  }

  // Make helpers accessible
  window.initiatePatternChange = () => patternAuth.initiateChange();

  // ─── Boot ───
  document.addEventListener('DOMContentLoaded', () => patternAuth.init());
})();
