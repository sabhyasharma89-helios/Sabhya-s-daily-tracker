# Sabhya's Daily Task Tracker

An AI-powered, Gmail-integrated personal task tracker — hosted on GitHub Pages with full offline support.

## Features

- **Pattern Lock** — Secure your dashboard with a personal draw-pattern
- **Gmail Integration** — Reads your inbox every 10 minutes and auto-creates tasks
- **Client Organisation** — Tasks auto-grouped by client/company with colour coding
- **Smart Email Parser** — Detects priority, action items, responsible persons, and deadlines
- **Thread Summaries** — Expands each task into a full email thread view
- **Employee Assignment** — Assign tasks to team members and filter by assignee
- **Search & Filter** — By status, priority, client, assignee, or free text
- **Persistent Database** — IndexedDB — data never deleted, builds over time
- **First Run** — Imports last 30 days of email automatically
- **PWA** — Install as a mobile/desktop app with offline support
- **Mobile Responsive** — Full touch support

## Quick Start

### 1. Enable GitHub Pages

In your repository settings → **Pages** → Source: `main` branch, `/ (root)` folder.

Your app URL will be: `https://<username>.github.io/sabhya-s-daily-tracker/`

### 2. Set up Google OAuth (one-time)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → **APIs & Services → Library** → Enable **Gmail API**
3. **Credentials → + Create Credentials → OAuth 2.0 Client ID** → Web application
4. Add **Authorised JavaScript origins**: `https://<username>.github.io`
5. Copy the **Client ID**

### 3. Open the tracker

Navigate to your GitHub Pages URL, complete the 3-step wizard:
1. Draw a pattern lock (min 4 dots, draw twice to confirm)
2. Paste your Google Client ID
3. Launch — the tracker imports your last 30 days of email automatically

## Architecture

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static) |
| Database | IndexedDB (browser-native, persistent) |
| Authentication | Canvas pattern lock + SHA-256 |
| Gmail Access | Google Identity Services OAuth 2.0 |
| Email Parsing | Rule-based NLP (no external AI API needed) |
| Background Sync | `setInterval` (10 min while page is open) |
| PWA | Service Worker + Web App Manifest |

## Privacy

All data stays in your browser's IndexedDB. No email content or task data is ever sent to any external server. The Google OAuth token is held only in memory and expires after 1 hour.
