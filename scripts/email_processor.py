#!/usr/bin/env python3
"""
Email processor for Sabhya's Daily Task Tracker.
Reads Gmail threads, analyses them with Claude AI, and updates data/tasks.json.
"""

import os
import re
import json
import uuid
import base64
import traceback
from datetime import datetime, timedelta, timezone

import anthropic
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

TASKS_PATH = "data/tasks.json"
MAX_BODY_CHARS = 4000   # per-message body limit sent to Claude
MAX_MESSAGES_PER_THREAD = 10


def get_gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=os.environ["GMAIL_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds)


def get_header(headers, name):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def decode_body(data):
    try:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
    except Exception:
        return ""


def extract_text(payload):
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        raw = payload.get("body", {}).get("data", "")
        if raw:
            return decode_body(raw)
    if mime == "text/html":
        raw = payload.get("body", {}).get("data", "")
        if raw:
            html = decode_body(raw)
            text = re.sub(r"<[^>]+>", " ", html)
            text = re.sub(r"\s{2,}", " ", text)
            return text.strip()
    if "parts" in payload:
        # Prefer plain text; fall back to html
        plain = next((p for p in payload["parts"] if p.get("mimeType") == "text/plain"), None)
        if plain:
            result = extract_text(plain)
            if result:
                return result
        for part in payload["parts"]:
            result = extract_text(part)
            if result:
                return result
    return ""


def parse_thread(thread):
    messages = []
    for msg in thread.get("messages", [])[-MAX_MESSAGES_PER_THREAD:]:
        headers = msg.get("payload", {}).get("headers", [])
        body = extract_text(msg.get("payload", {}))
        messages.append(
            {
                "messageId": msg["id"],
                "from": get_header(headers, "from"),
                "to": get_header(headers, "to"),
                "cc": get_header(headers, "cc"),
                "date": get_header(headers, "date"),
                "subject": get_header(headers, "subject"),
                "body": body[:MAX_BODY_CHARS],
            }
        )
    return messages


def build_thread_text(messages):
    parts = []
    for i, m in enumerate(messages, 1):
        parts.append(
            f"[Message {i}]\nFrom: {m['from']}\nTo: {m['to']}\n"
            f"Date: {m['date']}\nSubject: {m['subject']}\n\n{m['body']}"
        )
    return "\n\n---\n\n".join(parts)


def analyse_with_claude(client: anthropic.Anthropic, messages: list, existing_task: dict = None) -> dict | None:
    thread_text = build_thread_text(messages)
    existing_ctx = ""
    if existing_task:
        existing_ctx = (
            f"\n\nEXISTING TASK (update it if needed):\n"
            f"Title: {existing_task.get('title')}\n"
            f"Priority: {existing_task.get('priority')}\n"
            f"Status: {existing_task.get('status')}\n"
            f"Description: {existing_task.get('description', '')[:500]}"
        )

    prompt = f"""Analyse the following email thread and extract structured task information.{existing_ctx}

EMAIL THREAD:
{thread_text}

Respond with ONLY valid JSON (no markdown, no extra text) matching this schema exactly:
{{
  "clientName": "<company or person this email is ABOUT – not the sender>",
  "taskTitle": "<concise actionable title, max 80 chars>",
  "taskDescription": "<detailed description of what needs to be done>",
  "priority": "<urgent|medium|low>",
  "status": "<pending|completed>",
  "actionables": ["<action 1>", "<action 2>"],
  "responsiblePerson": "<name of person responsible for next steps>",
  "summary": "<2-4 sentence summary of the full thread>",
  "taskClosed": <true if fully resolved, else false>
}}

Rules:
- clientName: the company/person the email is ABOUT (e.g. a client being served). Use domain from addresses if unclear.
- priority: urgent = time-sensitive or explicitly urgent; medium = normal business; low = FYI/informational.
- status: completed if the latest message(s) confirm the matter is fully resolved.
- taskClosed: true only when all actionables are clearly done."""

    try:
        response = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Strip potential markdown fences
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"  ⚠ Claude returned invalid JSON: {e}")
        return None
    except Exception as e:
        print(f"  ⚠ Claude API error: {e}")
        return None


def load_tasks() -> dict:
    try:
        with open(TASKS_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {
            "version": "1.0",
            "lastUpdated": None,
            "lastEmailCheck": None,
            "clients": {},
            "employees": [],
            "stats": {"total": 0, "pending": 0, "completed": 0, "urgent": 0, "medium": 0, "low": 0},
        }


def save_tasks(db: dict):
    db["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    with open(TASKS_PATH, "w") as f:
        json.dump(db, f, indent=2, default=str)


def recalculate_stats(db: dict):
    total = pending = completed = urgent = medium = low = 0
    for client in db["clients"].values():
        for task in client["tasks"]:
            total += 1
            if task["status"] == "completed":
                completed += 1
            else:
                pending += 1
            p = task.get("priority", "medium")
            if p == "urgent":
                urgent += 1
            elif p == "medium":
                medium += 1
            else:
                low += 1
    db["stats"] = {
        "total": total,
        "pending": pending,
        "completed": completed,
        "urgent": urgent,
        "medium": medium,
        "low": low,
    }


def find_or_create_client(db: dict, name: str) -> str:
    name_lower = name.strip().lower()
    for cid, cdata in db["clients"].items():
        if cdata["name"].lower() == name_lower:
            return cid
    new_id = str(uuid.uuid4())
    db["clients"][new_id] = {
        "id": new_id,
        "name": name.strip(),
        "order": len(db["clients"]),
        "tasks": [],
    }
    return new_id


def build_thread_index(db: dict) -> dict:
    idx = {}
    for client in db["clients"].values():
        for task in client["tasks"]:
            tid = task.get("emailThreadId")
            if tid:
                idx[tid] = (client["id"], task)
    return idx


def apply_analysis(task: dict, analysis: dict, messages: list, now: str):
    task["title"] = analysis.get("taskTitle", task.get("title", "Untitled Task"))
    task["description"] = analysis.get("taskDescription", task.get("description", ""))
    task["priority"] = analysis.get("priority", task.get("priority", "medium"))
    task["emailSummary"] = analysis.get("summary", "")
    task["actionables"] = analysis.get("actionables", [])
    task["responsiblePerson"] = analysis.get("responsiblePerson", "")
    task["emailMessages"] = messages
    task["updatedAt"] = now
    if analysis.get("taskClosed") or analysis.get("status") == "completed":
        if task.get("status") != "completed":
            task["status"] = "completed"
            task["completedAt"] = now


def fetch_all_threads(service, query: str) -> list:
    threads = []
    page_token = None
    while True:
        kwargs = {"userId": "me", "q": query, "maxResults": 500}
        if page_token:
            kwargs["pageToken"] = page_token
        resp = service.users().threads().list(**kwargs).execute()
        threads.extend(resp.get("threads", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return threads


def main():
    print("🚀 Email Task Processor starting…")

    db = load_tasks()
    last_check_str = db.get("lastEmailCheck")

    # Build Gmail query
    if last_check_str:
        last_check = datetime.fromisoformat(last_check_str.replace("Z", "+00:00"))
        after_ts = int(last_check.timestamp())
        query = f"after:{after_ts}"
        print(f"  Fetching emails since {last_check.strftime('%Y-%m-%d %H:%M UTC')}")
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        query = f"after:{int(cutoff.timestamp())}"
        print("  First run — fetching last 30 days of emails")

    gmail = get_gmail_service()
    claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    thread_refs = fetch_all_threads(gmail, query)
    print(f"  Found {len(thread_refs)} thread(s) to process")

    thread_idx = build_thread_index(db)
    processed = updated = created = 0

    for ref in thread_refs:
        thread_id = ref["id"]
        try:
            thread = gmail.users().threads().get(userId="me", id=thread_id, format="full").execute()
            messages = parse_thread(thread)
            if not messages:
                continue

            existing_client_id, existing_task = thread_idx.get(thread_id, (None, None))
            analysis = analyse_with_claude(claude, messages, existing_task)
            if not analysis:
                continue

            client_name = analysis.get("clientName") or "Unknown Client"
            now = datetime.now(timezone.utc).isoformat()

            if existing_task:
                # Move task to new client bucket if clientName changed
                new_client_id = find_or_create_client(db, client_name)
                if new_client_id != existing_client_id:
                    old_tasks = db["clients"][existing_client_id]["tasks"]
                    old_tasks[:] = [t for t in old_tasks if t["id"] != existing_task["id"]]
                    db["clients"][new_client_id]["tasks"].append(existing_task)
                    existing_task["clientId"] = new_client_id

                apply_analysis(existing_task, analysis, messages, now)
                updated += 1
                print(f"  ✏  Updated: {existing_task['title'][:60]}")
            else:
                client_id = find_or_create_client(db, client_name)
                new_task = {
                    "id": str(uuid.uuid4()),
                    "clientId": client_id,
                    "title": analysis.get("taskTitle", "Untitled Task"),
                    "description": analysis.get("taskDescription", ""),
                    "priority": analysis.get("priority", "medium"),
                    "status": "completed" if analysis.get("taskClosed") else "pending",
                    "assignee": None,
                    "createdAt": now,
                    "updatedAt": now,
                    "completedAt": now if analysis.get("taskClosed") else None,
                    "emailThreadId": thread_id,
                    "emailThreadSubject": messages[0]["subject"] if messages else "",
                    "emailParticipants": list({m["from"] for m in messages if m["from"]}),
                    "emailSummary": analysis.get("summary", ""),
                    "actionables": analysis.get("actionables", []),
                    "responsiblePerson": analysis.get("responsiblePerson", ""),
                    "emailMessages": messages,
                }
                db["clients"][client_id]["tasks"].append(new_task)
                thread_idx[thread_id] = (client_id, new_task)
                created += 1
                print(f"  ✅ Created: {new_task['title'][:60]}")

            processed += 1

        except HttpError as e:
            print(f"  ✗ Gmail API error for thread {thread_id}: {e}")
        except Exception:
            print(f"  ✗ Unexpected error for thread {thread_id}:")
            traceback.print_exc()

    recalculate_stats(db)
    db["lastEmailCheck"] = datetime.now(timezone.utc).isoformat()
    save_tasks(db)

    print(
        f"\n✔ Done — processed {processed} threads "
        f"({created} created, {updated} updated). "
        f"Stats: {db['stats']}"
    )


if __name__ == "__main__":
    main()
