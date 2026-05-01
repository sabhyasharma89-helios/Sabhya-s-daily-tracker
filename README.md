# Sabhya's Daily Task Tracker

An intelligent, email-driven task manager — hosted on GitHub Pages, powered by Gmail + Claude AI.

---

## What it does

- Reads your Gmail every 10 minutes via GitHub Actions
- Uses Claude AI to identify clients, extract tasks, priorities, and summaries from each email thread
- Displays tasks grouped by client in a mobile-responsive, pattern-locked dashboard
- Persists data forever in this repository — nothing is ever deleted

---

## One-time Setup (15 minutes)

### Step 1 — Enable GitHub Pages

1. Go to **Settings → Pages** in this repo
2. Set **Source** to `Deploy from a branch`
3. Set **Branch** to `main`, folder `/` (root)
4. Save — your dashboard URL will appear (e.g. `https://sabhyasharma89-helios.github.io/sabhya-s-daily-tracker/`)

---

### Step 2 — Google Cloud Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Task Tracker")
3. Go to **APIs & Services → Enable APIs** → enable **Gmail API**
4. Go to **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Download the JSON file — rename it `credentials.json`
5. Go to **OAuth consent screen** → add your Gmail address as a **Test user**

---

### Step 3 — Generate Gmail Token (run locally once)

```bash
pip install google-auth-oauthlib
python scripts/setup_gmail.py
```

- Enter the path to your `credentials.json` when prompted
- A browser window opens — sign in and allow access
- `token.json` is created in the current directory

---

### Step 4 — Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name          | Value                                  |
|----------------------|----------------------------------------|
| `GMAIL_CREDENTIALS`  | Entire contents of `credentials.json` |
| `GMAIL_TOKEN`        | Entire contents of `token.json`        |
| `ANTHROPIC_API_KEY`  | Your key from [console.anthropic.com](https://console.anthropic.com) |

---

### Step 5 — First Run (process last 30 days)

1. Go to **Actions → Email Task Processor**
2. Click **Run workflow**
3. Check **"Process last 30 days (first-time setup)"** → Run
4. Wait ~2 minutes for it to complete
5. Open your GitHub Pages URL

---

### Step 6 — Dashboard Setup

1. Open your GitHub Pages URL
2. **Draw a pattern** on the 3×3 grid to set your unlock pattern (minimum 4 dots)
3. Confirm the pattern when prompted
4. Click the ⚙ **Settings** icon → enter:
   - **GitHub PAT** (create at github.com/settings/tokens with `repo` scope) — enables writing task changes back to the repo
   - **Repository**: `sabhyasharma89-helios/sabhya-s-daily-tracker`
   - **Branch**: `main`
5. Add your **team members** in Settings

---

## Using the Dashboard

| Feature | How to use |
|---------|-----------|
| **Unlock** | Draw your pattern on the lock screen |
| **View tasks by client** | Click client tabs |
| **Expand a task** | Click on the task row |
| **Mark complete** | Check the checkbox |
| **Change priority** | Priority dropdown on task row |
| **Assign to team member** | Assignee dropdown on task row |
| **Add task manually** | **+ Task** button in header |
| **Search** | Type in the search bar |
| **Filter** | Priority / assignee dropdowns |
| **View completed tasks** | Toggle the **Completed** switch |
| **Reopen a completed task** | Uncheck its checkbox |
| **Full email thread** | Expand task → click 👁 icon |
| **Reset pattern** | ⚙ Settings → Reset Pattern |

---

## Architecture

```
GitHub Actions (every 10 min)
    ↓ Gmail API → new emails
    ↓ Claude AI → client name, tasks, priority, summary
    ↓ writes data/tasks.json + merges user changes
    ↓ commits & pushes
        ↓
GitHub Pages serves index.html + data/tasks.json
        ↓
Browser → renders dashboard (IndexedDB cache + localStorage)
        ↓
User changes → localStorage + GitHub API → data/user_updates.json
        ↓
Next Actions run merges user_updates into tasks.json
```

---

## Troubleshooting

**Actions not running?**  
GitHub pauses scheduled workflows after 60 days of inactivity. Go to Actions and re-enable.

**Token expired?**  
Run `python scripts/setup_gmail.py` again and update the `GMAIL_TOKEN` secret.

**Changes not syncing across devices?**  
Enter a GitHub PAT in Settings. Without it, changes are local-only.

**Pattern forgotten?**  
Clear `sdt_pattern_hash` from browser localStorage → page reloads in setup mode.
