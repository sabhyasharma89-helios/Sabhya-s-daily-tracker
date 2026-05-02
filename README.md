# Sabhya's Daily Task Tracker

A personal AI-powered task tracker that automatically reads your Gmail, analyses email threads with Claude AI, and organises everything into a beautiful, mobile-responsive dashboard — hosted entirely on GitHub Pages.

---

## What It Does

- **Reads your Gmail every 10 minutes** via a scheduled GitHub Actions workflow
- **AI analyses each email thread** using Claude (Anthropic) to extract: client name, task title, priority, actionable items, and next-steps owner
- **Organises tasks by client** in an expandable dashboard with drag-and-drop reordering
- **Auto-updates tasks** when new emails arrive in an existing thread
- **Auto-completes tasks** when email threads indicate resolution
- **Pattern-lock authentication** — only you can access the dashboard
- **100% GitHub-hosted** — no servers, no monthly fees (beyond GitHub Actions minutes)
- **Data never deleted** — every sync is committed to git history

---

## Architecture

```
GitHub Pages (index.html)          ←── reads ───→  data/tasks.json (GitHub repo)
      │                                                      ↑
      │ IndexedDB (browser)                                  │
      │ stores all local changes                   GitHub Actions (cron)
      │                                            runs every 10 minutes
      └── writes back via GitHub API ──────────→  process-emails.js
                (needs PAT)                              │
                                              Gmail API + Claude API
```

---

## Setup (One-Time)

### Prerequisites
- GitHub account with this repo forked/cloned
- Google account with Gmail
- Anthropic account for Claude API key

---

### Step 1 — Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **`main`**, folder: **`/ (root)`**
4. Click **Save**

Your dashboard will be live at:
`https://<your-username>.github.io/<repo-name>/`

---

### Step 2 — Set Up Google Cloud & Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (e.g. "SabhyaTracker")
3. Enable the **Gmail API**: APIs & Services → Library → search "Gmail API" → Enable
4. Create OAuth credentials:
   - APIs & Services → Credentials → **Create Credentials** → OAuth 2.0 Client ID
   - Application type: **Desktop app**
   - Name: "SabhyaTracker"
   - Click **Create**
5. Note your **Client ID** and **Client Secret**

---

### Step 3 — Get Gmail Refresh Token (Local, One-Time)

Run this on your own machine (not in GitHub Actions):

```bash
git clone https://github.com/<your-username>/<repo-name>
cd <repo-name>/scripts
npm install

GMAIL_CLIENT_ID=your_client_id \
GMAIL_CLIENT_SECRET=your_client_secret \
node setup-oauth.js
```

This opens a browser tab. Sign in with your Gmail account, grant access, and the script prints your **refresh token**.

---

### Step 4 — Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets one by one:

| Secret Name          | Value                                  |
|----------------------|----------------------------------------|
| `GMAIL_CLIENT_ID`    | From Step 2                            |
| `GMAIL_CLIENT_SECRET`| From Step 2                            |
| `GMAIL_REFRESH_TOKEN`| From Step 3 output                     |
| `ANTHROPIC_API_KEY`  | From [console.anthropic.com](https://console.anthropic.com) → API Keys |

> **Note:** `GITHUB_TOKEN` is automatically available — you don't need to add it.

---

### Step 5 — Trigger the First Sync

1. Go to **Actions** tab in your repo
2. Click **"Email Sync — Process New Emails"**
3. Click **"Run workflow"** → check **"Force full sync"** checkbox → **Run**

This first run will read your last 30 days of emails and create all initial tasks. Subsequent runs happen automatically every 10 minutes.

---

### Step 6 — Open the Dashboard

Visit your GitHub Pages URL. On first load:

1. **Set your pattern** — draw a connection pattern (minimum 4 dots) twice to confirm
2. **Configure the repo** — enter your GitHub username, repo name, and optionally a Personal Access Token (PAT) for cross-device sync
3. **Open Dashboard**

---

## Using the Dashboard

### Pattern Lock
- Drawn on a 3×3 grid (like Android)
- Hashed with SHA-256 — pattern is never stored in plain text
- After 5 wrong attempts, a "Forgot" reset option appears

### Task Cards
- Click any task card to view the full detail modal
- Check the checkbox to mark complete/incomplete
- Tasks auto-sort by priority (Urgent → Medium → Low) within each client

### Task Detail Modal
- **Summary**: AI-generated overview of the email thread
- **Actionables**: Specific items that need to be done
- **Next Steps — Responsible**: Who takes action next
- **Email Thread**: Expandable list of all emails in the thread
- **Change Priority**: Dropdown to override AI-assigned priority
- **Assign to Employee**: Assign task to a team member

### Statistics Bar
- Total, Pending, Completed, Urgent, Medium, Low task counts
- Updates in real-time as you change tasks

### Filters & Search
- Search by task title, client name, employee, or keywords from email summaries
- Filter by priority, employee, or status (pending/completed/all)

### Client Sections
- Each client has an expandable section
- Drag the ⠿ handle to reorder client sections
- **"+ Task"** button on each client to add a task under that client

### Completed Tasks
- Collapse at the bottom of the page (minimised by default)
- Uncheck a completed task to move it back to pending

### Adding Tasks Manually
- Click **"+ Add Task"** in the controls bar
- Fill in title, client, priority, description, actionables, and assignee

---

## Cross-Device Sync (Optional)

By default, task modifications (priority changes, assignments, manual tasks) are stored in your browser's IndexedDB. To sync changes across devices:

1. Create a GitHub **Personal Access Token**:
   GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → Grant **Contents: Read and Write** permission on your repo

2. Go to **Settings** (⚙ icon) in the tracker
3. Enter your token in "Personal Access Token"
4. Click Save

Now any change you make is pushed to GitHub instantly.

---

## Manual Actions in GitHub Actions

### Force a Full Re-sync
Actions → Email Sync → Run workflow → ✓ Force full sync → Run

### Trigger an Immediate Sync
Actions → Email Sync → Run workflow → Run workflow

---

## Data Storage

- **`data/tasks.json`** — The master database. Written by GitHub Actions (email processor) and optionally by your browser (if PAT is configured). Every write creates a git commit, so history is preserved forever.
- **Browser IndexedDB** — Local cache and offline-first storage. Syncs from `tasks.json` on every page load and every 10 minutes.

---

## Privacy & Security

- **Pattern**: Hashed with SHA-256 using a salt. Never transmitted anywhere.
- **GitHub Token**: Stored in your browser's IndexedDB only. Never logged or shared.
- **Emails**: Processed by Claude API (Anthropic). Email contents are sent to Anthropic's API for analysis. Review Anthropic's [privacy policy](https://www.anthropic.com/privacy).
- **tasks.json**: Stored in your GitHub repo. If your tasks contain sensitive data, make the repo **private** (GitHub Pages works on private repos with GitHub Pro/Team).

---

## Troubleshooting

### Dashboard shows "No tasks yet"
- Check that the GitHub Actions workflow has run (Actions tab)
- Verify all 4 secrets are correctly set
- Try a manual workflow trigger with "Force full sync"

### Emails not syncing
- In GitHub Actions, check the workflow run logs for errors
- Verify `GMAIL_REFRESH_TOKEN` is valid (re-run `setup-oauth.js` if expired)
- Check that Gmail API is still enabled in Google Cloud Console

### Pattern forgotten
- On the pattern screen, after 5 attempts a "Forgot pattern? Reset" button appears
- This clears all local data — your tasks in `tasks.json` on GitHub are preserved

---

## File Structure

```
├── index.html                    # Dashboard (served by GitHub Pages)
├── css/
│   └── style.css                 # All styles (dark theme, responsive)
├── js/
│   ├── auth.js                   # Pattern lock authentication
│   ├── db.js                     # IndexedDB persistence layer
│   ├── sync.js                   # GitHub sync (fetch + push)
│   └── app.js                    # Main application logic
├── data/
│   └── tasks.json                # Task database (updated by Actions)
├── scripts/
│   ├── process-emails.js         # Email processor (runs in Actions)
│   ├── setup-oauth.js            # One-time Gmail OAuth setup
│   └── package.json              # Node.js dependencies
└── .github/
    └── workflows/
        └── email-sync.yml        # Scheduled GitHub Actions workflow
```

---

## Technology Stack

| Component        | Technology                              |
|------------------|-----------------------------------------|
| Frontend         | Vanilla HTML/CSS/JS (no framework)      |
| Database         | IndexedDB (browser) + JSON (GitHub)     |
| Authentication   | Pattern lock + SHA-256 (Web Crypto API) |
| Email source     | Gmail API (Google)                      |
| AI analysis      | Claude claude-sonnet-4-6 (Anthropic)    |
| Hosting          | GitHub Pages                            |
| Automation       | GitHub Actions (cron schedule)          |
| Sync             | GitHub REST API                         |
