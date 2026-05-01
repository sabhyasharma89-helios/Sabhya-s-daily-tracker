#!/usr/bin/env python3
"""
Email Task Processor
Reads Gmail, uses Claude to extract tasks, updates tasks.json
"""

import os
import json
import uuid
import re
import base64
from datetime import datetime, timedelta, timezone

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import anthropic

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASKS_FILE = os.path.join(REPO_ROOT, "data", "tasks.json")
USER_UPDATES_FILE = os.path.join(REPO_ROOT, "data", "user_updates.json")

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

CLIENT_COLORS = [
    "#6366f1", "#ec4899", "#f59e0b", "#10b981",
    "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4",
    "#84cc16", "#f97316", "#14b8a6", "#a855f7"
]

SKIP_CLIENTS = {"automated/newsletter", "automated", "newsletter", "no-reply", "noreply"}


# ── Credentials ───────────────────────────────────────────────────────────────

def load_credentials():
    creds_path = os.environ.get("GMAIL_CREDENTIALS_PATH", "credentials.json")
    token_path = os.environ.get("GMAIL_TOKEN_PATH", "token.json")

    with open(token_path) as f:
        tok = json.load(f)

    creds = Credentials(
        token=tok.get("token"),
        refresh_token=tok.get("refresh_token"),
        token_uri=tok.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=tok.get("client_id"),
        client_secret=tok.get("client_secret"),
        scopes=tok.get("scopes", SCOPES),
    )

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            updated = {
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "token_uri": creds.token_uri,
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scopes": list(creds.scopes),
            }
            with open(token_path, "w") as f:
                json.dump(updated, f)
            print("Token refreshed and saved.")

    return creds


# ── Gmail helpers ──────────────────────────────────────────────────────────────

def get_header(headers, name):
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def decode_body(data):
    try:
        return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
    except Exception:
        return ""


def extract_text(payload):
    """Recursively extract plain-text body from Gmail payload."""
    mime = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data", "")

    if mime == "text/plain" and body_data:
        return decode_body(body_data)

    if mime == "text/html" and body_data:
        html = decode_body(body_data)
        return re.sub(r"<[^>]+>", " ", html)

    for part in payload.get("parts", []):
        text = extract_text(part)
        if text:
            return text

    return ""


def get_thread_messages(service, thread_id):
    thread = service.users().threads().get(userId="me", id=thread_id, format="full").execute()
    messages = []
    for msg in thread.get("messages", []):
        headers = msg["payload"].get("headers", [])
        body = extract_text(msg["payload"]).strip()
        if len(body) > 2500:
            body = body[:2500] + " …[truncated]"
        messages.append({
            "id": msg["id"],
            "date": get_header(headers, "Date"),
            "from": get_header(headers, "From"),
            "to": get_header(headers, "To"),
            "subject": get_header(headers, "Subject"),
            "snippet": msg.get("snippet", ""),
            "body": body,
        })
    return messages


# ── Claude analysis ────────────────────────────────────────────────────────────

def analyze_with_claude(messages, client, existing_tasks=None):
    thread_text = "\n\n---\n\n".join(
        f"From: {m['from']}\nDate: {m['date']}\nSubject: {m['subject']}\n\n{m['body']}"
        for m in messages[:12]
    )

    existing_hint = ""
    if existing_tasks:
        sample = [{"id": t["id"], "title": t["title"], "client": t["client_name"], "status": t["status"]}
                  for t in existing_tasks[:30]]
        existing_hint = "\n\nExisting tasks (for deduplication):\n" + json.dumps(sample, indent=2)

    prompt = f"""Analyze this email thread and return ONLY a JSON object — no markdown, no explanation.

Thread:
{thread_text}
{existing_hint}

Return exactly this structure:
{{
  "client_name": "External company / client name (use 'Internal' for internal only, 'Newsletter' for bulk mail)",
  "task_title": "Short actionable title (max 80 chars)",
  "task_description": "What needs to be done (max 400 chars)",
  "priority": "urgent|medium|low",
  "status": "pending|completed",
  "summary": "2-3 sentence thread summary",
  "actionables": ["action 1", "action 2"],
  "responsible_person": "Name or email of person who must act next",
  "is_followup": false,
  "related_task_keywords": ["kw1", "kw2"],
  "confidence": 0.85
}}

Rules:
- client_name = the external company; infer from domains, signatures, or email content
- priority urgent = deadline < 48 h or critical issue; low = FYI or completed already
- status completed = thread clearly shows resolution/closure
"""

    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return None


# ── Data helpers ───────────────────────────────────────────────────────────────

def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_or_create_client(data, name):
    name_lower = name.lower().strip()
    for c in data["clients"]:
        if c["name"].lower() == name_lower:
            return c
    color = CLIENT_COLORS[len(data["clients"]) % len(CLIENT_COLORS)]
    client = {"id": str(uuid.uuid4()), "name": name.strip(), "order": len(data["clients"]), "color": color}
    data["clients"].append(client)
    return client


def find_existing_task(data, thread_id, keywords):
    for t in data["tasks"]:
        if t.get("email_thread_id") == thread_id:
            return t
    if keywords:
        for t in data["tasks"]:
            haystack = (t["title"] + " " + t["description"]).lower()
            if sum(1 for kw in keywords if kw.lower() in haystack) >= 2:
                return t
    return None


def apply_user_updates(data, updates):
    for upd in updates.get("updates", []):
        for t in data["tasks"]:
            if t["id"] == upd.get("id"):
                for k, v in upd.items():
                    if k not in ("id", "created_at"):
                        t[k] = v
                t["updated_at"] = datetime.now(timezone.utc).isoformat()
                break

    for nt in updates.get("new_tasks", []):
        if not any(t["id"] == nt["id"] for t in data["tasks"]):
            data["tasks"].append(nt)
            get_or_create_client(data, nt.get("client_name", "General"))

    if updates.get("employees") is not None:
        data["employees"] = updates["employees"]

    if updates.get("settings"):
        data["settings"].update(updates["settings"])

    updates["updates"] = []
    updates["new_tasks"] = []
    return data, updates


# ── Main processing ────────────────────────────────────────────────────────────

def process_emails(service, ai_client, data, initial_run=False):
    last = data["metadata"].get("last_email_processed")

    if initial_run or not last:
        after = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y/%m/%d")
        query = f"after:{after}"
    else:
        dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        query = f"after:{int(dt.timestamp())}"

    query += " -category:promotions -category:social"
    print(f"Gmail query: {query}")

    result = service.users().threads().list(userId="me", q=query, maxResults=100).execute()
    threads = result.get("threads", [])
    print(f"Threads to process: {len(threads)}")

    processed = 0
    now = datetime.now(timezone.utc).isoformat()

    for thread in threads:
        tid = thread["id"]
        try:
            messages = get_thread_messages(service, tid)
            if not messages:
                continue

            analysis = analyze_with_claude(messages, ai_client, existing_tasks=data["tasks"])
            if not analysis:
                print(f"  Skipping {tid}: no analysis")
                continue

            client_name = analysis.get("client_name", "Unknown").strip()
            if client_name.lower() in SKIP_CLIENTS:
                print(f"  Skipping automated email")
                continue

            get_or_create_client(data, client_name)

            existing = find_existing_task(data, tid, analysis.get("related_task_keywords", []))

            if existing:
                print(f"  Updating: {existing['title'][:60]}")
                existing.update({
                    "status": analysis.get("status", existing["status"]),
                    "priority": analysis.get("priority", existing["priority"]),
                    "description": analysis.get("task_description", existing["description"]),
                    "summary": analysis.get("summary", existing["summary"]),
                    "actionables": analysis.get("actionables", existing["actionables"]),
                    "responsible_person": analysis.get("responsible_person", existing["responsible_person"]),
                    "updated_at": now,
                    "email_messages": messages,
                })
                if existing["status"] == "completed" and not existing.get("completed_at"):
                    existing["completed_at"] = now
            else:
                title = analysis.get("task_title") or f"Task: {messages[0]['subject'][:60]}"
                status = analysis.get("status", "pending")
                print(f"  Creating: {title[:60]}")
                task = {
                    "id": str(uuid.uuid4()),
                    "client_name": client_name,
                    "title": title,
                    "description": analysis.get("task_description", ""),
                    "priority": analysis.get("priority", "medium"),
                    "status": status,
                    "created_at": now,
                    "updated_at": now,
                    "completed_at": now if status == "completed" else None,
                    "email_thread_id": tid,
                    "email_subject": messages[0]["subject"],
                    "summary": analysis.get("summary", ""),
                    "actionables": analysis.get("actionables", []),
                    "responsible_person": analysis.get("responsible_person", ""),
                    "assigned_to": None,
                    "email_messages": messages,
                    "manual": False,
                    "confidence": analysis.get("confidence", 0.8),
                }
                data["tasks"].append(task)

            processed += 1

        except Exception as e:
            print(f"  Error on {tid}: {e}")

    data["metadata"]["last_email_processed"] = now
    data["metadata"]["last_updated"] = now
    data["metadata"]["total_emails_processed"] = (
        data["metadata"].get("total_emails_processed", 0) + processed
    )
    print(f"Done. Processed {processed} threads.")
    return data


def main():
    print("=== Email Task Processor starting ===")
    initial_run = os.environ.get("INITIAL_RUN", "false").lower() == "true"

    creds = load_credentials()
    service = build("gmail", "v1", credentials=creds)
    ai_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    default_data = {
        "metadata": {"last_updated": None, "last_email_processed": None,
                     "total_emails_processed": 0, "version": "1.0"},
        "tasks": [], "clients": [], "employees": [], "settings": {},
    }
    default_updates = {"updates": [], "new_tasks": [], "deleted_tasks": [], "employees": None, "settings": {}}

    data = load_json(TASKS_FILE, default_data)
    updates = load_json(USER_UPDATES_FILE, default_updates)

    data, updates = apply_user_updates(data, updates)
    data = process_emails(service, ai_client, data, initial_run)

    save_json(TASKS_FILE, data)
    save_json(USER_UPDATES_FILE, updates)
    print("=== Done ===")


if __name__ == "__main__":
    main()
