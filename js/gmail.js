/* ═══════════════════════════════════════
   GMAIL  –  Gmail REST API v1 wrapper
═══════════════════════════════════════ */
const Gmail = (() => {
  const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

  async function _get(path, params = {}) {
    const token = await Auth.getToken();
    if (!token) throw new Error('Not authenticated. Please reconnect Gmail.');
    const qs = new URLSearchParams(params).toString();
    const url = `${BASE}${path}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { Auth.clearToken(); throw new Error('Gmail session expired. Please reconnect.'); }
    if (!res.ok) throw new Error(`Gmail API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  function _decodeBase64(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    try { return decodeURIComponent(escape(atob(s))); } catch { return atob(s) || ''; }
  }

  function _extractBody(payload) {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data)
      return _decodeBase64(payload.body.data);
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      const raw = _decodeBase64(payload.body.data);
      const el = document.createElement('div');
      el.innerHTML = raw;
      return el.textContent || '';
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        const body = _extractBody(part);
        if (body) return body;
      }
    }
    return '';
  }

  function _header(headers, name) {
    const h = (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : '';
  }

  function _parseMessage(msg) {
    const h    = msg.payload?.headers || [];
    return {
      id:        msg.id,
      threadId:  msg.threadId,
      subject:   _header(h, 'Subject')  || '(no subject)',
      from:      _header(h, 'From')     || '',
      to:        _header(h, 'To')       || '',
      date:      _header(h, 'Date')     || '',
      snippet:   msg.snippet            || '',
      body:      _extractBody(msg.payload),
      labels:    msg.labelIds           || []
    };
  }

  async function listMessagesSince(afterTimestamp) {
    const afterSec = Math.floor(afterTimestamp / 1000);
    let messages = [], pageToken = null;
    do {
      const params = { q: `after:${afterSec}`, maxResults: 100 };
      if (pageToken) params.pageToken = pageToken;
      const res = await _get('/messages', params);
      if (res.messages) messages.push(...res.messages);
      pageToken = res.nextPageToken || null;
    } while (pageToken && messages.length < 500);
    return messages; // [{id, threadId}]
  }

  async function getMessage(id) {
    const msg = await _get(`/messages/${id}`, { format: 'full' });
    return _parseMessage(msg);
  }

  async function getThread(threadId) {
    const t = await _get(`/threads/${threadId}`, { format: 'full' });
    return (t.messages || []).map(_parseMessage);
  }

  async function getOrCacheThread(threadId) {
    const cached = await DB.get('emailThreads', threadId);
    const now    = Date.now();
    if (cached && (now - (cached.fetchedAt || 0)) < 10 * 60 * 1000) return cached.messages;
    const messages = await getThread(threadId);
    await DB.put('emailThreads', { threadId, messages, fetchedAt: now, taskIds: cached?.taskIds || [] });
    return messages;
  }

  async function fetchNewEmails(onProgress) {
    const lastCheck = (await DB.getConfig('lastEmailCheck')) || (Date.now() - 30 * 24 * 3600 * 1000);
    const msgs = await listMessagesSince(lastCheck);
    if (!msgs.length) return [];

    const seen = new Set();
    const threads = [];
    for (const m of msgs) {
      if (!seen.has(m.threadId)) { seen.add(m.threadId); threads.push(m.threadId); }
    }

    const results = [];
    for (let i = 0; i < threads.length; i++) {
      if (onProgress) onProgress(i + 1, threads.length);
      try {
        const messages = await getOrCacheThread(threads[i]);
        results.push({ threadId: threads[i], messages });
      } catch (err) {
        console.warn('Thread fetch error:', threads[i], err);
      }
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 300)); // gentle rate limit
    }

    await DB.setConfig('lastEmailCheck', Date.now());
    return results;
  }

  return { listMessagesSince, getMessage, getThread, getOrCacheThread, fetchNewEmails };
})();
