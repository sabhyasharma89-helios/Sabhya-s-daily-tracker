# Sabhya's Daily Tracker

An AI-powered email task tracker that automatically reads your Gmail, extracts tasks using Claude AI, and presents them in a beautiful, mobile-responsive dashboard hosted on GitHub Pages.

---

## Features

- **Pattern-lock authentication** — 3×3 dot pattern protects your dashboard
- **Auto email sync every 10 minutes** — GitHub Actions reads Gmail continuously
- **AI task extraction** — Claude analyses every email thread and creates/updates tasks
- **Client-grouped tasks** — Expandable tabs per client with drag-to-reorder
- **Priority system** — Urgent / Medium / Low with colour-coded indicators
- **Full email thread summary** — Click any task to see the full conversation + actionables
- **Auto task closure** — Claude detects resolved threads and marks them complete
- **Employee assignment and filtering** — Assign tasks to team members, filter by assignee
- **Search** — Full-text search across all tasks
- **Persistent data** — Firebase Firestore; data is never deleted
- **First run** — Processes last 30 days of emails on first launch
- **Mobile responsive** — Works on phone, tablet and desktop

---

## Architecture

```
GitHub Pages (index.html)         <- your browser dashboard
      |
      v real-time
Firebase Firestore (database)     <- tasks, clients, employees, config
      ^
      | writes every 10 min
GitHub Actions (scheduled)
      |
      +-- Gmail API               <- reads your inbox
      +-- Claude API (Anthropic)  <- analyses threads -> extracts tasks
```

---

## Quick Setup (~10 minutes)

Open `setup.html` in your browser and follow the 5-step wizard, or follow the steps below.

### Step 1 — Firebase

1. Go to **console.firebase.google.com** → Add project → name it `daily-tracker`.
2. Enable **Firestore Database** (Production mode, choose region near you).
3. **Project Settings → Service Accounts → Generate new private key** → save JSON. This becomes the `FIREBASE_SERVICE_ACCOUNT` secret.
4. **Project Settings → Add app → Web** → register → copy the `firebaseConfig` object.
5. Open `index.html`, find the `FIREBASE_CONFIG` block (line ~75) and replace the placeholder values with your actual Firebase config.

**Firestore Security Rules** (Firestore → Rules tab — paste and publish):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

### Step 2 — Gmail API

1. **console.cloud.google.com** → Enable **Gmail API**.
2. **Credentials → Create Credentials → OAuth client ID → Desktop app** → download `client_secret.json`.
3. Configure OAuth consent screen: External, add your email as a test user.
4. Run this locally to generate a token:

```bash
pip install google-auth-oauthlib
python3 -c "
from google_auth_oauthlib.flow import InstalledAppFlow
import json
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
flow = InstalledAppFlow.from_client_secrets_file('client_secret.json', SCOPES)
creds = flow.run_local_server(port=0)
token = {
    'token': creds.token,
    'refresh_token': creds.refresh_token,
    'token_uri': creds.token_uri,
    'client_id': creds.client_id,
    'client_secret': creds.client_secret,
    'scopes': creds.scopes,
}
print(json.dumps(token, indent=2))
"
```

The printed JSON becomes the `GMAIL_TOKEN_JSON` secret.

### Step 3 — Claude API Key

1. **console.anthropic.com** → API Keys → Create Key.
2. Copy the key (starts `sk-ant-…`). This becomes `ANTHROPIC_API_KEY`.

### Step 4 — GitHub Secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Full contents of Firebase service account JSON |
| `GMAIL_TOKEN_JSON` | JSON output from the OAuth script above |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `FIRST_RUN` | `true` — set for first deployment, delete after first run |

### Step 5 — GitHub Pages

Repository → **Settings → Pages → Source: Deploy from a branch → main / (root)** → Save.

Your dashboard URL: `https://<username>.github.io/<repo-name>/`

### Step 6 — Trigger First Run

1. Go to **Actions tab → Email Task Processor → Run workflow**.
2. Set "First run?" to `true` → Run.
3. This processes your last **30 days** of emails — may take a few minutes.
4. After it completes, **delete the `FIRST_RUN` secret** so subsequent runs are incremental.

---

## Using the Dashboard

### Unlock
Draw your pattern on the 3×3 grid. First visit: draw twice to set the pattern.

### Navigation
- **Left sidebar** — client list; click any to filter tasks; drag rows to reorder.
- **Filter chips** — All / Urgent / Medium / Low / Assigned.
- **Search bar** — searches title, client name, summary, assignee.
- **Assignee dropdown** — filter by team member.

### Tasks
- **Click a task** → detail modal: AI summary, actionables, responsible person, full thread recap.
- **Checkbox** → toggles complete / pending instantly.
- **Completed tasks** → collapse to the "Completed Tasks" section at the bottom.
- **Uncheck** a completed task → moves it back to active.

### Adding Tasks Manually
Click **"+ Add Task"** in the content header. Fill in client, title, priority, etc.

### Managing Team Members
Click **"Manage Team"** at the bottom of the sidebar. Add or remove employees.

### Adding Clients
Click **+** next to "Clients" in the sidebar header.

---

## Email Processing Logic

1. **Fetch** new emails since last run (or last 30 days on first run).
2. **Skip** automated / newsletter senders.
3. **Fetch** the full thread for each new message.
4. **Claude** analyses each thread and returns: client name, task title, summary, actionables, responsible person, priority, status (open/closed), full thread narrative.
5. **Upsert** — creates a new task or updates the existing one for the same thread.
6. **Timestamp** — records the newest email time for the next 10-minute cycle.

**Preserves your edits:** Claude never reduces priority if you manually upgraded it. `assignedTo` set by you is preserved across AI updates.

---

## Cost Estimates

| Service | Free Tier | Estimated Monthly Cost |
|---|---|---|
| Firebase Firestore | 1 GB / 50K reads / 20K writes per day | $0 |
| GitHub Actions | Unlimited for public repos | $0 |
| Gmail API | 1B quota units/day | $0 |
| Claude API | — | ~$3–$8/month depending on email volume |

---

## Troubleshooting

**Tasks not appearing**
- Check GitHub Actions logs (Actions tab → Email Task Processor).
- Verify all 3 secrets are set correctly.
- Make sure Firebase config in `index.html` has your real project values.

**Pattern forgotten**
- Open browser console on the dashboard → `localStorage.removeItem('tracker_pattern_hash')` → refresh → set a new pattern.

**Gmail token expired**
- Re-run the OAuth script to generate a fresh token, then update the `GMAIL_TOKEN_JSON` secret.

**Firebase permission denied**
- Check Firestore Security Rules allow read/write (see Step 1 above).

---

## File Structure

```
.
+-- index.html                     Main dashboard (single-page app)
+-- setup.html                     One-time setup wizard
+-- css/
|   +-- style.css                  All styles, responsive
+-- js/
|   +-- auth.js                    Pattern lock authentication
|   +-- db.js                      Firebase Firestore operations
|   +-- ui.js                      UI rendering, modals, toasts
|   +-- app.js                     Main app orchestrator
+-- scripts/
|   +-- process_emails.py          Email processor (runs in GitHub Actions)
|   +-- requirements.txt           Python dependencies
+-- .github/
    +-- workflows/
        +-- email-processor.yml    Scheduled workflow (every 10 minutes)
```
