# Sabhya's Daily Task Tracker

An AI-powered task tracker that reads your Gmail, extracts actionable tasks per client, and presents them in a mobile-responsive dashboard protected by a pattern lock.

---

## How It Works

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | HTML / CSS / JS | Dashboard served via GitHub Pages |
| **Database** | `data/tasks.json` | Tasks stored as JSON in the repo |
| **Processing** | Python + Claude API | Email analysis, task extraction |
| **Automation** | GitHub Actions | Runs every 10 minutes |
| **Email access** | Gmail API (OAuth 2.0) | Read-only access to your inbox |

---

## One-Time Setup (≈ 15 minutes)

### Step 1 – Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **Deploy from a branch**, Branch: `main`, Folder: `/ (root)`
3. Save. Your dashboard will be live at `https://<your-username>.github.io/<repo-name>/`

### Step 2 – Create a Google Cloud Project & Enable Gmail API

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g., "Daily Tracker")
3. Navigate to **APIs & Services → Library**
4. Search for **Gmail API** → Enable it
5. Go to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in App name (e.g., "Daily Tracker"), your email
   - Scopes: add `https://www.googleapis.com/auth/gmail.readonly`
   - Test users: add your Gmail address
6. Go to **APIs & Services → Credentials**
   - Click **+ Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Download the JSON → save as `scripts/credentials.json` (do NOT commit this file)

### Step 3 – Get Your Gmail Refresh Token (run locally)

```bash
# Install deps
pip install google-auth-oauthlib

# Run setup
python scripts/setup_gmail_auth.py
```

A browser window will open. Sign in with your Gmail account and grant read access.
The script will print three values: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

### Step 4 – Get a Claude API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key → copy it

### Step 5 – Add GitHub Repository Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add each of these:

| Secret Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `GMAIL_CLIENT_ID` | From Step 3 output |
| `GMAIL_CLIENT_SECRET` | From Step 3 output |
| `GMAIL_REFRESH_TOKEN` | From Step 3 output |

### Step 6 – Trigger the First Run

Go to **Actions → Process Emails & Update Tasks → Run workflow**.

This first run will read 30 days of email and populate the dashboard. Subsequent runs (every 10 minutes) are automatic.

---

## Using the Dashboard

### Pattern Lock
- **First visit**: Draw and confirm your unlock pattern (minimum 4 dots on the 3x3 grid)
- **Subsequent visits**: Draw your pattern to unlock
- **Change pattern**: Settings (gear icon) → Change Unlock Pattern

### Dashboard Features

| Feature | How to use |
|---|---|
| Stats bar | Click any chip to filter by that category |
| Search | Type to search tasks, clients, employees |
| Filter chips | Filter by status or priority |
| Sort | Sort by priority / date / client / assignee |
| Client sections | Click header to expand/collapse; drag the handle to reorder |
| Task card | Click to open full detail with email thread summary |
| Complete task | Click the checkbox on any task card |
| Undo complete | Click checkbox again on a completed task |
| Change priority | Open task detail → priority dropdown |
| Assign task | Open task detail → assignee dropdown |
| Add task | + button in header or within a client section |
| Completed section | Always collapsed at bottom; click to expand |
| Employee filter | Appears automatically when employees are added in Settings |

### Settings (gear icon)
- **Change pattern**: re-draw a new unlock pattern
- **Manage employees**: add/remove employees for task assignment
- **Export data**: download all tasks as JSON
- **Sync status**: see when emails were last processed

---

## Data Architecture

```
data/
  tasks.json       <- All tasks (updated by GitHub Actions every 10 min)
  metadata.json    <- Sync state (last read timestamp, first run flag)
  employees.json   <- Employee list
```

**Data is never deleted.** The JSON grows over time. Completed tasks remain in the data permanently.

---

## Security

- Pattern lock uses SHA-256 hashing stored in `localStorage`; the raw pattern is never stored
- Gmail access is **read-only** — the app cannot send or modify emails
- No server-side code; the dashboard is a fully static site
- API keys are stored as GitHub encrypted secrets, never in the code

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Dashboard shows "Awaiting first sync" | Trigger workflow manually from the Actions tab |
| GitHub Actions failing | Check all 4 secrets are set correctly |
| Gmail auth error | Re-run `setup_gmail_auth.py` to get a fresh refresh token |
| Forgot pattern | Open browser DevTools console, run `localStorage.clear()`, reload |
| Tasks not updating | Check Actions tab for workflow run errors |
