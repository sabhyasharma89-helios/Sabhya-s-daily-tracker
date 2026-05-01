# Sabhya's Daily Tracker — Complete Setup Guide

## What this is

A self-hosted, pattern-locked task dashboard that automatically reads your Gmail every 10 minutes, extracts client tasks using Claude AI, and keeps a persistent database of all your work — all hosted free on GitHub Pages with GitHub Actions as the processing engine.

---

## Architecture Overview

```
Gmail ──► GitHub Actions (every 10 min) ──► Claude AI ──► data/tasks.json ──► GitHub Pages
                                                                                     ▲
                                                                              Your Browser
                                                                         (IndexedDB + Pattern Lock)
```

---

## Step 1: Enable GitHub Pages

1. Go to your repository on GitHub
2. **Settings → Pages**
3. Source: **Deploy from a branch**
4. Branch: **main** (or whichever branch you are using), folder: `/ (root)`
5. Click **Save**
6. Your tracker URL will be: `https://sabhyasharma89-helios.github.io/sabhya-s-daily-tracker/`

> **Note:** The repository must be **public** for free GitHub Pages, or you need GitHub Pro/Team for private repo Pages.

---

## Step 2: Set Up Gmail API Access

### 2a. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (e.g. "Sabhya Tracker")
3. In the left menu: **APIs & Services → Library**
4. Search for **Gmail API** and click **Enable**

### 2b. Create OAuth Credentials

1. **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. If prompted to configure consent screen:
   - User type: **External**
   - App name: "Sabhya Tracker"
   - Add your Gmail address as test user
4. Application type: **Desktop app**
5. Name it anything (e.g. "Tracker Desktop")
6. Click **Create**, then **Download JSON**
7. Rename the downloaded file to `credentials.json`
8. Place it in the `scripts/` folder of this repo (do **not** commit it — it's gitignored)

### 2c. Run the Setup Script

```bash
# Install dependencies
pip install -r scripts/requirements.txt

# Run the OAuth flow (opens browser)
python scripts/setup_gmail.py
```

This opens a browser window asking for Gmail permission. After you allow it, the script prints a JSON token. **Copy that entire JSON output.**

---

## Step 3: Add GitHub Secrets

Go to your repository → **Settings → Secrets and variables → Actions → New repository secret**

Add these two secrets:

| Secret Name | Value |
|-------------|-------|
| `GMAIL_TOKEN` | The JSON printed by `setup_gmail.py` |
| `ANTHROPIC_API_KEY` | Your key from [console.anthropic.com](https://console.anthropic.com) |

> `GITHUB_TOKEN` is automatically available — you don't need to add it.

---

## Step 4: Get Your GitHub Personal Access Token (for write-back sync)

The dashboard needs to write your preference changes (priority overrides, assignee changes) back to the repo.

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
2. **Token name:** "Sabhya Tracker UI"
3. **Expiration:** No expiration (or 1 year)
4. **Repository access:** Only select repositories → choose this repo
5. **Permissions → Contents:** Read and write
6. **Permissions → Actions:** Read and write (to trigger manual syncs)
7. Click **Generate token** and copy it

You'll enter this token in the tracker's setup wizard (it's stored encrypted with your pattern).

---

## Step 5: Open the Tracker and Complete Setup

1. Open your GitHub Pages URL (from Step 1)
2. **First time:** You'll see a setup wizard:
   - **Draw a pattern** on the 3×3 grid (connect at least 4 dots) — this is your unlock code
   - **Confirm** by drawing the same pattern again
   - Enter your **GitHub owner** (e.g. `sabhyasharma89-helios`), **repo name**, **branch**, and the **Personal Access Token** from Step 4
   - Optionally add **team members** (you can add more in Settings later)
3. The dashboard opens. The first GitHub Actions run will read your last 30 days of emails.
4. Wait ~10 minutes for the first email processing run.

---

## Step 6: Trigger First Run Manually (Optional)

Don't want to wait? Trigger the workflow immediately:

1. Go to your repo → **Actions** tab
2. Click **Process Emails** in the left sidebar
3. Click **Run workflow → Run workflow**

Or use the **🔄 Sync** button in the tracker (requires the PAT from Step 4).

---

## How It Works

### Email Processing (GitHub Actions)
- Runs automatically every **10 minutes** via cron
- First run reads **30 days** of emails
- Subsequent runs read only **new emails since last run**
- Each email thread is analyzed by **Claude AI** which extracts:
  - Client/company name
  - Task title and priority (urgent/medium/low)
  - Specific actionable items
  - Who is responsible for next steps
  - Thread summary
  - Whether the task is completed
- Results are stored in `data/tasks.json` and committed to the repo

### Dashboard (GitHub Pages)
- Your browser fetches `data/tasks.json` from the repo
- IndexedDB stores all data locally for offline access
- Your changes (priority edits, assignments) are pushed back to `data/user_data.json` via GitHub API
- The dashboard syncs/polls every 5 minutes for updates from Actions

### Pattern Lock Security
- Your unlock pattern is stored as a SHA-256 hash in localStorage
- Your GitHub token is encrypted with AES-256-GCM using your pattern hash as the key
- Nobody can access your data or GitHub token without knowing your pattern

---

## Features Guide

| Feature | How to use |
|---------|-----------|
| Unlock | Draw your pattern on the grid |
| Change pattern | Settings (⚙️) → Change Pattern |
| Add task manually | Click the **+** button (bottom right) |
| Edit task | Open task → click **✏️ Edit** |
| Complete task | Click the checkbox on any task card, or open task → **✅ Mark Complete** |
| Uncheck completed | Open completed section (bottom) → click checkbox to move back to pending |
| Change priority | Open task → use priority dropdown in footer |
| Assign employee | Open task → use assignee dropdown in footer |
| Search | Type in the search bar (searches title, client, summary, actionables) |
| Filter by status | Use filter chips: All / Pending / Urgent / Medium / Low / Completed |
| Filter by employee | Use the "All Assignees" dropdown |
| Filter by client | Use the "All Clients" dropdown |
| Collapse client | Click the client header to collapse/expand |
| Reorder clients | Clients are sorted by number of urgent tasks, then alphabetically (manual reorder coming soon) |
| Add team member | Settings → Team Members → Add |
| Force sync | Click **🔄** in the header, or Settings → Sync Now |
| Lock screen | Click **🔒** in the header |

---

## Data Persistence

- **`data/tasks.json`** — master task database, updated by GitHub Actions every 10 min; never deleted, always accumulates
- **`data/user_data.json`** — your preferences, overrides, employee list; updated by the browser
- **IndexedDB** — local browser cache; merged with GitHub data on each sync
- Tasks are **never automatically deleted** — completed tasks are kept in the Completed section

---

## Troubleshooting

**Tasks not appearing after setup:**
- Wait 10 minutes for the first Actions run, or trigger manually (Actions tab → Process Emails → Run workflow)
- Check Actions tab for any red ❌ failures

**"GMAIL_TOKEN not set" error in Actions:**
- Re-run `setup_gmail.py` and update the `GMAIL_TOKEN` secret

**Gmail token expired:**
- Refresh tokens last indefinitely unless revoked. If it stops working, re-run `setup_gmail.py`

**Sync shows "Offline" or "Sync failed":**
- Check your GitHub token in Settings — it may have expired
- Ensure the repo is public (or you have appropriate GitHub plan for private Pages)

**Pattern forgotten:**
- Clear localStorage for the site (browser DevTools → Application → Local Storage → Clear)
- This resets auth and you'll set a new pattern; your task data in IndexedDB is preserved

---

## .gitignore additions recommended

Add to your `.gitignore`:
```
scripts/credentials.json
scripts/token.json
```
