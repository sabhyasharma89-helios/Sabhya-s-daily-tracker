# Sabhya's Task Tracker

Your personal AI-powered task dashboard. It reads your Gmail every 10 minutes, understands each email using Claude AI, groups action items by client, and shows them on a private, pattern-locked webpage.

---

## What You Need Before Starting

You need **three things** — each takes about 2 minutes to get:

1. A **Claude AI (Anthropic) API key** — so the app can understand your emails
2. A **GitHub Personal Access Token** — so the script can save tasks to your dashboard
3. Your **GitHub username** and the **name of this repository**

Everything below walks you through each step in plain English.

---

## Part 1 — Get Your Anthropic (Claude AI) API Key

> This key lets the script send your emails to Claude AI for analysis. It costs a tiny amount per email (fractions of a cent).

1. Open your browser and go to: **https://console.anthropic.com**
2. Click **"Sign up"** and create a free account (or log in if you already have one)
3. Once logged in, look for **"API Keys"** in the left-hand menu and click it
4. Click the **"Create Key"** button
5. Give it any name, e.g. `task-tracker`
6. A long string starting with `sk-ant-...` will appear — **copy it and keep it safe** (you won't see it again)

---

## Part 2 — Get Your GitHub Personal Access Token

> This lets the script save your tasks back to your private GitHub file so the dashboard can display them.

1. Log in to **github.com**
2. Click your **profile picture** in the top-right corner
3. Click **"Settings"**
4. Scroll all the way down the left menu and click **"Developer settings"**
5. Click **"Personal access tokens"** → **"Tokens (classic)"**
6. Click **"Generate new token"** → **"Generate new token (classic)"**
7. In the **"Note"** field type: `task-tracker`
8. Under **"Expiration"** choose **"No expiration"** (so it never stops working)
9. Tick the box next to **"repo"** (the very first checkbox under "Select scopes")
10. Scroll to the bottom and click **"Generate token"**
11. A string starting with `ghp_...` will appear — **copy it and keep it safe** (you won't see it again)

---

## Part 3 — Find Your GitHub Username and Repository Name

1. On github.com, your **username** is shown in the top-right after clicking your profile picture (e.g. `sabhyasharma89-helios`)
2. Your **repository name** is shown on the repository page in bold at the top (e.g. `Sabhya-s-daily-tracker`)

Write both down — you'll need them in the next step.

---

## Part 4 — Enable Your Dashboard (GitHub Pages)

> This makes your dashboard available as a real webpage.

1. On your GitHub repository page, click **"Settings"** (near the top, with a ⚙ icon)
2. In the left menu, click **"Pages"**
3. Under **"Source"**, click the dropdown and select **"Deploy from a branch"**
4. Under **"Branch"**, select **"main"** and leave the folder as **"/ (root)"**
5. Click **"Save"**
6. After about 1–2 minutes your dashboard will be live at:
   `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`

---

## Part 5 — Set Up the Email Sync (Google Apps Script)

> This is the part that reads your emails every 10 minutes. It lives entirely inside your Google account — nothing to install.

### 5a. Open Google Apps Script

1. Open a new browser tab and go to: **https://script.google.com**
2. Click **"New project"** (the big button or from the menu)
3. A code editor will open with some placeholder text — **select all of it and delete it**

### 5b. Paste the sync script

1. On your GitHub repository page, click on the file **`scripts/gmail-sync.gs`**
2. Click the **copy icon** (📋) to copy all the code
3. Go back to the Google Apps Script editor and **paste** the code

### 5c. Save your API keys inside the script (safely)

1. In the Apps Script editor, click the **⚙ (gear/cog) icon** on the left — this opens **"Project Settings"**
2. Scroll down to **"Script Properties"** and click **"Add script property"**
3. Add these **4 properties** one by one (click "Add property" after each):

   | Property name       | Value                                   |
   |---------------------|-----------------------------------------|
   | `ANTHROPIC_API_KEY` | Your key from Part 1 (starts with `sk-ant-`) |
   | `GITHUB_PAT`        | Your token from Part 2 (starts with `ghp_`)  |
   | `GITHUB_OWNER`      | Your GitHub username (from Part 3)      |
   | `GITHUB_REPO`       | Your repository name (from Part 3)      |

4. Click **"Save script properties"**

### 5d. Start the sync

1. Go back to the **Editor** tab (the `<>` icon on the left)
2. At the top of the editor, find the dropdown that says **"Select function"** — click it and choose **`setupTrigger`**
3. Click the ▶ **Run** button
4. A popup will appear saying Google needs permission — click **"Review permissions"**
5. Choose your Google account
6. You may see a warning saying "Google hasn't verified this app" — click **"Advanced"** then **"Go to [project name] (unsafe)"**
   *(This is safe — it's your own script in your own Google account)*
7. Click **"Allow"**
8. The script will run. In the **"Execution log"** at the bottom you should see:
   ```
   ✅ Trigger created! syncEmails will now run every 10 minutes automatically.
   Running first sync right now (this reads the last 30 days of email)...
   ```

> The first run may take 3–5 minutes as it reads 30 days of emails. After that, each 10-minute sync is very fast.

---

## Part 6 — Open Your Dashboard

1. Go to your GitHub Pages URL:
   `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`
2. You'll see a **9-dot pattern screen** — this is your lock screen
3. Draw any pattern connecting **at least 4 dots** (like Android phone unlock)
4. Draw the **same pattern again** to confirm it
5. Your dashboard will open!

> **Important:** Remember your pattern. If you forget it, go to Settings (⚙) inside the dashboard → "Reset Unlock Pattern".

---

## How to Use the Dashboard

| What you want to do | How |
|---|---|
| **See all tasks** | They appear grouped by client name automatically |
| **Open a task** | Tap/click any task card |
| **See the full email summary** | Open a task — it shows the thread summary, action items, and who should act next |
| **Mark a task done** | Tap the circle ○ on the left of the task card |
| **Undo a completion** | Scroll to the "Completed" section at the bottom, tap the circle again |
| **Change priority** | Open task → tap "Change Priority" |
| **Assign to someone** | Open task → tap "Edit" → fill in "Assign To" |
| **Add a task manually** | Tap the **＋** button (bottom right) |
| **Search** | Type in the search bar at the top |
| **Filter by client / employee / priority** | Use the four dropdowns below the search bar |
| **Lock the screen** | Tap the 🔒 icon in the top-right corner |
| **Refresh now** | Tap the ↻ icon in the top-right corner |

---

## Frequently Asked Questions

**Q: How often does it sync?**
Every 10 minutes automatically, starting immediately after you run `setupTrigger`.

**Q: Will it re-read old emails on every sync?**
No. The first run reads the last 30 days. Every run after that only reads emails received since the last sync. Your existing tasks are never deleted.

**Q: What if an email thread gets resolved? Will the task close automatically?**
Yes. Claude AI reads the latest emails in the thread and if it determines the matter is resolved, it will automatically mark the task as completed.

**Q: My changes (priority, assignee) — will they survive the next sync?**
Yes. Any change you make manually is protected. The sync will never overwrite a field you have set yourself.

**Q: Is my email data private?**
The script runs in your own Google account. Only the plain-text body of each email (up to 1 500 characters per message) is sent to Anthropic's API for analysis. No attachments are ever sent. The resulting `tasks.json` file is stored in your GitHub repository.

**Q: The script stopped working after a few months.**
Google Apps Script sometimes pauses inactive projects. Go back to script.google.com, open the project, and run `setupTrigger` again — it takes 30 seconds.

**Q: I forgot my unlock pattern.**
Open the dashboard URL, tap the ⚙ Settings icon (you'll see it briefly before the lock screen covers it — or just add `/index.html` to the URL and open the browser console). Alternatively, open the dashboard in a new private/incognito window, go to Settings → Reset Unlock Pattern.

---

## Project Files (for reference)

```
├── index.html                 ← Your dashboard webpage
├── css/styles.css             ← Visual styling
├── js/app.js                  ← Dashboard logic and pattern lock
├── data/tasks.json            ← Your task database (auto-updated)
├── scripts/
│   └── gmail-sync.gs          ← Paste this into Google Apps Script
└── README.md                  ← This guide
```
