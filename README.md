# Sabhya's Daily Tracker

An AI-powered, Gmail-connected task tracker with pattern-lock authentication — hosted on GitHub Pages.

## Features

- **Pattern Lock** — secure 3×3 dot-pattern authentication, stored only in your browser
- **Gmail Integration** — reads your inbox every 10 minutes via Google OAuth (read-only)
- **AI Task Extraction** — Claude AI analyses each email thread, identifies the client, and creates or updates tasks automatically
- **Client-organised dashboard** — expandable client tabs with tasks grouped by priority (Urgent / Medium / Low)
- **Task details** — click any task to see the full email thread summary, actionables, and next-steps person
- **Auto-complete** — tasks are automatically marked complete when emails indicate the work is done
- **Employee assignment** — assign tasks to team members; filter by employee or client
- **Search & filter** — find tasks by keyword, status, priority, client, or assignee
- **Completed section** — auto-collapsed; uncheck to move a task back to pending
- **Stats dashboard** — live counts for total, pending, urgent, medium, low, completed
- **PWA** — installable on mobile and desktop; works offline after first load

## Setup (5 minutes)

### 1. Enable GitHub Pages

In your repository → **Settings → Pages → Source: main branch / root**.  
Your app will be at `https://<username>.github.io/<repo-name>/`.

### 2. Google Cloud — Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → **APIs & Services → Enable APIs → Gmail API**
3. **APIs & Services → Credentials → Create OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorised JavaScript origins: `https://<username>.github.io`
   - Authorised redirect URIs: `https://<username>.github.io/<repo-name>/`
4. Copy the **Client ID** (looks like `123….apps.googleusercontent.com`)

### 3. Anthropic API Key

Get your key from [console.anthropic.com](https://console.anthropic.com/).

### 4. First Run

Open your GitHub Pages URL.  
The setup wizard will walk you through:
1. Setting your pattern lock
2. Entering your Google Client ID and Claude API key
3. Authorising Gmail access
4. Adding team members

That's it — the tracker will load the last 30 days of emails on first run, then check every 10 minutes automatically.

## Data & Privacy

- **All data stays in your browser** (IndexedDB). Nothing is sent to any server except the Gmail API and Anthropic API.
- Gmail access is **read-only** — the app can never send emails.
- Your API keys are stored in IndexedDB, protected by the pattern lock.

## Tech Stack

- Pure HTML / CSS / JavaScript (no build step)
- IndexedDB for persistence
- Google Identity Services for OAuth
- Anthropic Claude API (claude-sonnet-4-6) for email analysis
- Service Worker for offline support and caching
