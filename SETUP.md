# Sabhya's Daily Tracker — Setup Guide

## Overview

This tracker has two parts:
1. **Frontend** — a GitHub Pages web app (HTML/CSS/JS) with pattern-lock authentication
2. **Backend** — a GitHub Actions workflow that reads Gmail every 10 minutes, processes emails with Claude AI, and updates `data/email_updates.json`

---

## Step 1 — Enable GitHub Pages

1. Go to your repository → **Settings** → **Pages**
2. Under **Source**, select **Deploy from a branch**
3. Choose **main** branch, **/ (root)** folder
4. Click **Save**

Your tracker will be live at: `https://sabhyasharma89-helios.github.io/Sabhya-s-daily-tracker/`

---

## Step 2 — Get Gmail OAuth Credentials

### 2a. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the **Gmail API**: APIs & Services → Library → search "Gmail API" → Enable

### 2b. Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Desktop app**
3. Name it anything (e.g. "Tracker")
4. Download the JSON file — note `client_id` and `client_secret`

### 2c. Get a Refresh Token

Run this locally (one-time only):

```bash
pip install google-auth-oauthlib
```

Create `get_token.py`:

```python
from google_auth_oauthlib.flow import InstalledAppFlow

flow = InstalledAppFlow.from_client_secrets_file(
    'credentials.json',  # your downloaded JSON
    scopes=['https://www.googleapis.com/auth/gmail.readonly']
)
creds = flow.run_local_server(port=0)
print('REFRESH TOKEN:', creds.refresh_token)
```

Run it: `python get_token.py`  
A browser window will open — sign in with your Gmail account and grant permission.  
Copy the **refresh token** printed to the terminal.

---

## Step 3 — Add GitHub Secrets

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these four secrets:

| Secret Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | From your OAuth credentials JSON |
| `GMAIL_CLIENT_SECRET` | From your OAuth credentials JSON |
| `GMAIL_REFRESH_TOKEN` | The refresh token from Step 2c |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) |

---

## Step 4 — First Run

1. Go to **Actions** tab in your repository
2. Click **Email Processor** → **Run workflow**
3. This first run will scan the last 30 days of emails and create all initial tasks
4. After that, it runs automatically every 10 minutes

---

## Step 5 — Open the Dashboard

1. Visit your GitHub Pages URL
2. On first visit, draw a pattern (minimum 4 dots) to set your unlock pattern
3. Draw it again to confirm
4. You're in!

---

## Notes

- **Data persistence**: All task data is stored in `localStorage` (browser) and `data/email_updates.json` (repo). Tasks are never deleted automatically.
- **Email polling**: GitHub Actions minimum interval is 5 minutes; the workflow is set to 10 minutes.
- **Actions minutes**: The free GitHub plan includes 2,000 minutes/month. At ~1 min per run × 144 runs/day, this uses ~4,300 min/month. Upgrade to **GitHub Pro** (~$4/mo) for 3,000 minutes, or reduce the cron to `*/30 * * * *` for 30-minute intervals to stay within the free tier.
- **Pattern reset**: If you forget your pattern, click "Forgot pattern? Reset" on the lock screen.
- **Manual tasks**: Use the **+ Add Task** button to create tasks that aren't from email.
