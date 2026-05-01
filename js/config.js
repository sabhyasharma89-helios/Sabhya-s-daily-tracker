/* ── App Configuration ───────────────────────────────────────────────
   Values are overridden by localStorage when user saves settings.
   ─────────────────────────────────────────────────────────────────── */
const CONFIG = (() => {
  const stored = JSON.parse(localStorage.getItem('tracker_config') || '{}');
  return {
    githubOwner:  stored.githubOwner  || 'sabhyasharma89-helios',
    githubRepo:   stored.githubRepo   || 'sabhya-s-daily-tracker',
    githubBranch: stored.githubBranch || 'main',
    tasksPath:    'data/tasks.json',
    emailStatePath: 'data/email_state.json',
    refreshInterval: 5 * 60 * 1000,   // 5 min auto-refresh
  };
})();

function saveConfig(patch) {
  const current = JSON.parse(localStorage.getItem('tracker_config') || '{}');
  const next = { ...current, ...patch };
  localStorage.setItem('tracker_config', JSON.stringify(next));
  Object.assign(CONFIG, next);
}

function getGhToken() {
  return localStorage.getItem('gh_token') || '';
}

function setGhToken(token) {
  localStorage.setItem('gh_token', token.trim());
}
