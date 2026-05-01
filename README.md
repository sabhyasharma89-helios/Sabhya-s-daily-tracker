# Sabhya's Daily Task Tracker

An AI-powered task tracker that reads your Gmail, extracts actionable tasks using Claude AI, and presents them in a secure, mobile-responsive dashboard hosted on GitHub Pages.

## Features

- 🔐 **Pattern-lock authentication** — secure PIN-free protection; pattern stored locally, never sent anywhere
- 📧 **Automatic email processing** — reads Gmail every 10 minutes via GitHub Actions
- 🤖 **AI-powered extraction** — Claude AI identifies clients, tasks, priorities, and action items from emails
- 🏢 **Client-grouped tasks** — tasks organised by client with drag-to-reorder tabs
- 📊 **Live statistics** — total, pending, urgent, medium, low, completed
- 👤 **Employee assignment** — assign tasks to team members and filter by employee
- 🔍 **Search & filter** — by status, priority, client, employee, or free text
- ✅ **Auto-completion** — tasks are marked done when resolved emails are detected
- 📝 **Email thread summaries** — click any task to read a full AI-generated summary
- 📱 **Mobile responsive** — works on any screen size

---

## Setup Guide

### Step 1 — Enable GitHub Pages

1. Go to your repository → **Settings** → **Pages**
2. Source: **Deploy from a branch**, branch: `main`, folder: `/ (root)`
3. Save — your dashboard URL will be `https://<username>.github.io/<repo-name>/`

---

### Step 2 — Get Gmail API credentials

Run this **once** on your local machine:

```bash
# Install the setup dependency
pip install google-auth-oauthlib

# Download credentials.json from Google Cloud Console first (see script output for instructions)
python scripts/setup_gmail.py
```

The script will guide you to:
1. Create a Google Cloud project
2. Enable the Gmail API
3. Create OAuth2 Desktop credentials
4. Sign in with your Google account
5. Print the three values you need for GitHub Secrets

---

### Step 3 — Add GitHub Secrets

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | From setup script output |
| `GMAIL_CLIENT_SECRET` | From setup script output |
| `GMAIL_REFRESH_TOKEN` | From setup script output |
| `ANTHROPIC_API_KEY` | Your key from [console.anthropic.com](https://console.anthropic.com/) |

---

### Step 4 — Trigger the first email import

Go to **Actions** → **Process Emails & Update Tasks** → **Run workflow** → Run.

This first run imports tasks from the **last 30 days** of your email. Subsequent runs (every 10 minutes) are incremental.

---

### Step 5 — Open and configure the dashboard

1. Visit your GitHub Pages URL
2. **Draw your unlock pattern** (connect 4+ dots)
3. **Confirm the pattern**
4. Enter your **GitHub repository path** (e.g. `sabhyasharma89-helios/sabhya-s-daily-tracker`)
5. Create a **GitHub Personal Access Token** (PAT):
   - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained
   - Repository access: only this repository
   - Permissions: **Contents: Read and write**
6. Paste the PAT and your name, then click **Save & Open Dashboard**

---

## How it works

```
Gmail ──(every 10 min)──▶ GitHub Actions ──▶ Claude AI ──▶ tasks.json (git commit)
                                                                      │
Dashboard (GitHub Pages) ◀──── GitHub API ─────────────────────────┘
         │
         └──(user edits priority/assignment)──▶ GitHub API ──▶ tasks.json
```

- **GitHub Actions** runs `scripts/process_emails.py` on a cron schedule
- **Claude AI** reads each email thread and extracts: client name, task title, priority, actionables, completion status, thread summary
- **tasks.json** is the single source of truth — it lives in your repo and grows forever
- **The dashboard** reads and writes `tasks.json` via the GitHub API using your PAT
- **Pattern lock** protects the dashboard; your PAT is encrypted with your pattern using AES-GCM (Web Crypto API)

---

## File structure

```
├── index.html                    # Dashboard (GitHub Pages)
├── data/
│   └── tasks.json                # Task database (updated by GitHub Actions)
├── scripts/
│   ├── process_emails.py         # Email processor (runs in GitHub Actions)
│   ├── setup_gmail.py            # One-time OAuth setup helper
│   └── requirements.txt          # Python dependencies
└── .github/
    └── workflows/
        └── process_emails.yml    # Scheduled workflow (every 10 min)
```

---

## Security notes

- Your Gmail credentials are stored as **GitHub Secrets** — never in code
- Your GitHub PAT is stored **encrypted in your browser's localStorage**, encrypted with AES-GCM using your pattern as the key
- The pattern itself is stored only as a SHA-256 hash — it cannot be reversed
- `credentials.json` is listed in `.gitignore` — never commit it

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Actions failing with auth error | Re-run `setup_gmail.py` and update the `GMAIL_REFRESH_TOKEN` secret |
| Dashboard shows "Sync failed" | Check your PAT hasn't expired; regenerate if needed |
| Tasks not appearing | Trigger a manual workflow run from the Actions tab |
| Forgot pattern | Click "Reset app" on the lock screen — settings are cleared but tasks in GitHub are safe |
