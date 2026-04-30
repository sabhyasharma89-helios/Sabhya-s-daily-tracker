# Sabhya's Daily Tracker — Setup Guide

A self-hosted, pattern-locked task tracker that auto-syncs from your Gmail inbox.

---

## Architecture

| Layer | What | Where |
|---|---|---|
| Frontend | HTML/CSS/JS SPA with pattern lock | GitHub Pages |
| Database | `data/tasks.json` committed to repo | GitHub repo |
| Processing | Python script using Gmail API + Claude | GitHub Actions (every 15 min) |
| Auth | SHA-256 hashed pattern lock | Browser localStorage |

---

## Step 1 — Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` (or your default branch), folder: `/ (root)`
4. Save — your dashboard will be at `https://<username>.github.io/<repo>/`

---

## Step 2 — Create a GitHub Personal Access Token (PAT)

The frontend needs write access to update `tasks.json` when you edit tasks.

1. Go to [github.com/settings/tokens/new](https://github.com/settings/tokens/new)
2. Name: `Daily Tracker`
3. Expiration: choose a comfortable duration
4. Scopes: check **`repo`** (or fine-grained: `contents: Read and write`)
5. Click **Generate token** and copy it — you'll enter it in the app setup

---

## Step 3 — Set Up Gmail API

### 3a. Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project (e.g. "Daily Tracker")
3. Go to **APIs & Services → Library**
4. Search for and enable **Gmail API**

### 3b. OAuth2 Credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Desktop app**
3. Name: `Daily Tracker CLI`
4. Download the JSON credentials file

### 3c. Generate Refresh Token (one-time, run locally)

```bash
pip install google-auth-oauthlib
python scripts/setup_oauth.py
```

Follow the prompts — a browser window will open for Google login. After authorising, the script prints three values to add as GitHub Secrets.

---

## Step 4 — Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | From setup_oauth.py output |
| `GMAIL_CLIENT_SECRET` | From setup_oauth.py output |
| `GMAIL_REFRESH_TOKEN` | From setup_oauth.py output |
| `ANTHROPIC_API_KEY` | Your key from [console.anthropic.com](https://console.anthropic.com/) |

---

## Step 5 — Open the Dashboard

1. Visit your GitHub Pages URL
2. On first visit, enter your GitHub details (owner, repo, PAT, branch)
3. Draw your lock pattern (minimum 4 dots) and confirm it
4. Your dashboard loads — empty on the first open

The first email sync will happen within 15 minutes (or trigger it manually: **Actions → Email Sync → Run workflow**). It will look back 30 days on the first run.

---

## How It Works

```
Every 15 minutes:
  GitHub Actions → process_emails.py
    → Gmail API: fetch threads since last run
    → Claude API: analyze each thread
        → extract: client name, task title, priority,
                   summary, action items, responsible party, status
    → Update data/tasks.json
    → git commit + push [skip ci]

When you open the dashboard:
  → Fetch data/tasks.json from GitHub API
  → Cache in localStorage (offline fallback)
  → Display tasks grouped by client
  → Your edits (priority, assign, manual tasks) → write back via GitHub API
```

---

## FAQ

**Q: Why 15 minutes instead of 10?**
GitHub Actions free plan provides 2,000 minutes/month for private repos. At 15-minute intervals with ~1-min runs: ~1,440 minutes/month, safely within the free tier. Upgrade to a paid plan if you want faster syncing.

**Q: Is my data safe?**
Your tasks.json lives in your private GitHub repo. The pattern lock is SHA-256 hashed and stored in browser localStorage — never sent to any server. The GitHub PAT you enter is stored only in your browser's localStorage.

**Q: What if GitHub is down?**
The dashboard uses localStorage as a cache. You can still view tasks; changes will sync when connectivity returns.

**Q: The dashboard shows my tasks but edits don't save.**
Check that your GitHub PAT has `repo` or `contents:write` permission and hasn't expired.

**Q: I forgot my pattern.**
Click "Forgot pattern? Reset" on the lock screen. This clears only the pattern — all your task data remains in GitHub.
