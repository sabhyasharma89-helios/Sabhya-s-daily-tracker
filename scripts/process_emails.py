#!/usr/bin/env python3
"""
Email processor for Sabhya's Daily Task Tracker.
Reads Gmail threads, uses Claude AI to extract tasks, and updates tasks.json.

Run by GitHub Actions every 10 minutes.
Required environment variables:
  GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, ANTHROPIC_API_KEY
"""

import json
import os
import base64
import re
import uuid
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional
from email.utils import parsedate_to_datetime

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import anthropic

TASKS_FILE = "data/tasks.json"
MAX_BODY_CHARS = 4000
MAX_THREADS_PER_RUN = 50


# ─── Gmail helpers ────────────────────────────────────────────────────────────

def get_gmail_service():
    """Build an authenticated Gmail service using stored OAuth2 credentials."""
    creds = Credentials(
        token=None,
        refresh_token=os.environ["GMAIL_REFRESH_TOKEN"],
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds)


def get_header(message: dict, name: str) -> str:
    for h in message.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def extract_text_from_parts(parts: list) -> str:
    text = ""
    for part in parts:
        mime = part.get("mimeType", "")
        if mime == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                text += base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        elif mime == "text/html" and not text:
            data = part.get("body", {}).get("data", "")
            if data:
                html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                text += re.sub(r"<[^>]+>", " ", html)
                text = re.sub(r"&nbsp;", " ", text)
                text = re.sub(r"&amp;", "&", text)
                text = re.sub(r"&lt;", "<", text)
                text = re.sub(r"&gt;", ">", text)
        elif "parts" in part:
            text += extract_text_from_parts(part["parts"])
    return text


def get_message_body(message: dict) -> str:
    payload = message.get("payload", {})
    body = ""
    if "parts" in payload:
        body = extract_text_from_parts(payload["parts"])
    else:
        data = payload.get("body", {}).get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
            if payload.get("mimeType") == "text/html":
                body = re.sub(r"<[^>]+>", " ", body)

    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n{3,}", "\n\n", body.strip())
    return body[:MAX_BODY_CHARS]


def get_threads_to_process(service, db: dict) -> list:
    """Return list of thread IDs that have messages newer than last run."""
    last_processed = db["metadata"].get("lastProcessed")

    if last_processed is None:
        after = datetime.now(timezone.utc) - timedelta(days=30)
        print(f"Initial run – fetching threads from last 30 days (after {after.date()})")
    else:
        after = datetime.fromisoformat(last_processed)
        print(f"Incremental run – fetching threads since {after.isoformat()}")

    after_unix = int(after.timestamp())
    query = f"after:{after_unix} -from:me"  # skip emails sent by yourself

    try:
        result = service.users().messages().list(
            userId="me", q=query, maxResults=200
        ).execute()
        messages = result.get("messages", [])

        # Unique thread IDs preserving order of latest message first
        seen = set()
        thread_ids = []
        for msg in messages:
            tid = msg["threadId"]
            if tid not in seen:
                seen.add(tid)
                thread_ids.append(tid)

        print(f"Found {len(messages)} new messages across {len(thread_ids)} threads")
        return thread_ids[:MAX_THREADS_PER_RUN]
    except HttpError as e:
        print(f"Gmail API error: {e}")
        return []


def get_thread_messages(service, thread_id: str) -> list:
    try:
        thread = service.users().threads().get(userId="me", id=thread_id).execute()
        return thread.get("messages", [])
    except HttpError as e:
        print(f"  Error fetching thread {thread_id}: {e}")
        return []


# ─── Database helpers ──────────────────────────────────────────────────────────

def load_db() -> dict:
    if os.path.exists(TASKS_FILE):
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "metadata": {"version": 1, "lastProcessed": None,
                     "processedThreadIds": [], "threadLastMessageIds": {}},
        "clients": [], "employees": [], "tasks": [],
    }


def save_db(db: dict):
    os.makedirs("data", exist_ok=True)
    with open(TASKS_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    print(f"Saved database: {len(db['tasks'])} tasks, {len(db['clients'])} clients")


def get_or_create_client(db: dict, name: str) -> dict:
    name_clean = name.strip()
    for c in db["clients"]:
        if c["name"].lower() == name_clean.lower():
            return c
    new_client = {
        "id": str(uuid.uuid4()),
        "name": name_clean,
        "order": len(db["clients"]),
        "collapsed": False,
    }
    db["clients"].append(new_client)
    return new_client


def find_task_by_thread(db: dict, thread_id: str) -> Optional[dict]:
    for t in db["tasks"]:
        if t.get("emailThread", {}).get("threadId") == thread_id:
            return t
    return None


# ─── Claude analysis ───────────────────────────────────────────────────────────

def build_thread_text(messages: list) -> str:
    parts = []
    for msg in messages:
        subject = get_header(msg, "subject")
        from_addr = get_header(msg, "from")
        date_str = get_header(msg, "date")
        body = get_message_body(msg)
        parts.append(
            f"--- Email ---\nDate: {date_str}\nFrom: {from_addr}\n"
            f"Subject: {subject}\n\n{body}"
        )
    return "\n\n".join(parts)


def analyze_thread(anthropic_client: anthropic.Anthropic, messages: list,
                   existing_task: Optional[dict]) -> Optional[dict]:
    thread_text = build_thread_text(messages)

    existing_ctx = ""
    if existing_task:
        existing_ctx = (
            f"\nExisting task for this thread:\n"
            f"  ID: {existing_task['id']}\n"
            f"  Title: {existing_task['title']}\n"
            f"  Status: {existing_task['status']}\n"
            f"  Priority: {existing_task['priority']}\n"
        )

    prompt = f"""You are analyzing an email thread to extract actionable task information for a business task tracker.

{thread_text}
{existing_ctx}

Return a single JSON object with these exact keys:
{{
  "should_create_or_update": true,
  "client_name": "Name of the client or company this email is about (never 'Unknown' - infer from domain, signatures, or context)",
  "task_title": "Concise action-oriented title (max 80 chars)",
  "task_description": "What needs to be done and why (2-4 sentences)",
  "priority": "urgent|medium|low",
  "is_completed": false,
  "actionables": ["Specific action item 1", "Action item 2"],
  "next_step_person": "Name or role of who acts next",
  "thread_summary": "Full narrative summary of the conversation (3-6 sentences)",
  "email_summary": "One sentence summary of the latest/most important email"
}}

Priority rules:
- urgent: needs action today or tomorrow, client escalation, missed deadline
- medium: action needed within the week
- low: informational, long-term, FYI

Set should_create_or_update to false ONLY if the email is purely FYI with zero action required.
Set is_completed to true if the latest email clearly shows the issue/request has been fully resolved.

Respond with ONLY the JSON object, no markdown, no commentary."""

    try:
        response = anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  JSON parse error: {e}")
        return None
    except anthropic.APIError as e:
        print(f"  Claude API error: {e}")
        return None


# ─── Core processing ───────────────────────────────────────────────────────────

def process_thread(service, db: dict, anthropic_client: anthropic.Anthropic,
                   thread_id: str):
    thread_msg_ids: dict = db["metadata"].setdefault("threadLastMessageIds", {})
    messages = get_thread_messages(service, thread_id)
    if not messages:
        return

    latest_msg_id = messages[-1]["id"]
    if thread_msg_ids.get(thread_id) == latest_msg_id:
        return  # nothing new

    print(f"  Analyzing thread {thread_id} ({len(messages)} messages)…")

    existing_task = find_task_by_thread(db, thread_id)
    analysis = analyze_thread(anthropic_client, messages, existing_task)

    if not analysis:
        thread_msg_ids[thread_id] = latest_msg_id
        return

    if not analysis.get("should_create_or_update", True):
        print(f"  → No action needed")
        thread_msg_ids[thread_id] = latest_msg_id
        return

    client_name = analysis.get("client_name") or "General"
    client = get_or_create_client(db, client_name)

    first_msg = messages[0]
    subject = get_header(first_msg, "subject") or "(no subject)"
    participants = list({get_header(m, "from") for m in messages if get_header(m, "from")})
    now = datetime.now(timezone.utc).isoformat()

    if existing_task:
        existing_task["title"] = analysis.get("task_title", existing_task["title"])
        existing_task["description"] = analysis.get("task_description", existing_task["description"])
        existing_task["updatedAt"] = now
        # Respect manual priority overrides
        if not existing_task.get("priorityManuallySet"):
            existing_task["priority"] = analysis.get("priority", existing_task["priority"])
        # Auto-complete if resolved
        if analysis.get("is_completed") and existing_task["status"] == "pending":
            existing_task["status"] = "completed"
            existing_task["completedAt"] = now
        # Update thread info
        et = existing_task["emailThread"]
        et["summary"] = analysis.get("thread_summary", "")
        et["emailSummary"] = analysis.get("email_summary", "")
        et["actionables"] = analysis.get("actionables", [])
        et["nextStepPerson"] = analysis.get("next_step_person", "")
        et["participants"] = participants
        et["messageCount"] = len(messages)
        print(f"  → Updated: {existing_task['title']}")
    else:
        is_done = analysis.get("is_completed", False)
        new_task = {
            "id": str(uuid.uuid4()),
            "clientId": client["id"],
            "title": analysis.get("task_title", "Untitled Task"),
            "description": analysis.get("task_description", ""),
            "priority": analysis.get("priority", "medium"),
            "priorityManuallySet": False,
            "status": "completed" if is_done else "pending",
            "assignedTo": None,
            "emailThread": {
                "subject": subject,
                "threadId": thread_id,
                "participants": participants,
                "summary": analysis.get("thread_summary", ""),
                "emailSummary": analysis.get("email_summary", ""),
                "actionables": analysis.get("actionables", []),
                "nextStepPerson": analysis.get("next_step_person", ""),
                "messageCount": len(messages),
            },
            "createdAt": now,
            "updatedAt": now,
            "completedAt": now if is_done else None,
        }
        db["tasks"].append(new_task)
        print(f"  → Created: {new_task['title']} [{client_name}] [{new_task['priority']}]")

    thread_msg_ids[thread_id] = latest_msg_id


def main():
    print(f"\n{'='*60}")
    print(f"Task Tracker Email Processor – {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*60}\n")

    db = load_db()
    if db["metadata"].get("createdAt") is None:
        db["metadata"]["createdAt"] = datetime.now(timezone.utc).isoformat()

    print("Connecting to Gmail…")
    service = get_gmail_service()

    anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    thread_ids = get_threads_to_process(service, db)

    if not thread_ids:
        print("No new threads to process.")
    else:
        for i, tid in enumerate(thread_ids, 1):
            print(f"\n[{i}/{len(thread_ids)}] Thread {tid}")
            try:
                process_thread(service, db, anthropic_client, tid)
            except Exception as exc:
                print(f"  ERROR: {exc}")

    db["metadata"]["lastProcessed"] = datetime.now(timezone.utc).isoformat()
    save_db(db)

    # Summary
    total = len(db["tasks"])
    pending = sum(1 for t in db["tasks"] if t["status"] == "pending")
    urgent = sum(1 for t in db["tasks"] if t["priority"] == "urgent" and t["status"] == "pending")
    print(f"\n{'='*60}")
    print(f"Done. Tasks: {total} total | {pending} pending | {urgent} urgent")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
