/* ============================================================
   App Configuration — update REPO_OWNER / REPO_NAME if you
   ever fork or rename the repository.
   ============================================================ */
const CONFIG = Object.freeze({
  REPO_OWNER:  "sabhyasharma89-helios",
  REPO_NAME:   "sabhya-s-daily-tracker",
  BRANCH:      "main",
  DATA_PATH:   "data/tasks.json",

  /* How often (ms) the UI re-fetches tasks.json from GitHub */
  REFRESH_MS:  5 * 60 * 1000,   // 5 minutes

  /* localStorage keys */
  LS_PATTERN_HASH:  "sdt_pattern_hash",
  LS_PATTERN_SET:   "sdt_pattern_set",
  LS_GITHUB_TOKEN:  "sdt_github_token",
  LS_OFFLINE:       "sdt_offline_mode",
  LS_TASKS_CACHE:   "sdt_tasks_cache",
});
