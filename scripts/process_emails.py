#!/usr/bin/env python3
"""
process_emails.py
─────────────────
Reads Gmail threads since last sync, analyses each with Claude AI,
and upserts tasks into data/database.json.

Environment variables required:
  GMAIL_CREDENTIALS_JSON   – OAuth2 client credentials JSON (from Google Cloud Console)
  GMAIL_TOKEN_JSON         – OAuth2 token JSON  (refresh_token is the important part)
  ANTHROPIC_API_KEY        – Anthropic/Claude API key

Run via GitHub Actions on a schedule, or manually:
  python scripts/process_emails.py
"""

import base64
import json
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import anthropic
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ─── paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "database.json"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# ─── database helpers ─────────────────────────────────────────────────────────

def load_db() -> dict:
    if DB_PATH.exists():
        with open(DB_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "version": "1.0",
        "lastSyncTime": None,
        "lastEmailDate": None,
        "clients": {},
        "employees": [],
        "settings": {"syncInterval": 10},
    }


def save_db(db: dict) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)


# ─── Gmail helpers ────────────────────────────────────────────────────────────

def build_gmail_service():
    """Authenticate with Gmail using env-supplied credentials."""
    creds_json = os.environ.get("GMAIL_CREDENTIALS_JSON")
    token_json = os.environ.get("GMAIL_TOKEN_JSON")

    if not creds_json or not token_json:
        print("ERROR: GMAIL_CREDENTIALS_JSON and GMAIL_TOKEN_JSON must be set.", file=sys.stderr)
        sys.exit(1)

    creds_data  = json.loads(creds_json)
    token_data  = json.loads(token_json)

    # Build Credentials object from the token
    creds = Credentials(
        token         = token_data.get("token"),
        refresh_token = token_data.get("refresh_token"),
        token_uri     = token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id     = token_data.get("client_id")
                        or creds_data.get("installed", creds_data.get("web", {})).get("client_id"),
        client_secret = token_data.get("client_secret")
                        or creds_data.get("installed", creds_data.get("web", {})).get("client_secret"),
        scopes        = SCOPES,
    )

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            print("Token refreshed successfully.")
        else:
            print("ERROR: Token invalid and cannot be refreshed.", file=sys.stderr)
            sys.exit(1)

    return build("gmail", "v1", credentials=creds)


def _extract_body(payload: dict) -> str:
    """Recursively extract plain-text body from a Gmail message payload."""
    body = ""

    def recurse(part):
        nonlocal body
        mime = part.get("mimeType", "")
        if mime == "text/plain":
            data = part.get("body", {}).get("data")
            if data:
                body += base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore") + "\n"
        elif mime.startswith("multipart/"):
            for sub in part.get("parts", []):
                recurse(sub)

    recurse(payload)

    # Fallback: strip HTML if no plain text
    if not body.strip():
        def strip_html(part):
            nonlocal body
            mime = part.get("mimeType", "")
            if mime == "text/html":
                data = part.get("body", {}).get("data")
                if data:
                    html = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
                    body += re.sub(r"<[^>]+>", " ", html) + "\n"
            elif mime.startswith("multipart/"):
                for sub in part.get("parts", []):
                    strip_html(sub)
        strip_html(payload)

    return body.strip()[:4000]   # cap to avoid huge prompts


def fetch_threads_since(service, since_iso: str | None) -> list[dict]:
    """Return list of thread stubs {id, historyId} since a given ISO timestamp."""
    if since_iso:
        dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
        after_ts = int(dt.timestamp())
        query = f"after:{after_ts}"
    else:
        after_ts = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())
        query = f"after:{after_ts}"

    threads, page_token = [], None
    while True:
        kwargs = {"userId": "me", "q": query, "maxResults": 100}
        if page_token:
            kwargs["pageToken"] = page_token
        result = service.users().threads().list(**kwargs).execute()
        threads.extend(result.get("threads", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    return threads


def get_full_thread(service, thread_id: str) -> list[dict]:
    """Return list of message dicts with from/to/subject/date/snippet/body."""
    try:
        thread = service.users().threads().get(
            userId="me", id=thread_id, format="full"
        ).execute()
    except HttpError as e:
        print(f"  HttpError fetching thread {thread_id}: {e}")
        return []

    messages = []
    for msg in thread.get("messages", []):
        hdrs = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
        messages.append({
            "id":      msg["id"],
            "from":    hdrs.get("from", ""),
            "to":      hdrs.get("to", ""),
            "subject": hdrs.get("subject", ""),
            "date":    hdrs.get("date", ""),
            "snippet": msg.get("snippet", ""),
            "body":    _extract_body(msg.get("payload", {})),
        })
    return messages


# ─── Claude analysis ──────────────────────────────────────────────────────────

def analyse_thread(claude: anthropic.Anthropic, messages: list[dict]) -> dict | None:
    """Send thread to Claude and return structured task analysis."""

    thread_text = "\n\n---EMAIL SEPARATOR---\n\n".join(
        f"FROM: {m['from']}\nTO: {m['to']}\nSUBJECT: {m['subject']}\nDATE: {m['date']}\n\n{m['body']}"
        for m in messages
    )

    system = (
        "You are an expert business assistant. Analyse email threads and extract actionable task data. "
        "Always respond with valid JSON only — no markdown, no explanation."
    )

    prompt = f"""Analyse this email thread for business tasks.

THREAD:
{thread_text}

Return a JSON object with EXACTLY these fields:
{{
  "isActionable": true/false,
  "clientName": "Name of the external client, company, or person (not the inbox owner)",
  "taskTitle": "One-line actionable title",
  "taskDescription": "2-3 sentence description of what needs to be done",
  "priority": "urgent|medium|low",
  "actionables": ["specific action item 1", "action item 2"],
  "nextStepsPerson": "Full name of whoever owns the next step (or null)",
  "isCompleted": true/false,
  "summary": "3-5 sentence summary of the full conversation so far"
}}

Rules:
- isActionable = false for newsletters, automated notifications, spam, purely FYI emails
- clientName must be the OTHER party, not the inbox owner; use company name if available
- priority: urgent = time-sensitive or blocking; medium = important; low = background item
- isCompleted = true if the thread shows the matter is resolved/closed
- Return ONLY the JSON object — no other text"""

    try:
        response = claude.messages.create(
            model="claude-opus-4-7",
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw)
    except (json.JSONDecodeError, IndexError) as e:
        print(f"  JSON parse error from Claude: {e}")
        return None
    except anthropic.APIError as e:
        print(f"  Claude API error: {e}")
        return None


# ─── database update logic ────────────────────────────────────────────────────

def _ensure_client(db: dict, name: str) -> dict:
    """Find or create a client entry in db; return client dict."""
    for client in db["clients"].values():
        if client["name"].lower() == name.lower():
            return client
    cid = str(uuid.uuid4())
    client = {
        "id":        cid,
        "name":      name,
        "order":     len(db["clients"]),
        "collapsed": False,
        "tasks":     [],
    }
    db["clients"][cid] = client
    return client


def _find_task_by_thread(db: dict, thread_id: str) -> tuple[dict | None, dict | None]:
    """Return (task, client) for the task linked to this thread_id, or (None, None)."""
    for client in db["clients"].values():
        for task in client["tasks"]:
            if task.get("emailThreadId") == thread_id:
                return task, client
    return None, None


def upsert_task(db: dict, thread_id: str, messages: list[dict], analysis: dict) -> None:
    """Create or update a task based on the analysis result."""
    now = datetime.now(timezone.utc).isoformat()

    client_name = (analysis.get("clientName") or "").strip() or "General"
    if client_name.lower() in ("unknown", "n/a", "none"):
        client_name = "General"

    existing_task, existing_client = _find_task_by_thread(db, thread_id)

    if existing_task:
        # ── UPDATE existing task ────────────────────────────────────────────
        existing_task.update({
            "title":           analysis.get("taskTitle",       existing_task["title"]),
            "description":     analysis.get("taskDescription", existing_task.get("description", "")),
            "priority":        analysis.get("priority",        existing_task["priority"]),
            "actionables":     analysis.get("actionables",     existing_task.get("actionables", [])),
            "nextStepsPerson": analysis.get("nextStepsPerson"),
            "summary":         analysis.get("summary",         existing_task.get("summary", "")),
            "updatedAt":       now,
        })

        if analysis.get("isCompleted") and existing_task["status"] == "pending":
            existing_task["status"]      = "completed"
            existing_task["completedAt"] = now

        # Append new messages not yet recorded
        known_ids = {m["id"] for m in existing_task.get("emailHistory", [])}
        for msg in messages:
            if msg["id"] not in known_ids:
                existing_task["emailHistory"].append({
                    "id":      msg["id"],
                    "from":    msg["from"],
                    "subject": msg["subject"],
                    "date":    msg["date"],
                    "snippet": msg["snippet"],
                })

        # Move to new client if name changed
        if existing_client and existing_client["name"].lower() != client_name.lower():
            existing_client["tasks"] = [t for t in existing_client["tasks"] if t["id"] != existing_task["id"]]
            new_client = _ensure_client(db, client_name)
            existing_task["clientId"] = new_client["id"]
            new_client["tasks"].append(existing_task)

    else:
        # ── CREATE new task ─────────────────────────────────────────────────
        client = _ensure_client(db, client_name)
        status = "completed" if analysis.get("isCompleted") else "pending"
        task = {
            "id":              str(uuid.uuid4()),
            "clientId":        client["id"],
            "title":           analysis.get("taskTitle", "Untitled Task"),
            "description":     analysis.get("taskDescription", ""),
            "priority":        analysis.get("priority", "medium"),
            "status":          status,
            "assignedTo":      None,
            "emailThreadId":   thread_id,
            "emailSubject":    messages[0]["subject"] if messages else "",
            "summary":         analysis.get("summary", ""),
            "actionables":     analysis.get("actionables", []),
            "nextStepsPerson": analysis.get("nextStepsPerson"),
            "createdAt":       now,
            "updatedAt":       now,
            "completedAt":     now if status == "completed" else None,
            "emailHistory": [
                {
                    "id":      m["id"],
                    "from":    m["from"],
                    "subject": m["subject"],
                    "date":    m["date"],
                    "snippet": m["snippet"],
                }
                for m in messages
            ],
        }
        client["tasks"].append(task)


# ─── latest email date tracker ────────────────────────────────────────────────

def _latest_date(messages: list[dict], current: str | None) -> str | None:
    for msg in messages:
        raw_date = msg.get("date", "")
        if not raw_date:
            continue
        try:
            dt = parsedate_to_datetime(raw_date).astimezone(timezone.utc).isoformat()
            if current is None or dt > current:
                current = dt
        except Exception:
            pass
    return current


# ─── main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print(f"Email sync started at {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    db = load_db()
    print(f"Database loaded. Clients: {len(db['clients'])}")

    # Build services
    gmail  = build_gmail_service()
    claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Fetch threads
    threads = fetch_threads_since(gmail, db.get("lastEmailDate"))
    print(f"Threads to process: {len(threads)}")

    latest_date = db.get("lastEmailDate")
    processed = created = updated = skipped = 0

    for i, stub in enumerate(threads, 1):
        tid = stub["id"]
        print(f"[{i}/{len(threads)}] Thread {tid}")

        messages = get_full_thread(gmail, tid)
        if not messages:
            print("  → No messages retrieved, skipping.")
            skipped += 1
            continue

        latest_date = _latest_date(messages, latest_date)

        analysis = analyse_thread(claude, messages)
        if not analysis:
            print("  → Analysis failed, skipping.")
            skipped += 1
            continue

        if not analysis.get("isActionable", True):
            print(f"  → Not actionable (spam/FYI), skipping.")
            skipped += 1
            continue

        existing, _ = _find_task_by_thread(db, tid)
        upsert_task(db, tid, messages, analysis)
        if existing:
            updated += 1
            print(f"  → Updated task: {analysis.get('taskTitle', '?')}")
        else:
            created += 1
            print(f"  → Created task [{analysis['priority']}]: {analysis.get('taskTitle', '?')}")

        processed += 1

    # Update metadata
    db["lastSyncTime"]  = datetime.now(timezone.utc).isoformat()
    if latest_date:
        db["lastEmailDate"] = latest_date

    save_db(db)

    print("-" * 60)
    print(f"Done. Processed={processed}, Created={created}, Updated={updated}, Skipped={skipped}")
    print(f"Database saved to {DB_PATH}")


if __name__ == "__main__":
    main()
