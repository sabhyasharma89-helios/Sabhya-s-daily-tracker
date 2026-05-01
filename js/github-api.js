/**
 * GitHub API wrapper — persists user overrides to user-overrides.json in the repo.
 * Uses a Personal Access Token (contents:write scope) stored in localStorage.
 */

const GithubAPI = (() => {
  const TOKEN_KEY = 'sdt_gh_token';
  const REPO_KEY = 'sdt_gh_repo';
  const FILE_PATH = 'data/user-overrides.json';

  const DEFAULT_REPO = 'sabhyasharma89-helios/sabhya-s-daily-tracker';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getRepo()  { return localStorage.getItem(REPO_KEY) || DEFAULT_REPO; }

  function setToken(token) { localStorage.setItem(TOKEN_KEY, token.trim()); }
  function setRepo(repo)   { localStorage.setItem(REPO_KEY, repo.trim()); }

  function hasToken() { return !!getToken(); }

  async function apiFetch(path, options = {}) {
    const token = getToken();
    const url = `https://api.github.com/repos/${getRepo()}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`GitHub API ${res.status}: ${body.message || res.statusText}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // Load user-overrides.json from the repo
  async function loadOverrides() {
    try {
      const data = await apiFetch(`/contents/${FILE_PATH}`);
      const content = atob(data.content.replace(/\n/g, ''));
      return { data: JSON.parse(content), sha: data.sha };
    } catch (err) {
      if (err.message.includes('404')) {
        return { data: defaultOverrides(), sha: null };
      }
      throw err;
    }
  }

  // Save user-overrides.json back to the repo
  async function saveOverrides(overridesObj, sha) {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(overridesObj, null, 2))));
    const body = {
      message: 'chore: update user task overrides [skip ci]',
      content,
      ...(sha ? { sha } : {}),
    };
    const result = await apiFetch(`/contents/${FILE_PATH}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return result.content.sha;
  }

  function defaultOverrides() {
    return {
      version: '1.0',
      lastUpdated: null,
      overrides: {},
      manualTasks: [],
      clientOrder: [],
      employees: [],
    };
  }

  return {
    hasToken,
    getToken,
    setToken,
    getRepo,
    setRepo,
    loadOverrides,
    saveOverrides,
    defaultOverrides,
  };
})();
