# Sabhya's Task Tracker

An AI-powered, email-driven task tracker hosted on GitHub Pages.  
Gmail threads → Claude AI → organised task dashboard, auto-updated every 10 minutes.

---

## Features

| Feature | Detail |
|---------|--------|
| Pattern lock | 3×3 draw-pattern authentication, stored as SHA-256 hash |
| Email ingestion | Reads Gmail every 10 min via GitHub Actions |
| AI analysis | Claude `claude-sonnet-4-6` extracts client, priority, actionables |
| Client tabs | Tasks grouped per client, expandable |
| Priority colour coding | 🔴 Urgent · 🟡 Medium · 🟢 Low |
| Task detail | Full email thread timeline, AI summary, actionables, responsible person |
| Manual tasks | Add tasks that aren't from email |
| Assign & filter | Assign to employees; filter by client, assignee, priority, status |
| Completed tab | Auto-collapsed; uncheck to move back to pending |
| Stats bar | Live counts for urgent / medium / low / pending / done / total |
| GitHub as DB | `data/tasks.json` is the single source of truth — never deleted |
| PWA | Installable on mobile (Add to Home Screen) |

---

## One-time Setup (≈ 20 minutes)

### 1 · Enable GitHub Pages

1. Go to **Settings → Pages** in this repository.
2. Source: **Deploy from branch** → branch `main`, folder `/` (root).
3. Note the published URL, e.g. `https://sabhyasharma89-helios.github.io/sabhya-s-daily-tracker/`.

> **Privacy**: Make the repo **private** (requires GitHub Pro/Team) to keep task data confidential.
> On a free public repo the data file is publicly readable — use a private repo for sensitive client info.

---

### 2 · Google Cloud — Enable Gmail API & get credentials

1. Open [console.cloud.google.com](https://console.cloud.google.com/).
2. Create a project (or use an existing one).
3. **APIs & Services → Library** → search **Gmail API** → Enable.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Desktop app**.
   - Download the JSON — save it as `credentials.json` (do **not** commit this file).

---

### 3 · Generate Gmail OAuth token (run locally once)

```bash
pip install google-auth-oauthlib
python scripts/setup_auth.py
```

A browser window opens. Sign in with the Gmail account to monitor and grant read access.
The script prints a JSON blob — copy it.

---

### 4 · Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret** for each:

| Secret name | Value |
|-------------|-------|
| `GMAIL_TOKEN_JSON` | The JSON blob from step 3 |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/) |

---

### 5 · First run

Trigger a manual run: **Actions → Email Task Tracker → Run workflow**.
This reads the last 30 days of Gmail and populates `data/tasks.json`.
After that, the workflow runs automatically every 10 minutes.

---

### 6 · Open the dashboard

Open your GitHub Pages URL. On first visit:

1. **Draw a pattern** (at least 4 dots) and confirm it.
2. Enter your **GitHub Personal Access Token** (PAT) with `repo` scope so the dashboard can save manual changes.
   - Create at: **GitHub → Settings → Developer settings → Personal access tokens (classic)** → `repo` scope.
3. Click **Save & Open Dashboard**.

The PAT is encrypted with your pattern and stored in `localStorage` — it never leaves your browser unencrypted.

---

## Manual workflow trigger options

| Option | Effect |
|--------|--------|
| Default | Incremental — only emails since last check |
| `force_full_scan = true` | Re-reads the last 30 days, re-creates all tasks |

---

## Architecture

```
GitHub Actions (every 10 min)
  scripts/process_emails.py
    Reads Gmail via OAuth
    Calls Claude API (claude-sonnet-4-6)
    Commits data/tasks.json to main branch

GitHub Pages (index.html)
  assets/js/app.js
    Fetches data/tasks.json on load
    Renders client-grouped task dashboard
    Writes changes back via GitHub Contents API (needs PAT)
```

---

## Security notes

- Pattern hash (SHA-256) stored in `localStorage` — never the pattern itself.
- GitHub PAT encrypted with AES-GCM (key derived from pattern via PBKDF2) before storing in `localStorage`.
- Gmail credentials stored only as GitHub Secrets — never in the repository.
- `credentials.json` and `token.json` must **not** be committed (`.gitignore` covers them).
