# Sabhya's Task Tracker — Setup Guide

## Architecture

```
GitHub Actions (every 10 min)
  → Gmail API → Claude AI → data/tasks.json
                                    ↕
                         index.html (GitHub Pages)
                         ← reads via GitHub raw/API
                         → writes via GitHub API (with PAT)
```

---

## Step 1: Enable GitHub Pages

1. Go to your repository → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)**
4. Save — your dashboard will be at:
   `https://sabhyasharma89-helios.github.io/sabhya-s-daily-tracker/`

---

## Step 2: Set Up Gmail OAuth

```bash
# Install Python dependencies locally
pip install google-auth-oauthlib google-auth google-api-python-client

# Get credentials from Google Cloud Console:
# console.cloud.google.com → APIs & Services → Credentials
# Create OAuth 2.0 Client ID (Desktop app) → download JSON
mv ~/Downloads/client_secret_*.json scripts/credentials.json

# Run the auth setup — it will open a browser
python scripts/setup_gmail_auth.py
```

Copy the printed secret values (you'll need them in Step 3).

---

## Step 3: Add GitHub Repository Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret**

| Secret name              | Value                              |
|--------------------------|------------------------------------|
| `GMAIL_CREDENTIALS_JSON` | Full JSON from setup script output |
| `GMAIL_TOKEN_JSON`       | Full JSON from setup script output |
| `ANTHROPIC_API_KEY`      | Your key from console.anthropic.com|

---

## Step 4: Create a GitHub Personal Access Token (PAT)

This lets the dashboard write task changes back to the repo.

1. Go to **github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. Repository access: only `sabhya-s-daily-tracker`
3. Permissions: **Contents → Read and write**
4. Copy the token (starts with `github_pat_...`)

---

## Step 5: Open the Dashboard

1. Open `https://sabhyasharma89-helios.github.io/sabhya-s-daily-tracker/`
2. **First visit:** draw and confirm your unlock pattern, then enter your GitHub PAT
3. **All subsequent visits:** draw the pattern to unlock

---

## Step 6: Trigger First Sync

1. Go to **Actions → Email Sync → Run workflow**
2. Check "Force full 30-day sync" for the first run
3. Wait a few minutes for it to complete
4. Refresh your dashboard — tasks will appear

---

## How It Works

- **Every 10 minutes**: GitHub Actions reads new emails, sends them to Claude, and updates `data/tasks.json`
- **First run**: reads last 30 days of email
- **Subsequent runs**: incremental (only new emails since last run)
- **Your changes**: priority edits, assignments, completions are written back to the same file via GitHub API

---

## Manual Actions Available

| Action | How |
|--------|-----|
| Force full re-sync | Actions → Email Sync → Run workflow → check "Force full sync" |
| Add a task manually | Dashboard → "+ Add Task" button |
| Add team members | Dashboard → Settings (⚙️) → Team Members |
| Change unlock pattern | Settings → Security → Change Pattern |
| Search tasks | Filter bar at top |
| Filter by employee | Employee dropdown |
| Assign a task | Click task → Assignee dropdown → Save |

---

## Troubleshooting

**Tasks not appearing after sync**
- Check Actions tab for errors
- Verify secrets are set correctly
- Try "Force full sync"

**Can't save changes (no PAT)**
- Enter your PAT in Settings (⚙️)
- Changes are saved locally only without a PAT

**Pattern forgotten**
- Clear localStorage for the site (DevTools → Application → Local Storage → Clear)
- You'll be prompted to set a new pattern
