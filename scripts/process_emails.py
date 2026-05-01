#!/usr/bin/env python3
"""
Email Task Processor — runs via GitHub Actions every 10 minutes.
Reads Gmail, processes each thread with Claude AI, and updates data/tasks.json.
"""

import os
import json
import re
import hashlib
import base64
from datetime import datetime, timedelta, timezone

from dateutil import parser as dateparser
import anthropic
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
TASKS_FILE = os.path.join(DATA_DIR, "tasks.json")
METADATA_FILE = os.path.join(DATA_DIR, "metadata.json")

# Maximum threads to keep in processedThreadIds to avoid unbounded growth
MAX_PROCESSED_IDS = 2000
# Maximum emails per thread sent to Claude (older ones are summarised)
MAX_EMAILS_PER_THREAD = 6


# ── I/O helpers ───────────────────────────────────────────────────────────────

def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str, ensure_ascii=False)


# ── Gmail helpers ──────────────────────────────────────────────────────────────

def get_gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=os.environ["GMAIL_REFRESH_TOKEN"],
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )
    return build("gmail", "v1", credentials=creds)


def get_header(message, name):
    for h in message.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def decode_part(data):
    try:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
    except Exception:
        return ""


def extract_body(payload, max_chars=2500):
    """Recursively extract plain-text body from a MIME payload."""
    mime = payload.get("mimeType", "")

    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return decode_part(data)[:max_chars] if data else ""

    # For multipart, try text/plain parts first
    text = ""
    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain":
            data = part.get("body", {}).get("data", "")
            text += decode_part(data) if data else ""
        elif part.get("mimeType", "").startswith("multipart/"):
            text += extract_body(part, max_chars)
        if len(text) >= max_chars:
            break
    return text[:max_chars]


# ── Claude AI helpers ──────────────────────────────────────────────────────────

def build_thread_text(thread_data):
    lines = [f"Subject: {thread_data['subject']}\n"]
    for i, email in enumerate(thread_data["emails"], 1):
        lines.append(f"--- Email {i} of {len(thread_data['emails'])} ---")
        lines.append(f"Date : {email['date']}")
        lines.append(f"From : {email['from']}")
        lines.append(f"To   : {email['to']}")
        lines.append(f"Body :\n{email['body']}\n")
    return "\n".join(lines)


def call_claude(prompt):
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip()


def process_thread_with_claude(thread_data, existing_task=None):
    thread_text = build_thread_text(thread_data)

    existing_ctx = ""
    if existing_task:
        existing_ctx = f"""
An existing task already tracks this thread:
  Status   : {existing_task.get('status', 'pending')}
  Priority : {existing_task.get('priority', 'medium')}
  Summary  : {existing_task.get('summary', '')}
Update it based on the latest emails.
"""

    prompt = f"""You are a business task-tracker AI. Analyse the email thread below and output a
single JSON object with NO markdown fences, NO extra text.

{thread_text}
{existing_ctx}
Required JSON keys:
{{
  "clientName"        : "Company or person who is the external party (string)",
  "taskTitle"         : "Short descriptive title ≤ 60 chars (string)",
  "priority"          : "urgent | medium | low",
  "status"            : "pending | completed",
  "actionables"       : ["action 1", "action 2"],
  "responsiblePerson" : "Name of person responsible for the next step (string)",
  "summary"           : "2-3 sentence summary of the entire thread (string)",
  "hasActionableItems": true
}}

Rules:
- "completed" only if the thread clearly shows the matter is resolved/closed.
- "urgent" = deadlines within 3 days, legal/financial/escalated issues.
- "low"    = informational, FYI, or no immediate action needed.
- If you cannot identify a real client, use "General" as clientName.
- hasActionableItems = false for newsletters, receipts, or purely informational emails.
"""

    try:
        raw = call_claude(prompt)
        # Strip any accidental markdown fences
        raw = re.sub(r"^```[a-z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw)
    except Exception as e:
        print(f"  ⚠  Claude parse error: {e}")
        return None


# ── ID helpers ─────────────────────────────────────────────────────────────────

def make_task_id(thread_id):
    return "task_" + hashlib.md5(thread_id.encode()).hexdigest()[:12]


def make_client_id(name):
    return "client_" + hashlib.md5(name.lower().strip().encode()).hexdigest()[:8]


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("🚀  Email Task Processor starting …")

    tasks_data = load_json(TASKS_FILE, {
        "tasks": [], "clients": [], "employees": [], "lastUpdated": None
    })
    metadata = load_json(METADATA_FILE, {
        "lastEmailReadTime": None,
        "processedThreadIds": [],
        "totalEmailsProcessed": 0,
        "firstRunCompleted": False,
    })

    force_full = os.environ.get("FORCE_FULL_SYNC", "false").lower() == "true"

    if not metadata["firstRunCompleted"] or force_full:
        since = datetime.now(timezone.utc) - timedelta(days=30)
        print("📅  First run / forced sync — fetching last 30 days of email")
    else:
        since = dateparser.parse(metadata["lastEmailReadTime"])
        print(f"📅  Fetching emails since {since.isoformat()}")

    try:
        service = get_gmail_service()
    except Exception as e:
        print(f"❌  Gmail auth failed: {e}")
        return

    query = f"after:{int(since.timestamp())}"
    processed_ids = set(metadata.get("processedThreadIds", []))

    try:
        resp = service.users().threads().list(
            userId="me", q=query, maxResults=200
        ).execute()
    except HttpError as e:
        print(f"❌  Gmail API error: {e}")
        return

    threads = resp.get("threads", [])
    print(f"📬  Found {len(threads)} threads (skipping already-processed ones)")

    new_count = 0

    for thread_ref in threads:
        tid = thread_ref["id"]
        if tid in processed_ids:
            continue

        try:
            thread = service.users().threads().get(
                userId="me", id=tid, format="full"
            ).execute()
        except HttpError as e:
            print(f"  ⚠  Could not fetch thread {tid}: {e}")
            continue

        messages = thread.get("messages", [])
        if not messages:
            processed_ids.add(tid)
            continue

        subject = get_header(messages[0], "subject") or "(No Subject)"
        print(f"  📧  [{subject[:55]}]")

        emails = []
        for msg in messages[:MAX_EMAILS_PER_THREAD]:
            emails.append({
                "from": get_header(msg, "from"),
                "to": get_header(msg, "to"),
                "date": get_header(msg, "date"),
                "body": extract_body(msg.get("payload", {})),
            })

        thread_data = {
            "subject": subject,
            "threadId": tid,
            "emails": emails,
            "emailCount": len(messages),
        }

        task_id = make_task_id(tid)
        existing = next((t for t in tasks_data["tasks"] if t["id"] == task_id), None)

        result = process_thread_with_claude(thread_data, existing)

        if not result or not result.get("hasActionableItems", False):
            print("     → no actionable items, skipping")
            processed_ids.add(tid)
            continue

        client_name = (result.get("clientName") or "General").strip()
        client_id = make_client_id(client_name)

        if not any(c["id"] == client_id for c in tasks_data["clients"]):
            tasks_data["clients"].append({
                "id": client_id,
                "name": client_name,
                "order": len(tasks_data["clients"]),
                "collapsed": False,
            })

        now = datetime.now(timezone.utc).isoformat()
        latest_date = emails[-1]["date"] if emails else None

        if existing:
            existing.update({
                "subject": subject,
                "taskTitle": result.get("taskTitle", existing.get("taskTitle", subject))[:60],
                "priority": result.get("priority", existing["priority"]),
                "status": result.get("status", existing["status"]),
                "actionables": result.get("actionables", existing["actionables"]),
                "responsiblePerson": result.get("responsiblePerson", existing["responsiblePerson"]),
                "summary": result.get("summary", existing["summary"]),
                "updatedAt": now,
                "emailCount": len(messages),
                "latestEmailDate": latest_date,
                "clientId": client_id,
                "clientName": client_name,
            })
            print(f"     ✏  Updated task {task_id}")
        else:
            tasks_data["tasks"].append({
                "id": task_id,
                "clientId": client_id,
                "clientName": client_name,
                "threadId": tid,
                "subject": subject,
                "taskTitle": result.get("taskTitle", subject)[:60],
                "priority": result.get("priority", "medium"),
                "status": result.get("status", "pending"),
                "assignee": None,
                "createdAt": now,
                "updatedAt": now,
                "summary": result.get("summary", ""),
                "actionables": result.get("actionables", []),
                "responsiblePerson": result.get("responsiblePerson", ""),
                "emailCount": len(messages),
                "latestEmailDate": latest_date,
            })
            print(f"     ✅  Created task {task_id}")

        processed_ids.add(tid)
        new_count += 1

    # Keep processed IDs list bounded
    all_ids = list(processed_ids)
    if len(all_ids) > MAX_PROCESSED_IDS:
        all_ids = all_ids[-MAX_PROCESSED_IDS:]

    metadata["lastEmailReadTime"] = datetime.now(timezone.utc).isoformat()
    metadata["processedThreadIds"] = all_ids
    metadata["totalEmailsProcessed"] = metadata.get("totalEmailsProcessed", 0) + new_count
    metadata["firstRunCompleted"] = True
    tasks_data["lastUpdated"] = datetime.now(timezone.utc).isoformat()

    save_json(TASKS_FILE, tasks_data)
    save_json(METADATA_FILE, metadata)
    print(f"\n✅  Done — processed {new_count} new threads. Total emails ever: {metadata['totalEmailsProcessed']}")


if __name__ == "__main__":
    main()
