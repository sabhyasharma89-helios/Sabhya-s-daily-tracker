# Sabhya's Daily Tracker – Setup Guide

## What this is

A fully automated email-driven task tracker that:
- Reads your Gmail every 10 minutes via a GitHub Actions workflow
- Uses Claude AI to extract client names, tasks, priorities and summaries from email threads
- Displays everything in a mobile-responsive, pattern-locked dashboard hosted on GitHub Pages
- Stores all data as JSON files in this repo – no external database required

---

## Architecture

```
GitHub Pages (index.html)        GitHub Actions (every 10 min)
        │                                   │
        │  reads tasks.json                 │  Gmail API → Claude → writes tasks.json
        ▼                                   ▼
  data/tasks.json  ◄──────────────────────────────────────────────
  data/email_state.json
```

---

## Step 1 – Fork this repository

1. Click **Fork** on GitHub.
2. In your fork go to **Settings → Pages** and set Source to `main` branch, root `/`.
3. Note your Pages URL: `https://<your-username>.github.io/<repo-name>/`

---

## Step 2 – Enable Gmail API & get credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Create a new project (or use an existing one).
3. Go to **APIs & Services → Library** → search "Gmail API" → Enable it.
4. Go to **APIs & Services → OAuth consent screen**:
   - User type: **External** → fill in app name, your email, and save.
   - Add scope: `.../auth/gmail.readonly`
   - Add your Gmail address as a test user.
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Desktop app**
   - Name: "Daily Tracker"
   - Click **Create** and **download the JSON** file (`credentials.json`).

---

## Step 3 – Obtain the refresh token (run once locally)

```bash
# Clone your fork
git clone https://github.com/<you>/<repo>.git
cd <repo>

# Install Python dependencies
pip install -r scripts/requirements.txt

# Place the downloaded credentials.json in scripts/
cp ~/Downloads/credentials.json scripts/credentials.json

# Run the auth helper – a browser window will open
python scripts/setup_gmail_auth.py
```

The script will print two JSON blocks and ask you to copy them into GitHub Secrets.

---

## Step 4 – Add GitHub Secrets

In your forked repo go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name          | Value                                                     |
|----------------------|-----------------------------------------------------------|
| `GMAIL_CREDENTIALS`  | Full content of `credentials.json` (the downloaded file) |
| `GMAIL_TOKEN`        | The token JSON printed by `setup_gmail_auth.py`           |
| `ANTHROPIC_API_KEY`  | Your key from https://console.anthropic.com               |

> **Security note:** These secrets are encrypted by GitHub and only accessible to Actions runners. They are never visible in logs or to anyone without admin access.

---

## Step 5 – Trigger the first run

1. Go to **Actions** tab in your repo.
2. Click **Process Emails & Update Tasks**.
3. Click **Run workflow** → check **"Re-process last 30 days"** → **Run workflow**.
4. Wait ~2 minutes for it to complete.
5. The workflow will commit updated `data/tasks.json` to your repo.

> **Note:** GitHub Actions schedules run every 10 minutes automatically after that.

---

## Step 6 – Configure the dashboard

Open your GitHub Pages URL, then:

1. **Set your unlock pattern** on the pattern lock screen (first visit only).
   - Draw through at least 4 dots to create your pattern.
   - Confirm by drawing it again.

2. Click the **⚙ Settings** icon in the top-right and:
   - Enter your **GitHub Personal Access Token** (needs `repo` scope) so the dashboard can save task changes.
     - Create one at: **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
     - Check `repo` scope → Generate → copy the token.
   - Verify the **Repository** field shows `<your-username>/<repo-name>`.
   - Add your **team member names** in the Employees section.

---

## Using the Dashboard

### Viewing tasks
- Tasks are grouped by **client name** in collapsible sections.
- Within each client, tasks are sorted: Urgent → Medium → Low.
- Click any task card or the **▼** arrow to expand and see the full email thread summary.

### Changing task priority
- Expand a task and use the **Priority** dropdown.

### Assigning a task
- Expand a task and type/select a name in the **Assign** field.

### Completing a task
- Click the **circle** on the left of any task to mark it complete.
- Completed tasks move automatically to the collapsed **Completed Tasks** section.
- To move a completed task back to pending, click its circle again.

### Re-ordering client tabs
- Grab the **⋮⋮** drag handle on the left of any client section header and drag to reorder.

### Filtering & searching
- Use the **search bar** to find by keyword (title, client, assignee).
- Use the dropdowns to filter by status, priority, or assigned employee.
- Click the stat chips (Urgent / Medium / Low) to quick-filter by priority.

### Adding a manual task
- Click the **+** floating button at the bottom right.

---

## Frequently Asked Questions

**Q: How do I change my unlock pattern?**
Settings → Security → Change Unlock Pattern.

**Q: What happens if GitHub Actions is delayed?**
GitHub may delay scheduled actions by up to 15 minutes during high load. This is normal.

**Q: Can I run more than every 10 minutes?**
GitHub's minimum cron interval is 5 minutes (`*/5 * * * *`). Edit the workflow YAML if you need faster updates.

**Q: Will old tasks ever be deleted?**
No. The script only adds new tasks or updates existing ones. Completed tasks remain forever in the database.

**Q: The dashboard shows old data. How do I force refresh?**
Click the **↻** refresh button in the header, or wait up to 5 minutes (CDN cache clears).

**Q: My token was rejected. What scopes do I need?**
Your GitHub PAT needs only the `repo` scope (full control of private repositories).

---

## File Structure

```
/
├── index.html                    # Dashboard UI
├── css/styles.css                # All styling
├── js/
│   ├── config.js                 # GitHub repo config
│   ├── auth.js                   # Pattern lock
│   ├── storage.js                # GitHub API read/write
│   ├── tasks.js                  # Task business logic
│   ├── ui.js                     # Rendering & events
│   └── app.js                    # Entry point
├── data/
│   ├── tasks.json                # Task database (auto-updated)
│   └── email_state.json          # Email processing state
├── scripts/
│   ├── process_emails.py         # Gmail → Claude → tasks
│   ├── requirements.txt          # Python dependencies
│   └── setup_gmail_auth.py       # One-time OAuth setup helper
└── .github/workflows/
    └── email-processor.yml       # Scheduled GitHub Actions workflow
```

---

## Privacy & Security

- The dashboard is **pattern-locked** – no one without the pattern can view your tasks.
- Your Gmail is accessed **read-only** – the app never sends, deletes, or modifies emails.
- Your GitHub PAT is stored in **browser localStorage only** – it never leaves your device.
- All processing happens in your own GitHub Actions runner and your own repo.
- Email content is sent to **Anthropic's API** for analysis. Review [Anthropic's privacy policy](https://www.anthropic.com/privacy) if this is a concern. You can replace the model call with a local LLM if needed.
