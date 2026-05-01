# Sabhya's Daily Task Tracker

An intelligent, Gmail-powered task dashboard hosted on GitHub Pages.  
Auto-reads your emails every 10 minutes, extracts client tasks using Claude AI, and presents them in a mobile-responsive dashboard protected by a pattern lock.

---

## Features

- **Pattern Lock** – Set a personal unlock pattern on first launch; no one else can view your dashboard
- **Auto Email Sync** – GitHub Actions reads your Gmail every 10 min and creates/updates tasks
- **AI Task Extraction** – Claude (claude-sonnet-4-6) reads each email thread and extracts client name, priority, action items, summary, and completion status
- **Client Tabs** – Tasks grouped by client in collapsible, reorderable accordion sections
- **Priority System** – Urgent / Medium / Low with one-click change
- **Employee Assignment** – Add team members and assign tasks; filter by assignee
- **Full Thread View** – Click any task to see the complete email conversation summary
- **Auto-Complete** – When Claude detects a task is resolved, it marks it complete automatically
- **Completed Section** – Completed tasks auto-move to a collapsed section; uncheck to restore
- **Search & Filter** – Search by keyword; filter by priority, client, assignee, or status
- **Statistics Dashboard** – Live counts: Total, Pending, Completed, Urgent, Medium, Low
- **Persistent Data** – `data/tasks.json` grows forever; data is never deleted
- **Mobile Responsive** – Works on phone, tablet, and desktop

---

## Setup (one-time, ~15 minutes)

### 1  Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / Folder: `/ (root)`
4. Save — your dashboard will be live at  
   `https://sabhyasharma89-helios.github.io/sabhya-s-daily-tracker/`

---

### 2  Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Gmail API**:  
   APIs & Services → Library → search "Gmail API" → Enable
4. Create OAuth credentials:  
   APIs & Services → Credentials → Create Credentials → **OAuth client ID**  
   - Application type: **Web application**  
   - Authorised redirect URIs: `https://developers.google.com/oauthplayground`
5. Note your **Client ID** and **Client Secret**

---

### 3  Get a Gmail Refresh Token

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (top right) → check **"Use your own OAuth credentials"**
3. Enter your Client ID and Client Secret from Step 2
4. In the left panel, scroll to **Gmail API v1** → select `https://www.googleapis.com/auth/gmail.readonly`
5. Click **Authorise APIs** → sign in with your Gmail account → Allow
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token**

---

### 4  Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | Your OAuth Client ID |
| `GMAIL_CLIENT_SECRET` | Your OAuth Client Secret |
| `GMAIL_REFRESH_TOKEN` | The refresh token from Step 3 |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from console.anthropic.com |

---

### 5  Trigger the First Sync

1. Go to **Actions** tab in your repo
2. Click **Email Sync** workflow
3. Click **Run workflow** → Run workflow
4. Watch the logs — it will read the last 30 days of emails and create tasks
5. After it completes, `data/tasks.json` is updated and GitHub Pages will serve the new data within a few minutes
6. From here on, the workflow runs automatically every 10 minutes

---

### 6  Set Your Pattern Lock

1. Open your dashboard URL in a browser
2. On first launch, you are prompted to **draw a pattern** (connect 4+ dots)
3. Draw it once → confirm by drawing the same pattern again
4. Your pattern hash is saved in your browser's `localStorage`
5. From now on, every visit requires your pattern to unlock the dashboard

> **Note:** The pattern lock is a UI protection stored in your browser. For true data privacy, the `data/tasks.json` file in the repo is publicly readable (GitHub Pages). If email content sensitivity is a concern, set your repo to **Private** (you can still use GitHub Pages on private repos with a GitHub Pro/Team plan).

---

## File Structure

```
├── index.html                    # Single-page dashboard app
├── assets/
│   ├── css/style.css             # Responsive styles
│   └── js/
│       ├── auth.js               # Pattern lock authentication
│       └── app.js                # Dashboard logic
├── data/
│   └── tasks.json                # Task database (auto-updated by sync)
├── scripts/
│   ├── package.json              # Node.js dependencies
│   └── email-sync.js             # Gmail + Claude sync script
└── .github/
    └── workflows/
        └── email-sync.yml        # Scheduled GitHub Actions workflow
```

---

## Data Architecture

```
Gmail ──► GitHub Actions (every 10 min)
              │
              ▼
        email-sync.js
              │  reads new threads
              ▼
        Claude API (claude-sonnet-4-6)
              │  extracts: client, title, priority,
              │  actionables, summary, completion status
              ▼
        data/tasks.json  ◄── committed to repo
              │
              ▼
        GitHub Pages serves tasks.json
              │
              ▼
        Browser fetches & renders dashboard
        (localStorage stores overrides + manual tasks)
```

---

## Using the Dashboard

| Action | How |
|---|---|
| Add manual task | FAB (+) button or "+ Add Task" |
| Change priority | Click task → expand → Urgent/Medium/Low buttons |
| Assign employee | Click task → "View Full Details" → Assign To dropdown |
| Mark complete | Check circle on left of task card |
| Uncheck complete | Check circle in Completed section |
| Reorder clients | ▲ ▼ arrows on client section header |
| Search | Header search box |
| Filter by client/priority/employee | Filter dropdowns below stats |
| Add team members | People icon in header |
| Refresh data | Circular arrow icon in header |
| Lock dashboard | Lock icon in header |

---

## Troubleshooting

**Workflow fails with auth error** — Double-check that all 4 secrets are set correctly. The refresh token expires if you revoke access; re-run the OAuth flow to get a new one.

**No tasks appear after first sync** — Check the workflow logs (Actions tab). If emails were processed, wait ~5 minutes for GitHub Pages CDN to update the `tasks.json` URL.

**Pattern forgotten** — Click "Reset Pattern" on the lock screen. This clears the stored hash and prompts you to set a new pattern.

**Tasks missing from email** — The sync skips newsletters, promotional emails, and no-reply senders. Only emails in the Primary/inbox category are processed.
