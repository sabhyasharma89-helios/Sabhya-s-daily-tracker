# Sabhya's Daily Tracker

An AI-powered task tracker that continuously reads your Gmail, extracts actionable items using Claude AI, and presents them in a beautiful, mobile-responsive dashboard — secured behind a pattern lock.

---

## Features

- **Pattern Lock** — Android-style 3×3 dot pattern protects the dashboard; stored securely in your browser
- **Auto Email Processing** — GitHub Actions runs every 10 minutes, reads new Gmail threads, extracts tasks via Claude AI
- **Smart Task Extraction** — Claude identifies client name, priority, actionables, responsible person, and status
- **Client-grouped Dashboard** — Tasks are organised by client in collapsible sections
- **Priority System** — 🔴 Urgent / 🟡 Medium / 🟢 Low with one-click changes
- **Task Details** — Click any task to see email thread summary, action items, and full email history
- **Auto-complete Detection** — If new emails indicate a task is resolved, it's marked done automatically
- **Employee Assignment** — Assign tasks to team members with autocomplete
- **Search & Filter** — Filter by status, priority, client, or assignee with live search
- **Completed Tab** — All done tasks collapse into a minimised section; uncheck to restore
- **Manual Tasks** — Add tasks that aren't email-derived
- **Never Deletes Data** — All processed data is cumulative and permanent

---

## One-Time Setup (15 minutes)

### Step 1 — Enable GitHub Pages

1. Go to your repository on GitHub
2. **Settings → Pages → Source**: select `Deploy from a branch` → `main` → `/ (root)` → Save
3. Your dashboard will be live at `https://<your-username>.github.io/<repo-name>/`

### Step 2 — Get Gmail API credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. **APIs & Services → Enable APIs** → search `Gmail API` → Enable
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Desktop App**
   - Download the JSON → rename to `credentials.json`

### Step 3 — Run the local auth helper

```bash
# Clone the repo
git clone https://github.com/<you>/<repo>.git
cd <repo>

# Install dependencies
pip install -r scripts/requirements.txt

# Place your credentials.json in scripts/
cp ~/Downloads/credentials.json scripts/credentials.json

# Run the auth helper — it opens your browser
python scripts/setup_gmail_auth.py
```

The script prints **four values** you need to copy:
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- (also need) `ANTHROPIC_API_KEY` — get from [console.anthropic.com](https://console.anthropic.com/)

### Step 4 — Add GitHub Secrets

In your GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**

Add each of the four secrets listed above.

### Step 5 — Run the initial email scan

1. Go to **Actions → Process Emails → Run workflow**
2. Set **Initial run** to `true`
3. Click **Run workflow**

This reads your last 30 days of emails, analyses them with Claude, and publishes the task data. Subsequent runs happen automatically every 10 minutes.

---

## How it works

```
Gmail  ──────►  GitHub Actions (every 10 min)  ──────►  data/tasks.json
                       │
                       │  Claude AI analyses each thread:
                       │  • client name   • priority
                       │  • action items  • status
                       │  • email summary
                       │
                       ▼
GitHub Pages  ◄────  tasks.json (committed to repo)
      │
      ▼
Browser (index.html)
  • Pattern lock authentication
  • Fetches tasks.json
  • Merges with localStorage (user changes)
  • Renders client-grouped dashboard
```

### Data storage

| Where | What |
|-------|------|
| `data/tasks.json` (repo) | Email-derived tasks, updated by GitHub Actions |
| Browser `localStorage` | Priority overrides, assignments, manual tasks, client ordering |

User changes (priority, assignee, completion, manual tasks) live in `localStorage` and are merged with the remote data on every load. Your data is always safe.

---

## Dashboard Guide

| Element | Action |
|---------|--------|
| Pattern grid | Draw your unlock pattern |
| Stats bar | Click a stat to filter by that type |
| Client section header | Click to collapse/expand |
| ↑ ↓ buttons | Reorder client sections |
| Task card | Click to open full details |
| ✓ button | Toggle complete / pending |
| Priority badge | Click to change priority |
| + button (header) | Add a manual task |
| 🔄 button | Force refresh data |
| 🔒 button | Lock the dashboard |

---

## Troubleshooting

**Workflow fails with auth error** — Your refresh token may have been revoked. Re-run `setup_gmail_auth.py` and update the `GMAIL_REFRESH_TOKEN` secret.

**No tasks appear** — Check that the initial workflow ran successfully (green tick in Actions tab). The `data/tasks.json` file should have content.

**Pattern lock forgotten** — Open browser DevTools → Application → Local Storage → delete `sdt_pattern_hash`. You'll be prompted to set a new pattern.

**Data shows on desktop but not mobile** — `localStorage` is per-browser. Data entered on desktop won't appear on mobile (and vice versa). This is by design for a single-user personal tool.
