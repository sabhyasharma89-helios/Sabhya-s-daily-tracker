/* GitHub API wrapper for persisting user updates */

const GitHubAPI = (() => {
  const PAT_KEY = 'sdt_github_pat';
  const REPO_KEY = 'sdt_github_repo';
  const BRANCH_KEY = 'sdt_github_branch';

  function getConfig() {
    return {
      pat: localStorage.getItem(PAT_KEY),
      repo: localStorage.getItem(REPO_KEY),
      branch: localStorage.getItem(BRANCH_KEY) || 'main',
    };
  }

  function saveConfig(pat, repo, branch) {
    if (pat) localStorage.setItem(PAT_KEY, pat);
    if (repo) localStorage.setItem(REPO_KEY, repo);
    if (branch) localStorage.setItem(BRANCH_KEY, branch);
  }

  function isConfigured() {
    const { pat, repo } = getConfig();
    return !!(pat && repo);
  }

  async function getFileSha(path) {
    const { pat, repo, branch } = getConfig();
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    return data.sha;
  }

  async function pushFile(path, content, message) {
    const { pat, repo, branch } = getConfig();
    const sha = await getFileSha(path);
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
    const body = { message, content: encoded, branch };
    if (sha) body.sha = sha;

    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${pat}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Push failed');
    }
    return true;
  }

  async function pushUserUpdates(updates) {
    if (!isConfigured()) {
      console.warn('GitHub not configured — saving locally only');
      return false;
    }
    try {
      await pushFile('data/user_updates.json', updates, 'chore: user update [webapp]');
      return true;
    } catch (e) {
      console.error('GitHub push failed:', e);
      return false;
    }
  }

  async function fetchTasksJson() {
    const { repo, branch } = getConfig();
    if (!repo) return null;
    try {
      const url = `https://raw.githubusercontent.com/${repo}/${branch}/data/tasks.json?t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  return { getConfig, saveConfig, isConfigured, pushUserUpdates, fetchTasksJson };
})();
