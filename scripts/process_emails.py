#!/usr/bin/env python3
"""
Email processor for Sabhya's Daily Tracker.
Reads Gmail, analyzes threads with Claude, updates tasks.json.
"""
import os
import json
import uuid
import base64
import datetime
import traceback
from email import message_from_bytes
from email.header import decode_header

import requests
from anthropic import Anthropic
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from dateutil import parser as dateparser

REPO_OWNER = os.environ.get("REPO_OWNER", "")
REPO_NAME = os.environ.get("REPO_NAME", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GMAIL_CLIENT_ID = os.environ.get("GMAIL_CLIENT_ID", "")
GMAIL_CLIENT_SECRET = os.environ.get("GMAIL_CLIENT_SECRET", "")
GMAIL_REFRESH_TOKEN = os.environ.get("GMAIL_REFRESH_TOKEN", "")

DATA_PATH = "data"
TASKS_FILE = f"{DATA_PATH}/tasks.json"
META_FILE = f"{DATA_PATH}/metadata.json"

MAX_THREADS_PER_RUN = 50
MAX_MESSAGES_PER_THREAD = 20
MAX_BODY_CHARS = 3000


def get_gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=GMAIL_REFRESH_TOKEN,
        client_id=GMAIL_CLIENT_ID,
        client_secret=GMAIL_CLIENT_SECRET,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds)


def github_get_file(path):
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/{path}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
    r = requests.get(url, headers=headers)
    if r.status_code == 200:
        data = r.json()
        content = base64.b64decode(data["content"]).decode("utf-8")
        return json.loads(content), data["sha"]
    return None, None


def github_put_file(path, content_dict, sha, message):
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/{path}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
    body = base64.b64encode(json.dumps(content_dict, indent=2, ensure_ascii=False).encode()).decode()
    payload = {"message": message, "content": body}
    if sha:
        payload["sha"] = sha
    r = requests.put(url, headers=headers, json=payload)
    r.raise_for_status()


def decode_str(s):
    if not s:
        return ""
    parts = decode_header(s)
    decoded = []
    for part, enc in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return " ".join(decoded)


def extract_body(payload):
    """Recursively extract plain text body from Gmail message payload."""
    body = ""
    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    elif payload.get("mimeType", "").startswith("multipart"):
        for part in payload.get("parts", []):
            body += extract_body(part)
    return body


def get_header(headers, name):
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def fetch_thread_messages(service, thread_id):
    thread = service.users().threads().get(userId="me", id=thread_id, format="full").execute()
    messages = []
    for msg in thread.get("messages", [])[:MAX_MESSAGES_PER_THREAD]:
        headers = msg["payload"].get("headers", [])
        body = extract_body(msg["payload"])[:MAX_BODY_CHARS]
        messages.append({
            "id": msg["id"],
            "from": get_header(headers, "From"),
            "to": get_header(headers, "To"),
            "cc": get_header(headers, "Cc"),
            "subject": decode_str(get_header(headers, "Subject")),
            "date": get_header(headers, "Date"),
            "body": body,
            "threadId": thread_id,
        })
    return messages


def analyze_thread_with_claude(client, messages, existing_tasks, clients):
    """Use Claude to extract tasks and summaries from an email thread."""
    thread_text = ""
    for i, m in enumerate(messages):
        thread_text += f"\n--- Message {i+1} ---\n"
        thread_text += f"From: {m['from']}\nTo: {m['to']}\nDate: {m['date']}\n"
        thread_text += f"Subject: {m['subject']}\n\n{m['body']}\n"

    existing_context = json.dumps(
        [{"id": t["id"], "title": t["title"], "clientName": t["clientName"],
          "status": t["status"], "priority": t["priority"]}
         for t in existing_tasks],
        indent=2
    )

    client_list = json.dumps([c["name"] for c in clients], indent=2)

    prompt = f"""You are an expert business task manager. Analyze this email thread and extract actionable task information.

EXISTING CLIENTS (use exact names if matching):
{client_list}

EXISTING TASKS (for context and matching):
{existing_context}

EMAIL THREAD:
{thread_text}

Analyze the thread and return ONLY a valid JSON object (no markdown, no extra text) with this structure:
{{
  "clientName": "exact client/company name from email (use existing client name if it matches)",
  "threadSubject": "main subject of the thread",
  "threadSummary": "2-4 sentence summary of the entire conversation",
  "isResolved": true/false (whether the thread indicates task completion),
  "tasks": [
    {{
      "matchingTaskId": "existing task id to update, or null for new task",
      "title": "concise task title (max 80 chars)",
      "description": "detailed task description",
      "priority": "urgent|medium|low",
      "actionables": ["specific action item 1", "specific action item 2"],
      "nextResponsible": "name or role of person who needs to act next",
      "isCompleted": true/false
    }}
  ]
}}

Priority guidelines:
- urgent: deadline within 48h, legal/financial matters, explicit urgency
- medium: deadline within 1-2 weeks, follow-up needed
- low: informational, long-term, no explicit deadline

If the thread is purely informational with no action needed, return an empty tasks array."""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    # Strip any markdown code blocks if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    return json.loads(text)


def merge_tasks(existing_tasks, analysis, thread_id, messages, thread_subject):
    """Merge analysis results into the existing task list."""
    now = datetime.datetime.utcnow().isoformat() + "Z"
    updated_ids = []
    new_tasks = []

    thread_summary_obj = {
        "threadId": thread_id,
        "subject": thread_subject,
        "summary": analysis.get("threadSummary", ""),
        "lastMessageDate": messages[-1]["date"] if messages else "",
        "messageCount": len(messages),
    }

    for task_data in analysis.get("tasks", []):
        matching_id = task_data.get("matchingTaskId")
        is_completed = task_data.get("isCompleted", False) or analysis.get("isResolved", False)

        existing = next((t for t in existing_tasks if t["id"] == matching_id), None)

        if existing:
            # Update existing task (but don't override manually set fields)
            manual = existing.get("manualFields", {})

            # Update thread summaries (add if thread not already tracked)
            thread_ids = [s["threadId"] for s in existing.get("threadSummaries", [])]
            if thread_id not in thread_ids:
                existing.setdefault("threadSummaries", []).append(thread_summary_obj)

            existing["updatedAt"] = now
            existing["actionables"] = task_data.get("actionables", existing.get("actionables", []))
            existing["nextResponsible"] = task_data.get("nextResponsible", existing.get("nextResponsible"))
            existing["description"] = task_data.get("description", existing.get("description"))

            # Only update priority/status if not manually set
            if "priority" not in manual:
                existing["priority"] = task_data.get("priority", existing["priority"])
            if "status" not in manual:
                if is_completed and existing["status"] == "pending":
                    existing["status"] = "completed"
                    existing["completedAt"] = now

            updated_ids.append(existing["id"])
        else:
            new_task = {
                "id": str(uuid.uuid4()),
                "clientName": analysis.get("clientName", "Unknown"),
                "title": task_data.get("title", "Untitled Task"),
                "description": task_data.get("description", ""),
                "priority": task_data.get("priority", "medium"),
                "status": "completed" if is_completed else "pending",
                "assignee": None,
                "threadSummaries": [thread_summary_obj],
                "actionables": task_data.get("actionables", []),
                "nextResponsible": task_data.get("nextResponsible"),
                "createdAt": now,
                "updatedAt": now,
                "completedAt": now if is_completed else None,
                "manualFields": {},
                "sourceThreadId": thread_id,
            }
            new_tasks.append(new_task)

    return updated_ids, new_tasks


def ensure_client(clients, name):
    existing = next((c for c in clients if c["name"].lower() == name.lower()), None)
    if existing:
        return existing
    colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
              "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e"]
    new_client = {
        "id": str(uuid.uuid4()),
        "name": name,
        "color": colors[len(clients) % len(colors)],
        "order": len(clients),
        "createdAt": datetime.datetime.utcnow().isoformat() + "Z",
    }
    clients.append(new_client)
    return new_client


def main():
    print("Starting email processor...")

    if not all([GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, ANTHROPIC_API_KEY, GITHUB_TOKEN]):
        print("ERROR: Missing required environment variables")
        return

    # Load existing data from GitHub
    tasks_data, tasks_sha = github_get_file(TASKS_FILE)
    meta_data, meta_sha = github_get_file(META_FILE)

    if not tasks_data:
        tasks_data = {"version": "1.0", "tasks": [], "clients": [], "lastUpdated": None, "totalEmailsProcessed": 0}
        tasks_sha = None
    if not meta_data:
        meta_data = {"isFirstRun": True, "lastProcessedAt": None, "lastEmailHistoryId": None,
                     "totalEmailsProcessed": 0, "lastSyncAt": None, "processingErrors": []}
        meta_sha = None

    tasks = tasks_data.get("tasks", [])
    clients = tasks_data.get("clients", [])

    # Connect to Gmail
    service = get_gmail_service()
    claude_client = Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build Gmail query
    is_first_run = meta_data.get("isFirstRun", True)
    if is_first_run:
        thirty_days_ago = (datetime.datetime.utcnow() - datetime.timedelta(days=30)).strftime("%Y/%m/%d")
        query = f"after:{thirty_days_ago}"
        print(f"First run: fetching emails since {thirty_days_ago}")
    else:
        last_processed = meta_data.get("lastProcessedAt")
        if last_processed:
            dt = dateparser.parse(last_processed)
            query = f"after:{dt.strftime('%Y/%m/%d')}"
        else:
            query = "newer_than:1d"
        print(f"Incremental run: query={query}")

    # Fetch threads
    result = service.users().threads().list(
        userId="me", q=query, maxResults=MAX_THREADS_PER_RUN
    ).execute()
    threads = result.get("threads", [])
    print(f"Found {len(threads)} threads to process")

    processed_count = 0
    errors = []
    processed_thread_ids = set(
        s["threadId"]
        for t in tasks
        for s in t.get("threadSummaries", [])
    )

    for thread in threads:
        thread_id = thread["id"]
        if thread_id in processed_thread_ids and not is_first_run:
            # Still check for updates on existing threads
            pass

        try:
            messages = fetch_thread_messages(service, thread_id)
            if not messages:
                continue

            thread_subject = messages[0].get("subject", "No Subject")
            print(f"  Processing: {thread_subject[:60]}...")

            analysis = analyze_thread_with_claude(claude_client, messages, tasks, clients)

            client_name = analysis.get("clientName", "Unknown")
            if client_name and client_name != "Unknown":
                ensure_client(clients, client_name)

            updated_ids, new_tasks = merge_tasks(tasks, analysis, thread_id, messages, thread_subject)
            tasks.extend(new_tasks)
            processed_count += 1

        except Exception as e:
            err_msg = f"Thread {thread_id}: {str(e)}"
            print(f"  ERROR: {err_msg}")
            errors.append({"thread": thread_id, "error": str(e), "time": datetime.datetime.utcnow().isoformat()})

    # Update data
    now = datetime.datetime.utcnow().isoformat() + "Z"
    tasks_data["tasks"] = tasks
    tasks_data["clients"] = clients
    tasks_data["lastUpdated"] = now
    tasks_data["totalEmailsProcessed"] = tasks_data.get("totalEmailsProcessed", 0) + processed_count

    meta_data["isFirstRun"] = False
    meta_data["lastProcessedAt"] = now
    meta_data["lastSyncAt"] = now
    meta_data["totalEmailsProcessed"] = meta_data.get("totalEmailsProcessed", 0) + processed_count
    if errors:
        meta_data["processingErrors"] = (meta_data.get("processingErrors", []) + errors)[-20:]

    # Save to GitHub
    github_put_file(
        TASKS_FILE, tasks_data, tasks_sha,
        f"chore: update tasks ({processed_count} threads processed) [skip ci]"
    )
    github_put_file(
        META_FILE, meta_data, meta_sha,
        f"chore: update metadata [skip ci]"
    )

    print(f"Done. Processed {processed_count} threads, {len(new_tasks)} new tasks created.")


if __name__ == "__main__":
    main()
