/* ═══════════════════════════════════════
   AUTH  –  Pattern Lock  +  Google OAuth
═══════════════════════════════════════ */
const Auth = (() => {

  /* ── Pattern Lock ───────────────────────────────── */
  const GRID = 3;

  function _buildGrid(dotsEl) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < GRID * GRID; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'pattern-dot';
      const inner = document.createElement('div');
      inner.className = 'pattern-dot-inner';
      inner.dataset.idx = i;
      wrap.appendChild(inner);
      dotsEl.appendChild(wrap);
    }
  }

  function _dotCenter(dotsEl, idx, canvasRect) {
    const inner = dotsEl.querySelectorAll('.pattern-dot-inner')[idx];
    if (!inner) return null;
    const r = inner.getBoundingClientRect();
    return {
      x: r.left + r.width  / 2 - canvasRect.left,
      y: r.top  + r.height / 2 - canvasRect.top
    };
  }

  function createPatternLock(canvasEl, dotsEl, opts = {}) {
    _buildGrid(dotsEl);
    const ctx   = canvasEl.getContext('2d');
    let pattern = [], drawing = false, curPos = null, confirmed = false;
    const selectionDots = new Set();

    function _resize() {
      const rect = canvasEl.parentElement.getBoundingClientRect();
      canvasEl.width  = rect.width;
      canvasEl.height = rect.height;
      _draw();
    }

    function _draw() {
      const rect = canvasEl.getBoundingClientRect();
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      if (pattern.length < 1) return;

      ctx.strokeStyle = confirmed
        ? 'rgba(34,197,94,0.7)'
        : selectionDots.size > 0 && [...selectionDots].some(i => i === -1)
          ? 'rgba(239,68,68,0.7)'
          : 'rgba(79,70,229,0.7)';
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';

      ctx.beginPath();
      const first = _dotCenter(dotsEl, pattern[0], rect);
      if (!first) return;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pattern.length; i++) {
        const p = _dotCenter(dotsEl, pattern[i], rect);
        if (p) ctx.lineTo(p.x, p.y);
      }
      if (drawing && curPos) ctx.lineTo(curPos.x, curPos.y);
      ctx.stroke();
    }

    function _pos(e) {
      const rect = canvasEl.getBoundingClientRect();
      const src  = e.touches ? e.touches[0] : e;
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function _nearest(pos) {
      const rect = canvasEl.getBoundingClientRect();
      for (let i = 0; i < GRID * GRID; i++) {
        const c = _dotCenter(dotsEl, i, rect);
        if (!c) continue;
        const dist = Math.hypot(c.x - pos.x, c.y - pos.y);
        if (dist < 28 && !pattern.includes(i)) return i;
      }
      return null;
    }

    function _start(e) {
      e.preventDefault();
      drawing = true; pattern = []; confirmed = false;
      dotsEl.querySelectorAll('.pattern-dot-inner').forEach(d => {
        d.classList.remove('selected','error');
      });
      selectionDots.clear();
      const p = _pos(e);
      const idx = _nearest(p);
      if (idx !== null) {
        pattern.push(idx);
        selectionDots.add(idx);
        dotsEl.querySelectorAll('.pattern-dot-inner')[idx].classList.add('selected');
      }
      curPos = p; _draw();
    }

    function _move(e) {
      e.preventDefault();
      if (!drawing) return;
      curPos = _pos(e);
      const idx = _nearest(curPos);
      if (idx !== null) {
        pattern.push(idx);
        selectionDots.add(idx);
        dotsEl.querySelectorAll('.pattern-dot-inner')[idx].classList.add('selected');
      }
      _draw();
    }

    function _end(e) {
      e.preventDefault();
      if (!drawing) return;
      drawing = false; curPos = null;
      if (pattern.length >= 4) {
        if (opts.onPattern) opts.onPattern([...pattern]);
      } else {
        _error();
        if (opts.onTooShort) opts.onTooShort();
      }
      _draw();
    }

    function _error() {
      dotsEl.querySelectorAll('.pattern-dot-inner.selected').forEach(d => {
        d.classList.remove('selected');
        d.classList.add('error');
      });
      setTimeout(reset, 900);
    }

    function reset() {
      pattern = []; drawing = false; curPos = null; confirmed = false;
      dotsEl.querySelectorAll('.pattern-dot-inner').forEach(d => {
        d.classList.remove('selected','error');
      });
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }

    function setConfirmed(ok) {
      confirmed = ok;
      if (!ok) _error();
      _draw();
    }

    canvasEl.addEventListener('mousedown',  _start, { passive: false });
    canvasEl.addEventListener('mousemove',  _move,  { passive: false });
    canvasEl.addEventListener('mouseup',    _end,   { passive: false });
    canvasEl.addEventListener('touchstart', _start, { passive: false });
    canvasEl.addEventListener('touchmove',  _move,  { passive: false });
    canvasEl.addEventListener('touchend',   _end,   { passive: false });

    const ro = new ResizeObserver(_resize);
    ro.observe(canvasEl.parentElement);
    _resize();

    return { reset, setConfirmed, getPattern: () => [...pattern] };
  }

  async function hashPattern(arr) {
    const data = arr.join('-');
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function savePattern(arr) {
    const h = await hashPattern(arr);
    await DB.setConfig('patternHash', h);
  }

  async function checkPattern(arr) {
    const stored = await DB.getConfig('patternHash');
    if (!stored) return false;
    const h = await hashPattern(arr);
    return h === stored;
  }

  async function hasPattern() {
    const h = await DB.getConfig('patternHash');
    return !!h;
  }

  /* ── Google OAuth ───────────────────────────────── */
  let _accessToken   = null;
  let _tokenExpiry   = 0;
  const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email';

  async function googleAuth() {
    const clientId = await DB.getConfig('googleClientId');
    if (!clientId) throw new Error('Google Client ID not configured.');

    const redirectUri = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '/oauth-callback.html')}`;
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'token',
      scope:         SCOPES,
      prompt:        'select_account'
    });

    return new Promise((resolve, reject) => {
      const popup = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'google_auth', 'width=520,height=620');
      if (!popup) { reject(new Error('Popup blocked. Allow popups for this page.')); return; }

      const timer = setInterval(() => {
        if (popup.closed) { clearInterval(timer); window.removeEventListener('message', handler); reject(new Error('Auth cancelled.')); }
      }, 500);

      function handler(e) {
        if (e.origin !== location.origin) return;
        if (!e.data || e.data.type !== 'oauth_callback') return;
        clearInterval(timer);
        window.removeEventListener('message', handler);
        if (e.data.error) { reject(new Error(e.data.error)); return; }
        if (e.data.token) {
          _accessToken = e.data.token;
          _tokenExpiry = Date.now() + (parseInt(e.data.expiresIn, 10) - 60) * 1000;
          DB.setConfig('googleToken',       _accessToken);
          DB.setConfig('googleTokenExpiry', _tokenExpiry);
          resolve(_accessToken);
        } else {
          reject(new Error('No token received.'));
        }
      }
      window.addEventListener('message', handler);
    });
  }

  async function getToken() {
    if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;
    const stored  = await DB.getConfig('googleToken');
    const expiry  = await DB.getConfig('googleTokenExpiry');
    if (stored && expiry && Date.now() < expiry) {
      _accessToken  = stored;
      _tokenExpiry  = expiry;
      return _accessToken;
    }
    return null;
  }

  async function getGmailUserInfo() {
    const token = await getToken();
    if (!token) return null;
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }

  function clearToken() {
    _accessToken = null;
    _tokenExpiry = 0;
    DB.setConfig('googleToken', null);
    DB.setConfig('googleTokenExpiry', null);
  }

  return { createPatternLock, hashPattern, savePattern, checkPattern, hasPattern, googleAuth, getToken, getGmailUserInfo, clearToken };
})();
