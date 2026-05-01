# Sabhya's Daily Task Tracker

A smart, AI-powered task tracker that automatically reads your Gmail, extracts action items using Claude AI, and organises everything by client — with pattern-lock security.

---

## Features

- **Pattern-lock authentication** — visual unlock pattern; no one can see your dashboard without it
- **Auto email processing** — polls Gmail every 10 minutes, reads new emails, creates / updates tasks
- **AI-powered extraction** — Claude AI reads each email thread and identifies: client name, task, priority, actionables, responsible person, and completion status
- **Client-organised dashboard** — expandable sections per client, colour-coded
- **Priority management** — Urgent / Medium / Low with visual indicators
- **Task details** — full email thread view, AI-generated summary, actionables list
- **Employee assignment** — assign tasks to team members; filter by assignee
- **Search & filter** — by status, priority, client, assignee, or free text
- **Statistics** — live counts for total / pending / urgent / medium / low / completed
- **Persistent database** — IndexedDB; data never deleted, survives tab closes
- **First run** — automatically processes last 30 days of emails
- **Export / Import** — JSON backup and restore
- **Fully responsive** — works on mobile, tablet, and desktop
- **GitHub Pages hosted** — no server needed

---

## Setup (5 minutes)

### 1 — Fork & Enable GitHub Pages

1. Fork this repository to your GitHub account
2. Go to **Settings → Pages → Source** → choose `main` branch, `/ (root)` folder
3. Note your Pages URL: `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`

---

### 2 — Create a Google Cloud OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. **APIs & Services → Library** → Enable **Gmail API**
4. **APIs & Services → OAuth consent screen**
   - Type: **External**; add your email; add scopes: `gmail.readonly`, `userinfo.email`
   - Add yourself as a **Test User**
5. **APIs & Services → Credentials → Create → OAuth client ID**
   - Type: **Web application**
   - Authorised JS origins: `https://YOUR-USERNAME.github.io`
   - Authorised redirect URIs: `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/oauth-callback.html`
6. Copy the **Client ID**

---

### 3 — Get an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. **API Keys → Create Key** → copy it (starts with `sk-ant-…`)

> Keys are stored only in your browser's IndexedDB and sent only to their respective APIs. Nothing is shared elsewhere.

---

### 4 — First Open

1. Open your GitHub Pages URL
2. **Step 1** — Draw and confirm your unlock pattern (≥ 4 dots)
3. **Step 2** — Paste Anthropic API Key and Google Client ID
4. **Step 3** — Click "Connect Gmail Account" and authorise the popup
5. The tracker processes the last 30 days of emails automatically

---

## Usage

| Action | How |
|--------|-----|
| Unlock | Draw your pattern on the lock screen |
| Sync emails | Click ↻ or wait for auto-poll (default 10 min) |
| View task detail | Click any task card → "View Details" |
| Mark complete | Click the checkbox on any task card |
| Change priority | Expand task card → cycle priority button |
| Assign employee | Expand task card → Assign button |
| Add task manually | Click the + icon |
| Search / filter | Click 🔍 icon |
| View completed tasks | Scroll to "Completed Tasks" section at bottom |
| Change settings | Click ⚙ icon |
| Export backup | Settings → Export JSON |

---

## Architecture

```
Browser only — no server required
├── IndexedDB          ← persistent task/client/email database
├── Gmail REST API v1  ← read emails (OAuth 2.0 implicit flow)
├── Anthropic API      ← Claude Haiku for AI email analysis
└── GitHub Pages       ← static hosting
```

Polling runs while the browser tab is open. On next open, if ≥ poll interval has passed since last sync, it catches up automatically.

---

## Privacy

- All data stored exclusively in your browser (IndexedDB)
- API keys stored locally; sent only to `api.anthropic.com` and Gmail API
- No data ever sent to any third-party server
