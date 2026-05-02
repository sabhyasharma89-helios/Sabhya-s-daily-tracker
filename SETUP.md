# Sabhya's Daily Tracker — Setup Guide

## Architecture Overview

```
GitHub Pages (your browser)
    ↓  HTTPS API calls
Google Apps Script (your Google account)
    ↓  reads Gmail   ↓  reads/writes data
  GmailApp        Google Sheets (database)
    ↓
  Gemini AI (email analysis)
```

---

## Step 1 — Create the Google Sheet (database)

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**.
2. Name it **Sabhya Tracker DB** (or anything you like).
3. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/COPY_THIS_PART/edit
   ```

---

## Step 2 — Set up Google Apps Script

1. In your Google Sheet, click **Extensions → Apps Script**.
2. Delete any default code in the editor.
3. Create three script files by clicking the **+** next to "Files":

### File 1: `Code.gs`
Paste the entire contents of `backend/Code.gs` from this repository.

### File 2: `Database.gs`
Click **+**, name it `Database`, paste `backend/Database.gs`.

### File 3: `EmailProcessor.gs`
Click **+**, name it `EmailProcessor`, paste `backend/EmailProcessor.gs`.

---

## Step 3 — Configure Script Properties

1. In Apps Script, click **Project Settings** (gear icon, left sidebar).
2. Scroll down to **Script Properties** and click **Add Script Property** for each:

| Property | Value |
|----------|-------|
| `SHEET_ID` | The Spreadsheet ID from Step 1 |
| `API_SECRET` | A long random password you make up (e.g. `MySecr3t!Tracker2024`) |
| `GEMINI_KEY` | Your Gemini API key (see Step 4) |

---

## Step 4 — Get a Free Gemini API Key

1. Visit [aistudio.google.com](https://aistudio.google.com).
2. Sign in with your Google account.
3. Click **Get API key → Create API key**.
4. Copy the key and paste it as the `GEMINI_KEY` Script Property above.

> **Note:** The free tier is generous — typically 1,500 requests/day at no cost.

---

## Step 5 — Initialize the Database

1. In Apps Script, select the function **`setupDatabase`** from the dropdown.
2. Click **▶ Run**.
3. Authorize the script when prompted (it needs access to Gmail and Sheets).
4. This creates all required tabs in your Google Sheet automatically.

---

## Step 6 — Set Up the 10-Minute Email Trigger

1. Select the function **`setupTrigger`** from the dropdown.
2. Click **▶ Run**.
3. This creates a time-based trigger that reads your Gmail every 10 minutes.

To verify: click the **clock icon** (Triggers) in the left sidebar — you should see `runEmailSync` listed.

---

## Step 7 — Deploy as Web App

1. Click **Deploy → New Deployment** (top right).
2. Set:
   - **Type:** Web app
   - **Execute as:** Me
   - **Who has access:** Anyone
3. Click **Deploy**.
4. **Copy the Web App URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

> **Important:** Every time you change the Apps Script code and want to update the live version, click **Deploy → Manage Deployments → Edit (pencil) → Create new version → Deploy**.

---

## Step 8 — Configure the Dashboard

1. Open your dashboard at your GitHub Pages URL (e.g. `https://yourusername.github.io/Sabhya-s-daily-tracker/`).
2. **Set your pattern lock** — draw any pattern connecting at least 4 dots. You'll be asked to confirm it.
3. Once inside the dashboard, click the **⚙️ Settings** button (top right).
4. Enter:
   - **Web App URL** — from Step 7
   - **API Secret Key** — the `API_SECRET` you set in Step 3
5. Click **Save Settings**.
6. The dashboard will automatically perform the first sync, pulling emails from the **last 30 days**.

---

## Step 9 — Enable GitHub Pages

1. In your GitHub repository, go to **Settings → Pages**.
2. Set **Source** to `Deploy from a branch`, branch `main` (or `claude/busy-edison-2JVcx`), folder `/` (root).
3. Click **Save**.
4. Your dashboard will be live at `https://yourusername.github.io/Sabhya-s-daily-tracker/`.

---

## Daily Operation

- **Automatic:** Gmail is scanned every 10 minutes via the Apps Script trigger.
- **Manual sync:** Click the 🔄 refresh icon in the dashboard header.
- **Force full resync:** Settings → Force Full Sync (Last 30 Days).

---

## Feature Reference

| Feature | How to use |
|---------|-----------|
| **Pattern lock** | Draw your pattern to unlock; lock via 🔒 icon |
| **Change pattern** | Settings → Change Unlock Pattern |
| **Add task manually** | Click **New Task** button (desktop) or **+** FAB (mobile) |
| **Mark complete** | Click the circle checkbox on any task |
| **Undo complete** | In the Completed section, click the checkbox again |
| **Change priority** | Open task → Change Priority |
| **Assign to employee** | Open task → Assign To |
| **Reorder clients** | Drag the ⠿ handle on any client tab |
| **Search** | Use the search bar — searches title, client, description, employee |
| **Filter** | Use the dropdown filters for status, priority, client, employee |
| **Add employee** | Settings → Employee Management → type name → Add |

---

## Troubleshooting

**"Unauthorized" error in connection test**
- Double-check that the `API_SECRET` in Script Properties exactly matches what you entered in Settings.

**No tasks appearing after sync**
- Ensure the script has Gmail authorization: run `setupDatabase` again and re-authorize.
- Check Apps Script execution logs: **Executions** (left sidebar) for error details.

**Gemini not analysing emails**
- Verify `GEMINI_KEY` is set correctly in Script Properties.
- Check the [Gemini API quota](https://aistudio.google.com/plan) — you may have hit the free limit.
- The system will still create tasks using basic text analysis as a fallback.

**Pattern forgotten**
- Click **Forgot Pattern?** on the lock screen → confirm → draw a new pattern.
- As a last resort, clear your browser's localStorage for the site (DevTools → Application → Local Storage → Clear).

**Apps Script trigger not running**
- Go to Apps Script → Triggers (clock icon) → verify `runEmailSync` is listed.
- If missing, run `setupTrigger` again.
- Check execution logs for any quota errors.

---

## Data Privacy

- Your emails are processed **inside your own Google account** using your own Apps Script.
- Email content is sent to **Google's Gemini API** for analysis — this is subject to Google's privacy policy.
- The dashboard is served from GitHub Pages (static files only — no server receives your data).
- Your pattern lock hash is stored **only in your browser's localStorage**.
- Your API secret and URL are stored **only in your browser's localStorage**.
