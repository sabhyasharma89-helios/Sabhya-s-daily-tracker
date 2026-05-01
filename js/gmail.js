/* Gmail API integration using Google Identity Services */
const GmailAPI = (() => {
  let accessToken = null;
  let tokenExpiry = 0;
  let tokenClient = null;
  let pendingAuthResolve = null;

  const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';
  const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

  function init(clientId) {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services not loaded'));
        return;
      }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: resp => {
          if (resp.error) {
            if (pendingAuthResolve) { pendingAuthResolve(false); pendingAuthResolve = null; }
            return;
          }
          accessToken = resp.access_token;
          tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
          if (pendingAuthResolve) { pendingAuthResolve(true); pendingAuthResolve = null; }
        }
      });
      resolve();
    });
  }

  function isTokenValid() {
    return accessToken && Date.now() < tokenExpiry;
  }

  function requestAuth(prompt = '') {
    return new Promise(resolve => {
      pendingAuthResolve = resolve;
      tokenClient.requestAccessToken({ prompt });
    });
  }

  async function ensureAuth() {
    if (isTokenValid()) return true;
    // Try silent auth first
    const ok = await requestAuth('');
    if (!ok) {
      // Fall back to consent prompt
      return requestAuth('consent');
    }
    return ok;
  }

  async function apiFetch(url, params = {}) {
    if (!isTokenValid()) {
      const ok = await ensureAuth();
      if (!ok) throw new Error('Authentication required');
    }
    const qs = new URLSearchParams(params).toString();
    const fullUrl = qs ? `${url}?${qs}` : url;
    const resp = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (resp.status === 401) {
      accessToken = null;
      throw new Error('Token expired, please re-authenticate');
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${resp.status}`);
    }
    return resp.json();
  }

  /* Fetch message IDs since a given date (or last 30 days on first run) */
  async function listMessageIds(afterDate, onProgress) {
    const ids = [];
    let pageToken = null;
    const query = afterDate
      ? `after:${Math.floor(new Date(afterDate).getTime() / 1000)}`
      : 'newer_than:30d';

    do {
      const params = { q: query, maxResults: 500 };
      if (pageToken) params.pageToken = pageToken;
      const data = await apiFetch(`${BASE}/messages`, params);
      if (data.messages) {
        ids.push(...data.messages.map(m => m.id));
        if (onProgress) onProgress(ids.length, null);
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return ids;
  }

  function decodeBase64Url(encoded) {
    if (!encoded) return '';
    try {
      const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return '';
    }
  }

  function extractBodyFromPayload(payload) {
    if (!payload) return '';

    // Direct body
    if (payload.body?.data) {
      const decoded = decodeBase64Url(payload.body.data);
      if (payload.mimeType === 'text/html') {
        return decoded.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      }
      return decoded;
    }

    if (payload.parts) {
      // Prefer text/plain
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return decodeBase64Url(part.body.data);
        }
      }
      // Try text/html
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          const html = decodeBase64Url(part.body.data);
          return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
      // Recurse into multipart
      for (const part of payload.parts) {
        if (part.mimeType?.startsWith('multipart/')) {
          const body = extractBodyFromPayload(part);
          if (body) return body;
        }
      }
    }
    return '';
  }

  function parseMessage(msg) {
    const headers = {};
    (msg.payload?.headers || []).forEach(h => {
      headers[h.name.toLowerCase()] = h.value;
    });
    const body = extractBodyFromPayload(msg.payload);
    const dateStr = headers.date;
    return {
      id: msg.id,
      threadId: msg.threadId,
      subject: headers.subject || '(No Subject)',
      from: headers.from || '',
      to: headers.to || '',
      cc: headers.cc || '',
      date: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
      snippet: msg.snippet || '',
      body: body.substring(0, 8000), // cap at 8KB per email
      processed: false
    };
  }

  async function getMessage(id) {
    const msg = await apiFetch(`${BASE}/messages/${id}`, { format: 'full' });
    return parseMessage(msg);
  }

  /* Fetch all messages in a thread (for thread summary) */
  async function getThread(threadId) {
    const data = await apiFetch(`${BASE}/threads/${threadId}`, { format: 'full' });
    return (data.messages || []).map(parseMessage);
  }

  /* Main fetch: returns parsed email objects, oldest first */
  async function fetchEmails(afterDate, isFirstRun, onProgress) {
    const ids = await listMessageIds(isFirstRun ? null : afterDate, onProgress);
    if (!ids.length) return [];

    // Fetch in parallel batches of 10
    const results = [];
    const BATCH = 10;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const msgs = await Promise.all(batch.map(id => getMessage(id).catch(() => null)));
      results.push(...msgs.filter(Boolean));
      if (onProgress) onProgress(i + batch.length, ids.length);
      if (i + BATCH < ids.length) await new Promise(r => setTimeout(r, 80));
    }

    // Sort oldest first so tasks are created in chronological order
    return results.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  return { init, ensureAuth, fetchEmails, getThread, isTokenValid };
})();
