# Sabhya's Daily Tracker — Setup Guide

## How it works

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | GitHub Pages (HTML/CSS/JS) | Dashboard UI |
| **Database** | JSON files in `/data/` | Persistent task storage |
| **Sync engine** | GitHub Actions (Python) | Reads Gmail every 10 min |
| **AI processor** | Claude API (claude-sonnet-4-6) | Understands emails → tasks |
| **Auth** | Pattern lock (localStorage) | Protects the dashboard |

---

## Step 1 — Enable GitHub Pages

1. Go to your repository → **Settings → Pages**
2. Under *Source*, choose **Deploy from a branch**
3. Branch: `main` | Folder: `/ (root)`
4. Click **Save**
5. Your URL will be `https://<username>.github.io/<repo-name>/`

---

## Step 2 — Get Gmail API credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Gmail API** (`APIs & Services → Enable APIs`)
4. Go to `APIs & Services → Credentials → Create Credentials → OAuth client ID`
5. Application type: **Desktop app**
6. Download the `client_secret_*.json` file

---

## Step 3 — Get your Refresh Token (run once locally)

```bash
pip install google-auth-oauthlib
python scripts/get_gmail_token.py
```

- A browser window will open — sign in with your Gmail account
- Grant the requested read-only permission
- The script prints your `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN`

---

## Step 4 — Add GitHub Secrets

Go to: **Repository → Settings → Secrets and variables → Actions → New repository secret**

Add these four secrets:

| Secret Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | From Step 3 output |
| `GMAIL_CLIENT_SECRET` | From Step 3 output |
| `GMAIL_REFRESH_TOKEN` | From Step 3 output |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com/) |

---

## Step 5 — First run

1. Go to **Actions** tab in your repo
2. Click **Email Sync - Task Tracker**
3. Click **Run workflow** → enable **Force full 30-day sync** → **Run workflow**
4. This first run reads all emails from the last 30 days and builds your task database
5. After that, the workflow runs automatically every 10 minutes

---

## Step 6 — Open your dashboard

Visit `https://<username>.github.io/<repo-name>/`

On first visit, draw a pattern (connect at least 4 dots) to set your lock.  
Every subsequent visit will require your pattern to unlock.

---

## Features at a glance

| Feature | How to use |
|---|---|
| **View by client** | Dashboard → expandable client sections |
| **Filter tasks** | Use chips (Urgent/Medium/Low) or dropdowns |
| **Search** | Search bar at the top |
| **Add task** | `+ Add Task` button |
| **Change priority** | Click any task → change in detail modal → Save |
| **Assign employee** | Click task → Assign To dropdown → Save |
| **Mark complete** | Click the circle checkbox on any task card |
| **Reopen task** | Completed view → click the filled checkbox |
| **Move client tabs** | Drag & drop client sections to reorder |
| **Add employee** | Sidebar → Add Employee |
| **Add client** | Clients view → + Add Client |
| **Lock screen** | Sidebar → Lock Screen |
| **Change pattern** | Lock Screen → Set New Pattern |

---

## Data persistence model

- **Email-sourced tasks**: stored in `data/tasks.json` (committed by GitHub Actions)
- **Manually created tasks**: stored in browser `localStorage`
- **Manual edits** (priority, assignee, status): stored in `localStorage` as overrides
- **Client/employee order**: stored in `localStorage`
- Data is **never deleted** — completed tasks stay in the Completed tab forever

---

## Troubleshooting

**Workflow fails with auth error** → Re-run `get_gmail_token.py` and update the secrets (refresh tokens can expire if not used for 6 months).

**No tasks appearing** → Trigger the workflow manually with *Force full sync* enabled.

**Pattern not working** → Open browser DevTools → Application → Local Storage → clear `sdt_pattern_hash` to reset.

**Tasks not updating** → The dashboard auto-refreshes every 5 minutes. Hard reload (Ctrl+Shift+R) forces an immediate refresh.
