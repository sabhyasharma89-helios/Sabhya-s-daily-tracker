# Sabhya's Daily Tracker — Setup Guide

## Overview
This tracker reads your Gmail, uses Claude AI to extract tasks, and displays them in a secure dashboard hosted on GitHub Pages.

---

## Step 1: Enable GitHub Pages
1. Go to your repository → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` → `/` (root)
4. Save. Your dashboard will be at `https://sabhyasharma89-helios.github.io/sabhya-s-daily-tracker/`

---

## Step 2: Google Cloud Setup (Gmail API)

### 2a. Create a project
1. Visit https://console.cloud.google.com
2. Create a new project (e.g., "Sabhya Tracker")
3. Enable the **Gmail API** — APIs & Services → Library → search Gmail API → Enable

### 2b. Create OAuth 2.0 credentials
1. APIs & Services → Credentials → **Create Credentials** → OAuth client ID
2. Application type: **Desktop app**
3. Download the JSON and save as `client_secret.json` on your computer

### 2c. Get the refresh token (one-time, run locally)
```bash
pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client
python scripts/get_token.py
```
A browser window will open. Log in with your Gmail account and allow access.
Copy the three values printed in the terminal.

---

## Step 3: Get an Anthropic API Key
1. Visit https://console.anthropic.com
2. Create an API key

---

## Step 4: Add GitHub Secrets
Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets:

| Secret Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | From step 2c |
| `GMAIL_CLIENT_SECRET` | From step 2c |
| `GMAIL_REFRESH_TOKEN` | From step 2c |
| `ANTHROPIC_API_KEY` | From step 3 |

---

## Step 5: Add GitHub Personal Access Token (for dashboard writes)
1. Go to https://github.com/settings/tokens
2. **Generate new token (classic)**
3. Scopes: check **repo** (full control)
4. Copy the token
5. In the dashboard, click the ⚙️ Settings icon and paste the token

This allows the dashboard to save task edits back to the repository.

---

## Step 6: First Run
Go to your repo → **Actions** → **Email Sync** → **Run workflow**

This will read your last 30 days of emails and build the initial task database.
Subsequent runs happen automatically every 10 minutes.

---

## Pattern Lock
On your first visit to the dashboard:
1. You'll be asked to draw a pattern on a 3×3 grid
2. Draw it again to confirm
3. The pattern is stored securely in your browser only

If you ever forget the pattern, open browser DevTools → Console → type `resetPattern()` → press Enter.

---

## Security Notes
- The pattern lock protects the UI but tasks.json is publicly readable if your repo is public
- For full data privacy, make the repository private (requires GitHub Pro or Teams)
- Your GitHub token is stored in browser localStorage — do not use shared computers
