# Sabhya's Daily Tracker

An AI-powered task tracker that reads your Gmail, extracts actionable tasks using Claude AI, and presents them in a beautiful, mobile-responsive dashboard — protected by pattern-lock authentication.

## Features

- **Pattern-lock authentication** — 3×3 Android-style unlock pattern
- **Auto email processing** — GitHub Actions reads new emails every 10 minutes
- **AI task extraction** — Claude analyzes email threads, extracts tasks, identifies clients, sets priorities
- **Client-based organization** — tasks grouped by client with expandable categories
- **Priority management** — Urgent / Medium / Low with visual indicators
- **Full thread summaries** — click any task to see the AI-generated email thread summary
- **Task assignment** — assign tasks to employees, filter by assignee
- **Persistent database** — IndexedDB locally, synced to `data/tasks.json` on GitHub
- **Mobile responsive** — works on all screen sizes, installable as PWA

---

## Setup Guide

### Step 1 — Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **Deploy from a branch** → branch `main` → folder `/`
3. Your dashboard will be at `https://<your-username>.github.io/<repo-name>`

### Step 2 — Get Gmail API Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (e.g. "Daily Tracker")
3. Enable **Gmail API** (APIs & Services → Library → search Gmail API)
4. Create credentials: **OAuth 2.0 Client ID** → Application type: **Desktop app**
5. Download the client ID and client secret
6. Run the helper script locally to get a refresh token:
   ```bash
   pip install google-auth-oauthlib
   python3 scripts/get_gmail_token.py
   ```
7. Follow the browser prompt to authorize Gmail read access

### Step 3 — Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | Your Google OAuth Client ID |
| `GMAIL_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `GMAIL_REFRESH_TOKEN` | Refresh token from Step 2 |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) |

### Step 4 — First-time App Setup

1. Open your GitHub Pages URL
2. **Draw your unlock pattern** on the 3×3 grid (minimum 4 dots)
3. Draw it again to confirm
4. Enter your GitHub repo owner, repo name, and a GitHub Personal Access Token
   - [Generate token](https://github.com/settings/tokens/new?scopes=repo&description=SabhyaTracker) with `repo` scope
5. Done! The dashboard is ready.

### Step 5 — Trigger First Run

Go to **Actions → Process Emails → Run workflow** to trigger the first email processing run (reads last 30 days of emails). After that, it runs automatically every 10 minutes.

---

## Architecture

```
GitHub Actions (every 10 min)
  └─ scripts/process_emails.py
       ├─ Reads Gmail API for new threads
       ├─ Calls Claude claude-sonnet-4-6 to analyze each thread
       └─ Updates data/tasks.json → commits to repo

GitHub Pages (static frontend)
  └─ index.html + js/ + css/
       ├─ Pattern-lock auth gate
       ├─ Fetches data/tasks.json every 10 min
       ├─ Merges with IndexedDB (local overrides preserved)
       └─ User changes pushed back to GitHub via API
```

## Privacy & Security

- Your GitHub PAT is XOR-encrypted with your pattern hash before storing in `localStorage`
- Pattern is stored as a SHA-256 hash — never in plain text
- All email content is processed in GitHub Actions (never sent to the browser)
- `data/tasks.json` lives in your own repository

## Resetting

- **Change pattern**: Settings (gear icon) → Change Unlock Pattern
- **Re-process all emails**: Actions → Process Emails → Run workflow → enable "Reset to first run"
- **Clear local data**: Browser DevTools → Application → IndexedDB → delete `SabhyaTracker`
