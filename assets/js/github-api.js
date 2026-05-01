/**
 * GitHubAPI – read/write tasks.json via GitHub Contents API
 */
const GitHubAPI = (() => {

  const getConfig = () => ({
    repo: localStorage.getItem('gh_repo') || 'sabhyasharma89-helios/sabhya-s-daily-tracker',
    pat:  sessionStorage.getItem('gh_pat_plain') || null
  });

  const headers = (pat) => ({
    'Authorization': `token ${pat}`,
    'Content-Type':  'application/json',
    'Accept':        'application/vnd.github.v3+json'
  });

  /* Fetch tasks.json – no auth required for public repos */
  const fetchTasks = async () => {
    const { repo } = getConfig();
    /* Add cache-busting to get latest committed file */
    const url = `https://raw.githubusercontent.com/${repo}/main/data/tasks.json?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching tasks.json`);
    return res.json();
  };

  /* Write tasks.json back via the Contents API */
  const writeTasks = async (db) => {
    const { repo, pat } = getConfig();
    if (!pat) throw new Error('No GitHub PAT configured. Open Settings to add it.');

    const apiUrl = `https://api.github.com/repos/${repo}/contents/data/tasks.json`;

    /* Get current SHA */
    const metaRes = await fetch(apiUrl, { headers: headers(pat) });
    if (!metaRes.ok) throw new Error(`GitHub API error ${metaRes.status}`);
    const meta = await metaRes.json();

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(db, null, 2))));
    const body = {
      message: `Update tasks [${new Date().toISOString()}]`,
      content,
      sha: meta.sha,
      branch: 'main'
    };

    const writeRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: headers(pat),
      body: JSON.stringify(body)
    });
    if (!writeRes.ok) {
      const err = await writeRes.json().catch(() => ({}));
      throw new Error(err.message || `Write failed ${writeRes.status}`);
    }
    return writeRes.json();
  };

  /* Validate a PAT by calling the /user endpoint */
  const validatePAT = async (pat, repo) => {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    return res.ok;
  };

  return { fetchTasks, writeTasks, validatePAT };
})();
