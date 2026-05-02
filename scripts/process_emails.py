#!/usr/bin/env python3
"""
Email processing script for Sabhya's Daily Task Tracker.
Fetches Gmail, processes with Claude AI, updates JSON task database.
"""

import os
import json
import base64
import hashlib
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from email import message_from_bytes
from email.header import decode_header, make_header

import anthropic
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import pytz

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
TASKS_FILE = os.path.join(DATA_DIR, "tasks.json")
CLIENTS_FILE = os.path.join(DATA_DIR, "clients.json")
EMPLOYEES_FILE = os.path.join(DATA_DIR, "employees.json")
SYNC_STATE_FILE = os.path.join(DATA_DIR, "sync_state.json")

# ── Constants ──────────────────────────────────────────────────────────────
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
MAX_EMAILS_PER_RUN = 200
FIRST_RUN_DAYS = 30
BATCH_SIZE = 10  # emails sent to Claude per API call


# ── Helpers ────────────────────────────────────────────────────────────────

def load_json(path: str, default: dict) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_task_id(thread_id: str, subject: str, idx: int = 0) -> str:
    raw = f"{thread_id}:{subject}:{idx}"
    return "task_" + hashlib.md5(raw.encode()).hexdigest()[:12]


def make_client_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]", "_", name.lower().strip())
    return "client_" + slug[:24]


def decode_mime_header(header: str) -> str:
    try:
        return str(make_header(decode_header(header or "")))
    except Exception:
        return header or ""


# ── Gmail Auth ─────────────────────────────────────────────────────────────

def get_gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=os.environ["GMAIL_REFRESH_TOKEN"],
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=GMAIL_SCOPES,
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# ── Email Fetching ─────────────────────────────────────────────────────────

def get_email_body(payload: dict) -> str:
    """Recursively extract plain text body from Gmail message payload."""
    parts = payload.get("parts", [])
    if not parts:
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        return ""

    text = ""
    for part in parts:
        mime = part.get("mimeType", "")
        if mime == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                text += base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        elif mime.startswith("multipart/"):
            text += get_email_body(part)

    return text.strip()


def fetch_thread_messages(service, thread_id: str) -> list:
    """Fetch all messages in a Gmail thread."""
    try:
        thread = service.users().threads().get(userId="me", id=thread_id, format="full").execute()
        messages = []
        for msg in thread.get("messages", []):
            headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
            body = get_email_body(msg.get("payload", {}))
            messages.append({
                "id": msg["id"],
                "date": headers.get("Date", ""),
                "from": decode_mime_header(headers.get("From", "")),
                "to": decode_mime_header(headers.get("To", "")),
                "subject": decode_mime_header(headers.get("Subject", "")),
                "body": body[:3000],  # cap to avoid token overflow
            })
        return messages
    except HttpError as e:
        print(f"  Warning: could not fetch thread {thread_id}: {e}")
        return []


def list_new_threads(service, sync_state: dict, force_full: bool) -> list:
    """Return list of thread IDs to process, respecting sync state."""
    query_parts = ["in:inbox OR in:sent"]

    if force_full or not sync_state.get("first_run_completed"):
        cutoff = datetime.now(timezone.utc) - timedelta(days=FIRST_RUN_DAYS)
        query_parts.append(f"after:{int(cutoff.timestamp())}")
        print(f"First-run / full-sync mode: fetching emails from last {FIRST_RUN_DAYS} days")
    elif sync_state.get("last_sync_time"):
        cutoff = datetime.fromisoformat(sync_state["last_sync_time"]) - timedelta(minutes=5)
        query_parts.append(f"after:{int(cutoff.timestamp())}")
        print(f"Incremental sync since: {cutoff.isoformat()}")

    query = " ".join(query_parts)
    thread_ids = []
    page_token = None

    while True:
        try:
            params = {"userId": "me", "q": query, "maxResults": 100}
            if page_token:
                params["pageToken"] = page_token
            resp = service.users().threads().list(**params).execute()
            threads = resp.get("threads", [])
            thread_ids.extend(t["id"] for t in threads)
            page_token = resp.get("nextPageToken")
            if not page_token or len(thread_ids) >= MAX_EMAILS_PER_RUN:
                break
        except HttpError as e:
            print(f"Error listing threads: {e}")
            break

    return thread_ids[:MAX_EMAILS_PER_RUN]


# ── Claude Processing ──────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an intelligent email-to-task extraction assistant for a professional task tracker.
Your job is to analyze email threads and extract structured task information.

Rules:
1. Identify the CLIENT NAME from email domain, contact name, company references, or subject matter.
   - If no clear client, use "Internal" as client name.
2. Extract all ACTIONABLE ITEMS as individual tasks.
3. Determine PRIORITY: urgent (deadlines within 48h or explicit urgent language), medium (general work items), low (informational/FYI).
4. Determine COMPLETION STATUS: if latest emails indicate the matter is resolved/done/closed, mark as completed.
5. Identify the PERSON RESPONSIBLE for next steps (either the user or someone mentioned in the email).
6. Write a SUMMARY of the full thread conversation in 2-4 sentences.
7. For TASK TITLE: make it concise and action-oriented (max 80 chars).
8. Return ONLY valid JSON. No explanation text outside JSON.

Output format:
{
  "client_name": "string",
  "tasks": [
    {
      "title": "string",
      "priority": "urgent|medium|low",
      "status": "pending|completed",
      "responsible_person": "string",
      "actionables": ["string", ...],
      "thread_summary": "string",
      "due_date_hint": "string or null"
    }
  ]
}
"""


def process_thread_with_claude(client: anthropic.Anthropic, thread_messages: list) -> dict | None:
    """Send thread to Claude and parse the structured task response."""
    if not thread_messages:
        return None

    subject = thread_messages[0].get("subject", "(no subject)")
    thread_text = f"Email Thread: {subject}\n\n"
    for i, msg in enumerate(thread_messages, 1):
        thread_text += (
            f"--- Message {i} ---\n"
            f"From: {msg['from']}\n"
            f"To: {msg['to']}\n"
            f"Date: {msg['date']}\n"
            f"Body:\n{msg['body']}\n\n"
        )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": thread_text}],
        )
        raw = response.content[0].text.strip()

        # Strip markdown code fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        return json.loads(raw)
    except (json.JSONDecodeError, anthropic.APIError, IndexError) as e:
        print(f"  Claude error: {e}")
        return None


# ── Database Updates ───────────────────────────────────────────────────────

def upsert_client(clients_db: dict, client_name: str) -> str:
    """Return client_id, creating client if it doesn't exist."""
    client_id = make_client_id(client_name)
    existing = {c["id"]: c for c in clients_db.get("clients", [])}

    if client_id not in existing:
        clients_db.setdefault("clients", []).append({
            "id": client_id,
            "name": client_name,
            "created_at": utc_now_iso(),
            "order": len(clients_db["clients"]),
        })
    return client_id


def upsert_task(tasks_db: dict, task_data: dict, thread_id: str,
                thread_messages: list, client_id: str, client_name: str) -> None:
    """Insert or update a task in the database."""
    subject = thread_messages[0].get("subject", "") if thread_messages else ""
    task_id = make_task_id(thread_id, task_data["title"])

    existing_map = {t["id"]: t for t in tasks_db.get("tasks", [])}

    email_refs = [m["id"] for m in thread_messages]
    thread_summary_msgs = [
        {"from": m["from"], "date": m["date"], "snippet": m["body"][:500]}
        for m in thread_messages
    ]

    if task_id in existing_map:
        task = existing_map[task_id]
        # Update fields — never overwrite manual user changes to priority/assignee
        task["thread_summary"] = task_data.get("thread_summary", task.get("thread_summary", ""))
        task["actionables"] = task_data.get("actionables", task.get("actionables", []))
        task["responsible_person"] = task_data.get("responsible_person", task.get("responsible_person", ""))
        task["email_refs"] = list(set(task.get("email_refs", []) + email_refs))
        task["thread_messages"] = thread_summary_msgs
        task["updated_at"] = utc_now_iso()
        # Auto-complete only if Claude is confident
        if task_data.get("status") == "completed" and task["status"] == "pending":
            task["status"] = "completed"
            task["completed_at"] = utc_now_iso()
    else:
        new_task = {
            "id": task_id,
            "title": task_data["title"],
            "priority": task_data.get("priority", "medium"),
            "status": task_data.get("status", "pending"),
            "client_id": client_id,
            "client_name": client_name,
            "responsible_person": task_data.get("responsible_person", ""),
            "assigned_to": "",
            "thread_summary": task_data.get("thread_summary", ""),
            "actionables": task_data.get("actionables", []),
            "due_date_hint": task_data.get("due_date_hint"),
            "email_refs": email_refs,
            "thread_messages": thread_summary_msgs,
            "thread_subject": subject,
            "thread_id": thread_id,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "completed_at": None,
            "manually_edited": False,
        }
        tasks_db.setdefault("tasks", []).append(new_task)


# ── Main Orchestration ─────────────────────────────────────────────────────

def main():
    print(f"[{utc_now_iso()}] Starting email sync...")

    # Check required secrets
    required_env = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "ANTHROPIC_API_KEY"]
    missing = [e for e in required_env if not os.environ.get(e)]
    if missing:
        print(f"ERROR: Missing environment variables: {', '.join(missing)}")
        print("Please add these as GitHub repository secrets.")
        sys.exit(1)

    force_full = os.environ.get("FORCE_FULL_SYNC", "false").lower() == "true"

    # Load databases
    tasks_db = load_json(TASKS_FILE, {"version": "1.0", "last_updated": "", "tasks": []})
    clients_db = load_json(CLIENTS_FILE, {"version": "1.0", "clients": []})
    sync_state = load_json(SYNC_STATE_FILE, {
        "version": "1.0", "last_sync_time": "", "last_message_id": "",
        "total_emails_processed": 0, "first_run_completed": False, "sync_history": []
    })

    # Connect to Gmail
    print("Connecting to Gmail...")
    service = get_gmail_service()

    # Connect to Claude
    claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Get thread IDs to process
    thread_ids = list_new_threads(service, sync_state, force_full)
    print(f"Found {len(thread_ids)} threads to process")

    if not thread_ids:
        print("No new threads. Updating sync timestamp.")
        sync_state["last_sync_time"] = utc_now_iso()
        save_json(SYNC_STATE_FILE, sync_state)
        return

    processed = 0
    errors = 0

    for i, thread_id in enumerate(thread_ids, 1):
        print(f"  [{i}/{len(thread_ids)}] Processing thread {thread_id}...")
        try:
            messages = fetch_thread_messages(service, thread_id)
            if not messages:
                continue

            result = process_thread_with_claude(claude, messages)
            if not result:
                errors += 1
                continue

            client_name = result.get("client_name", "Unknown")
            client_id = upsert_client(clients_db, client_name)

            for task_data in result.get("tasks", []):
                upsert_task(tasks_db, task_data, thread_id, messages, client_id, client_name)

            processed += 1

            # Respect rate limits
            if i % 10 == 0:
                time.sleep(1)

        except Exception as e:
            print(f"  Error processing thread {thread_id}: {e}")
            errors += 1
            continue

    # Update metadata
    now = utc_now_iso()
    tasks_db["last_updated"] = now
    sync_state["last_sync_time"] = now
    sync_state["total_emails_processed"] = sync_state.get("total_emails_processed", 0) + processed
    sync_state["first_run_completed"] = True
    sync_state.setdefault("sync_history", []).append({
        "time": now,
        "threads_found": len(thread_ids),
        "threads_processed": processed,
        "errors": errors,
    })
    # Keep only last 100 history entries
    sync_state["sync_history"] = sync_state["sync_history"][-100:]

    # Save all databases
    save_json(TASKS_FILE, tasks_db)
    save_json(CLIENTS_FILE, clients_db)
    save_json(SYNC_STATE_FILE, sync_state)

    print(f"\nSync complete: {processed} threads processed, {errors} errors")
    print(f"Total tasks in DB: {len(tasks_db.get('tasks', []))}")
    print(f"Total clients: {len(clients_db.get('clients', []))}")


if __name__ == "__main__":
    main()
