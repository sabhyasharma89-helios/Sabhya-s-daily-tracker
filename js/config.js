/* ════════════════════════════════════════════════════
   config.js — runtime constants & localStorage keys
════════════════════════════════════════════════════ */
const CFG = {
  /* GitHub repo where database.json lives */
  DEFAULT_REPO:     'sabhyasharma89-helios/sabhya-s-daily-tracker',
  DB_PATH:          'data/database.json',

  /* Auto-refresh interval (ms). Frontend polls for Action updates. */
  AUTO_REFRESH_MS:  2 * 60 * 1000,   // 2 minutes

  /* localStorage keys */
  LS: {
    PATTERN_HASH:   'stt_pattern_hash',
    GITHUB_PAT:     'stt_github_pat',
    GITHUB_REPO:    'stt_github_repo',
    EMPLOYEES:      'stt_employees',   // JSON array of name strings
    LOCAL_OVERRIDES:'stt_overrides',   // user edits before push
  },

  /* Priority order for sorting */
  PRIORITY_ORDER: { urgent: 0, medium: 1, low: 2 },

  BRANCH: 'main',
};
