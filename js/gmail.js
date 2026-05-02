/* ═══════════════════════════════════════════════════════
   GMAIL API INTEGRATION
═══════════════════════════════════════════════════════ */

const Gmail = {
  accessToken: null,
  tokenExpiry: 0,
  CLIENT_ID: null,
  tokenClient: null,

  async init(db) {
    this.db = db;
    this.CLIENT_ID  = await db.getSetting('googleClientId');
    this.accessToken = await db.getSetting('gmailAccessToken');
    this.tokenExpiry = (await db.getSetting('gmailTokenExpiry')) || 0;
    return !!(this.CLIENT_ID && this.accessToken && Date.now() < this.tokenExpiry);
  },

  isTokenValid() {
    return !!(this.accessToken && Date.now() < this.tokenExpiry - 60000);
  },

  async authorize() {
    return new Promise((resolve, reject) => {
      if (!this.CLIENT_ID) {
        reject(new Error('Google Client ID not configured'));
        return;
      }

      if (!window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services not loaded'));
        return;
      }

      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        callback: async (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          this.accessToken = resp.access_token;
          this.tokenExpiry = Date.now() + resp.expires_in * 1000;
          await this.db.setSetting('gmailAccessToken', this.accessToken);
          await this.db.setSetting('gmailTokenExpiry', this.tokenExpiry);
          resolve(true);
        },
      });
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  },

  async reauthorize() {
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) {
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          callback: async (resp) => {
            if (resp.error) { reject(new Error(resp.error)); return; }
            this.accessToken = resp.access_token;
            this.tokenExpiry = Date.now() + resp.expires_in * 1000;
            await this.db.setSetting('gmailAccessToken', this.accessToken);
            await this.db.setSetting('gmailTokenExpiry', this.tokenExpiry);
            resolve(true);
          },
        });
      }
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  },

  async _fetch(url, opts = {}) {
    if (!this.isTokenValid()) {
      try { await this.reauthorize(); }
      catch (e) { throw new Error('Gmail session expired. Please re-authorize in Settings.'); }
    }

    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });

    if (res.status === 401) {
      await this.reauthorize();
      return this._fetch(url, opts);
    }
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
    return res.json();
  },

  // Fetch thread list since a given timestamp (ms)
  async fetchThreadsSince(sinceMs) {
    const afterSec = Math.floor(sinceMs / 1000);
    let threads = [], pageToken = null;

    do {
      const params = new URLSearchParams({ q: `after:${afterSec}`, maxResults: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await this._fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`);
      if (data.threads) threads.push(...data.threads);
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return threads; // [{ id, historyId }]
  },

  // Fetch full thread (all messages)
  async fetchThread(threadId) {
    return this._fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`);
  },

  // Decode base64url encoded body
  _decodeBody(data) {
    if (!data) return '';
    try {
      return decodeURIComponent(escape(atob(data.replace(/-/g, '+').replace(/_/g, '/'))));
    } catch {
      return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    }
  },

  // Extract text from a Gmail message payload
  _extractText(payload) {
    if (!payload) return '';

    if (payload.body?.data) return this._decodeBody(payload.body.data);

    if (payload.parts) {
      // prefer text/plain
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this._decodeBody(part.body.data);
        }
      }
      // fallback to nested parts
      for (const part of payload.parts) {
        const nested = this._extractText(part);
        if (nested) return nested;
      }
    }
    return '';
  },

  _getHeader(headers, name) {
    const h = (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : '';
  },

  // Format a full Gmail thread into a clean object for the processor
  formatThread(thread) {
    const messages = (thread.messages || []).map(msg => {
      const headers = msg.payload?.headers || [];
      const body = this._extractText(msg.payload);
      // Strip quoted text (lines starting with >) to reduce token usage
      const cleanBody = body
        .split('\n')
        .filter(l => !l.trimStart().startsWith('>') && !l.startsWith('On ') )
        .join('\n')
        .trim()
        .substring(0, 1500);

      return {
        from:    this._getHeader(headers, 'From'),
        to:      this._getHeader(headers, 'To'),
        cc:      this._getHeader(headers, 'Cc'),
        date:    this._getHeader(headers, 'Date'),
        subject: this._getHeader(headers, 'Subject'),
        body:    cleanBody,
      };
    });

    return {
      threadId: thread.id,
      subject: messages[0]?.subject || '(no subject)',
      messages,
    };
  },
};
