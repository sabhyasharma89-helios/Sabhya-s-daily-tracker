# Sabhya's Daily Tracker — Complete Setup Guide

A fully automated, AI-powered task tracker that reads your Gmail, extracts
actionable tasks using Claude AI, and displays them in a beautiful, secure
web dashboard hosted on GitHub Pages.

---

## How It Works

```
Gmail ──► GitHub Actions (every 10 min) ──► Claude AI
                │                              │
                └──► Analyzes threads ──────────┘
                           │
                    Updates data/tasks.json
                           │
                    GitHub Pages serves it
                           │
              Your Browser ←── Pattern Lock ── You
```

---

## Step 1 — Enable GitHub Pages

1. Go to your repository on GitHub.
2. Click **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Branch: `main`, Folder: `/ (root)`.
5. Click **Save**.
6. Your dashboard URL will be: `https://<username>.github.io/<repo-name>/`

---

## Step 2 — Get Gmail OAuth2 Credentials

### 2a. Create a Google Cloud Project
1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project (e.g. "Daily Tracker").
3. In the left menu go to **APIs & Services → Library**.
4. Search for **Gmail API** and click **Enable**.

### 2b. Create OAuth2 Credentials
1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. Application type: **Desktop app**.
4. Name: `Daily Tracker`.
5. Click **Create** — you'll see a Client ID and Client Secret.
6. Download or copy both values.

### 2c. Configure OAuth Consent Screen (if prompted)
- User type: **External** (or Internal if G Workspace).
- Add your own email as a test user.
- Scopes needed: `gmail.readonly`, `gmail.metadata`.

### 2d. Generate Refresh Token
Run this locally (Node.js 18+ required):

```bash
cd scripts
npm install
GMAIL_CLIENT_ID=your_client_id \
GMAIL_CLIENT_SECRET=your_client_secret \
node get-gmail-token.js
```

This starts a local server on port 3000, opens a browser auth flow, and prints
your refresh token to the terminal.

---

## Step 3 — Get Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com).
2. Click **API Keys → Create Key**.
3. Copy the key (starts with `sk-ant-...`).

---

## Step 4 — Add GitHub Repository Secrets

Go to: `https://github.com/<username>/<repo>/settings/secrets/actions`

Add these **Repository Secrets**:

| Secret Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | Your Google OAuth2 Client ID |
| `GMAIL_CLIENT_SECRET` | Your Google OAuth2 Client Secret |
| `GMAIL_REFRESH_TOKEN` | Refresh token from Step 2d |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

---

## Step 5 — Get a GitHub Personal Access Token (for Dashboard Writes)

This lets the web dashboard save your edits (priority changes, assignments,
manual tasks) back to the repository.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens).
2. Click **Generate new token (classic)**.
3. Name: `Daily Tracker Dashboard`.
4. Expiration: set as long as you prefer.
5. Scopes: check **`repo`** (full repo access).
6. Click **Generate token** — copy the value.

You'll enter this token in the dashboard on first load (it's stored in your
browser's localStorage and never sent anywhere except GitHub's API).

---

## Step 6 — Run First Sync

Option A — Automatic: Wait up to 10 minutes for the scheduled workflow to run.

Option B — Manual (recommended for first run):
1. Go to your repository → **Actions** tab.
2. Click **Email Task Sync** → **Run workflow**.
3. Check **Force full 30-day sync** → **Run workflow**.
4. Watch the logs — it will process your last 30 days of emails.

---

## Step 7 — Open Your Dashboard

1. Navigate to your GitHub Pages URL.
2. On first visit, draw a unlock pattern (connect at least 4 dots).
3. Draw it again to confirm.
4. Enter your GitHub Personal Access Token when prompted.
5. Your tasks will load automatically!

---

## Dashboard Features

### Pattern Lock
- Draw on 3×3 dot grid — connect at least 4 dots.
- Pattern stored as a one-way hash in your browser.
- Lock screen button in the header lets you lock manually.
- "Reset Pattern" if you forget yours (clears localStorage).

### Task Organization
- Tasks are automatically grouped under **Client cards**.
- Each card shows pending task counts by priority (🔴🟡🟢).
- Click a card header to expand/collapse.
- **Drag** cards by the ⠿ handle to reorder clients.
- Completed tasks move to the collapsed **Completed** section at the bottom.

### Task Actions
- **Click a task** to expand thread summary, action items, and next steps.
- **Circle icon** on the left to toggle pending ↔ completed.
- **Edit button** to change title, description, priority, assignee.
- **Priority buttons** inside expanded view for quick priority change.
- **Assign dropdown** to assign a task to a team member.

### Filters & Search
- Search across task titles, clients, email summaries, people.
- Filter by priority, status, employee, or client.

### Manual Tasks
- Click **Add Task** to create a task not from email.
- Manual tasks have a "Manual" badge and a delete button.

### Team Management
- Click **Team** in header to add/remove employees.
- Employees appear in assignment dropdowns.

### Statistics Bar
- Always-visible counts: Total, Pending, Done, Urgent, Medium, Low.

---

## Email Processing Logic

Every 10 minutes, the GitHub Actions workflow:
1. Fetches all new email threads since last sync (first run = last 30 days).
2. Skips promotions and social categories.
3. For each thread, passes the full conversation to Claude Sonnet.
4. Claude identifies: client name, task title, priority, status, summary, action items, next responsible.
5. If the thread already has a task → updates it.
6. If status appears "completed" in email → auto-marks the task done.
7. Commits updated `data/tasks.json`, `data/clients.json`, `data/metadata.json`.
8. Dashboard auto-refreshes every 10 minutes.

---

## Data Storage

| File | Contents | Updated by |
|---|---|---|
| `data/tasks.json` | All email-derived tasks | GitHub Actions |
| `data/clients.json` | Clients discovered from emails | GitHub Actions |
| `data/metadata.json` | Sync logs and timestamps | GitHub Actions |
| `data/user-overrides.json` | Your edits, manual tasks, employees | Browser via GitHub API |

**Data is never deleted.** Completed tasks are marked complete but kept forever.

---

## Troubleshooting

**Workflow fails with "Gmail API" error**
- Check that your refresh token hasn't expired (Google tokens can expire if not used for 6 months).
- Re-run `get-gmail-token.js` to get a fresh token.

**"GitHub API 401" in dashboard**
- Your GitHub token may have expired. Create a new one and re-enter in the token setup screen.
- Clear localStorage and reload to redo setup: `localStorage.clear()` in browser console.

**No tasks appearing after first sync**
- Check Actions tab for workflow run logs.
- Ensure all 4 secrets are correctly set.
- Try running with "Force full 30-day sync" checked.

**Pattern forgotten**
- Open browser console on the dashboard page and run: `localStorage.removeItem('sdt_pattern_hash')`
- Reload the page to set a new pattern.

---

## Cost Estimates

- **Claude API**: ~$0.01–0.05 per email thread (Sonnet pricing).
  With 10 threads/sync × 6 syncs/hour × 24 hours = ~1,440 calls/day.
  Estimate: **$15–70/month** depending on email volume and thread length.
- **GitHub Actions**: Free for public repos. Free tier includes 2,000 min/month for private repos
  (each 10-min run uses ~2–3 min, so ~8,640 min/month — upgrade plan needed for private repos).

**Tip**: Keep the repo public (only task data is visible, not your emails) or use
GitHub Pro/Teams for the higher Actions minutes allowance.

---

*Built with Claude Sonnet, Gmail API, GitHub Actions & Pages.*
