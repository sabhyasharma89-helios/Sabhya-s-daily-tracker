# Sabhya's Task Tracker

An AI-powered personal task tracker that reads your Gmail every 10 minutes, uses Claude to understand each email thread, groups tasks by client, and presents them on a mobile-responsive dashboard protected by a pattern lock.

---

## How It Works

```
Gmail inbox
    │  (every 10 min via GitHub Actions)
    ▼
Claude AI (claude-sonnet-4-6)
    │  analyses each thread → client name, priority, action items, summary
    ▼
data/tasks.json  (committed to this repo)
    │
    ▼
GitHub Pages  →  your browser  (pattern-locked dashboard)
```

---

## One-Time Setup (~15 minutes)

### Step 1 — Enable GitHub Pages

1. Go to your repository → **Settings → Pages**
2. Source: **Deploy from a branch** → branch `main`, folder `/ (root)`
3. Save. Your dashboard URL will be `https://<your-username>.github.io/<repo-name>/`

### Step 2 — Create a Google Cloud project & Gmail credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **New Project**
2. Enable the **Gmail API**: APIs & Services → Library → search "Gmail API" → Enable
3. Create OAuth credentials:
   - APIs & Services → **Credentials → Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Note the `client_id` and `client_secret` values
4. Add your Gmail address as a **Test user** (OAuth consent screen → Test users)

### Step 3 — Get your Gmail refresh token

Run this once on your local machine (Node 18+ required):

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
npm install

export GMAIL_CLIENT_ID=your_client_id_here
export GMAIL_CLIENT_SECRET=your_client_secret_here
node scripts/setup-oauth.js
```

Follow the prompts — you'll get a `GMAIL_REFRESH_TOKEN` printed at the end.

### Step 4 — Get an Anthropic API key

Sign up at [console.anthropic.com](https://console.anthropic.com) → **API Keys → Create key**.

### Step 5 — Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name           | Value                          |
|-----------------------|--------------------------------|
| `GMAIL_CLIENT_ID`     | From Step 2                    |
| `GMAIL_CLIENT_SECRET` | From Step 2                    |
| `GMAIL_REFRESH_TOKEN` | From Step 3                    |
| `ANTHROPIC_API_KEY`   | From Step 4                    |

### Step 6 — Trigger the first sync

Go to **Actions → Sync Emails to Tasks → Run workflow**.

The first run reads the last **30 days** of inbox emails and creates tasks. After that the workflow runs automatically every 10 minutes and builds on existing data — nothing is ever deleted.

---

## Dashboard Features

| Feature | How to use |
|---------|-----------|
| **Pattern lock** | Draw 4+ dots on the 3×3 grid to unlock |
| **Set your pattern** | First visit: draw twice to confirm |
| **Reset pattern** | Settings (⚙) → Reset Unlock Pattern |
| **Stats bar** | Click any card to quick-filter that priority/status |
| **Client tabs** | Tap header to collapse/expand; sorted by urgency |
| **Task detail** | Tap a task card — shows thread summary, action items, next-step person |
| **Complete a task** | Tap the circle on the left of any task card |
| **Undo completion** | Tap the circle again in the Completed section |
| **Change priority** | Open task → "Change Priority" (cycles urgent → medium → low) |
| **Assign to employee** | Edit task → Assign To field |
| **Add manual task** | Tap the **+** button (bottom-right corner) |
| **Search** | Type in the search bar — searches subject, client, assignee, summary |
| **Filter** | Use the four dropdowns (status, priority, employee, client) |
| **Completed section** | Collapsed at the bottom by default; click to expand |
| **Cross-device sync** | Settings → enter your GitHub PAT (repo scope) |

---

## Re-reading all emails from scratch

To re-process all emails from the last 30 days:

1. **Actions → Sync Emails to Tasks → Run workflow**
2. Set `reset_first_run` input to `true`
3. Click **Run workflow**

---

## Project structure

```
├── index.html                   # Single-page dashboard
├── css/styles.css               # All styles (dark theme, responsive)
├── js/app.js                    # Frontend: pattern lock, data, rendering
├── data/tasks.json              # Live database (auto-updated by Actions)
├── scripts/
│   ├── sync-emails.js           # GitHub Actions sync script (Node.js)
│   └── setup-oauth.js           # One-time OAuth helper (run locally)
├── .github/workflows/sync.yml   # Cron workflow (every 10 minutes)
└── package.json
```

---

## Data & Privacy

- `data/tasks.json` is served via GitHub Pages (publicly readable if repo is public).
- The pattern lock protects the dashboard **UI only** — it does not encrypt the raw JSON file.
- For full privacy: set the repository to **Private** and configure a GitHub PAT in the dashboard Settings so data is loaded via the authenticated GitHub API.
- Email content is sent to the Anthropic API for analysis. Only plain text (~1 500 chars per message) is sent; attachments are never transmitted.

---

## Troubleshooting

**Workflow fails with "invalid_grant"** — The OAuth refresh token expired. Re-run `node scripts/setup-oauth.js` and update the `GMAIL_REFRESH_TOKEN` secret.

**No tasks appear on the dashboard** — Verify GitHub Pages is enabled and the Actions workflow has run at least once successfully. Check browser DevTools → Network for the `data/tasks.json` response.

**Pattern lock won't accept** — You must connect at least 4 dots in one continuous stroke without lifting your finger/mouse between dots.
