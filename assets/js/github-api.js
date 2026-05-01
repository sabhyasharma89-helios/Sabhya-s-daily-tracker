/**
 * GitHub REST API client
 * Reads and writes data/tasks.json and data/metadata.json in the repo.
 * Also triggers workflow_dispatch for manual syncs.
 */

const GithubAPI = (() => {
  const BASE = 'https://api.github.com';

  function cfg() {
    const c = JSON.parse(localStorage.getItem('tracker_github') || '{}');
    return { owner: c.owner, repo: c.repo, token: c.token, branch: c.branch || 'main' };
  }

  function headers(extra = {}) {
    const { token } = cfg();
    return {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  /** Decode base64 content that may be split across lines */
  function decodeContent(b64) {
    try {
      const clean = b64.replace(/\n/g, '');
      const bin   = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return atob(b64.replace(/\n/g, ''));
    }
  }

  /** Encode a string to base64 (UTF-8 safe) */
  function encodeContent(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }

  /** Fetch a file; returns { content (parsed JSON), sha } */
  async function getFile(path) {
    const { owner, repo, branch } = cfg();
    const url = `${BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return { content: JSON.parse(decodeContent(data.content)), sha: data.sha };
  }

  /** Write / update a file */
  async function putFile(path, obj, sha, message) {
    const { owner, repo, branch } = cfg();
    const url = `${BASE}/repos/${owner}/${repo}/contents/${path}`;
    const body = {
      message: message || `Update ${path}`,
      content: encodeContent(JSON.stringify(obj, null, 2)),
      branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`GitHub write ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Trigger the email-processing workflow manually */
  async function triggerSync(forceFull = false) {
    const { owner, repo, branch } = cfg();
    const url = `${BASE}/repos/${owner}/${repo}/actions/workflows/process-emails.yml/dispatches`;
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ref: branch, inputs: { force_full_sync: forceFull ? 'true' : 'false' } }),
    });
    return res.status === 204;
  }

  /** Verify PAT by fetching repo info */
  async function verifyConfig(owner, repo, token) {
    const res = await fetch(`${BASE}/repos/${owner}/${repo}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) throw new Error('Repository not found or token invalid');
    return res.json();
  }

  return { getFile, putFile, triggerSync, verifyConfig };
})();
