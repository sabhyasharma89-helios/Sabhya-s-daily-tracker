# Sabhya's Daily Task Tracker — Setup Guide

A fully automated, AI-powered email task tracker hosted on GitHub Pages.

---

## How it works

1. **GitHub Actions** runs every 10 minutes, reads your Gmail, and uses Claude AI to extract tasks.
2. Tasks are stored in `data/tasks.json` (version-controlled — never lost).
3. The **GitHub Pages web app** displays your tasks with pattern-lock authentication.

---

## Step 1 — Enable GitHub Pages

In your repo on GitHub:
- Go to **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: `main` / root (`/`)
- Save → your app will be live at `https://<username>.github.io/<repo-name>/`

---

## Step 2 — Get a GitHub Personal Access Token (PAT)

The dashboard reads/writes `data/tasks.json` and triggers syncs via the GitHub API.

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. **New token** → select your repo → grant:
   - **Contents**: Read and Write
   - **Actions**: Read and Write (for triggering syncs)
3. Copy the token — you'll enter it during first-time app setup.

---

## Step 3 — Get Gmail OAuth credentials

Run this **once** on your local machine:

```bash
pip install google-auth-oauthlib
python scripts/get_gmail_token.py
```

Follow the browser prompt to sign in with your Gmail account.
The script prints three values: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

### Google Cloud setup (if you haven't already)
1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project → **Enable APIs → Gmail API**
3. **Credentials → Create Credentials → OAuth 2.0 Client ID** → Application type: **Desktop app**
4. Download or copy the Client ID and Secret

---

## Step 4 — Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. **API Keys → Create Key**
3. Copy the key (starts with `sk-ant-…`)

---

## Step 5 — Add GitHub Secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name          | Value                          |
|----------------------|--------------------------------|
| `GMAIL_CLIENT_ID`    | From Step 3                    |
| `GMAIL_CLIENT_SECRET`| From Step 3                    |
| `GMAIL_REFRESH_TOKEN`| From Step 3                    |
| `ANTHROPIC_API_KEY`  | From Step 4                    |

---

## Step 6 — Open the web app

Navigate to `https://<username>.github.io/<repo-name>/` and follow the on-screen wizard:
1. Enter your GitHub PAT and repo details
2. Draw your unlock pattern (minimum 4 dots)
3. Add the GitHub secrets when prompted

The **first run** of the GitHub Action will process the last 30 days of email and create tasks.
Subsequent runs (every 10 minutes) will only process new emails.

---

## GitHub Actions minutes

- **Public repos**: Unlimited minutes ✅
- **Private repos (free tier)**: 2,000 min/month. At ~2 min/run × 144 runs/day this will exceed the free limit.
  - **Recommended**: Change cron to `*/30 * * * *` (every 30 min) for ~1,500 min/month.
  - Or upgrade to GitHub Pro ($4/mo) for 3,000 min/month.

---

## Manual sync

Click the **⟳** button in the dashboard header to trigger an immediate email sync via `workflow_dispatch`.

---

## Data safety

- `data/tasks.json` is committed to git — every change is version-controlled and recoverable.
- The data is **never automatically deleted**.
- If the AI marks a task complete that you want to reopen, just click its checkbox in the Completed section.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Actions not running | Check repo Settings → Actions → Allow all actions |
| Gmail auth error | Re-run `get_gmail_token.py` and update `GMAIL_REFRESH_TOKEN` secret |
| "Repository not found" in app | Verify PAT has `repo` scope and the owner/repo name is correct |
| Tasks not appearing | Check Actions tab for workflow run logs |
| Pattern forgotten | Use "Forgot pattern? Reset everything" on the lock screen |
