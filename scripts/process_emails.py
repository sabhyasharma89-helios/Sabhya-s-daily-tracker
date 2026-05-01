#!/usr/bin/env python3
"""
Email Processor for Sabhya's Daily Tracker
============================================
Runs every 10 minutes via GitHub Actions.
Reads Gmail, uses Claude AI to extract tasks, writes to Firebase Firestore.

Required environment variables (set as GitHub Secrets):
  GMAIL_TOKEN_JSON        - OAuth2 token JSON (from Gmail OAuth flow)
  FIREBASE_SERVICE_ACCOUNT - Firebase Admin SDK service account JSON
  ANTHROPIC_API_KEY       - Claude API key
  FIRST_RUN               - Set to "true" to process last 30 days (optional)
"""

import os
import json
import re
import sys
import time
import base64
import hashlib
import datetime
from email.utils import parsedate_to_datetime

# ── Third-party ──────────────────────────────────────────────
try:
    import anthropic
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    import firebase_admin
    from firebase_admin import credentials as fb_creds, firestore
except ImportError as e:
    print(f"[ERROR] Missing dependency: {e}")
    print("Run: pip install anthropic google-auth google-auth-oauthlib google-api-python-client firebase-admin")
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════
ANTHROPIC_MODEL    = "claude-sonnet-4-6"
MAX_EMAILS_PER_RUN = 50      # cap per run to respect API limits
FIRST_RUN_DAYS     = 30      # days back for first run
BATCH_DELAY        = 1.0     # seconds between Claude calls

# Priority keywords hint
URGENT_KEYWORDS  = ["urgent", "asap", "immediately", "critical", "deadline today", "overdue"]
CLOSED_KEYWORDS  = ["resolved", "completed", "done", "closed", "fixed", "no further action",
                    "thank you for your help", "consider this closed", "task complete"]


# ═══════════════════════════════════════════════════════════════
# INIT FIREBASE
# ═══════════════════════════════════════════════════════════════
def init_firebase():
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not sa_json:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT env var not set")
    sa_dict = json.loads(sa_json)
    if not firebase_admin._apps:
        cred = fb_creds.Certificate(sa_dict)
        firebase_admin.initialize_app(cred)
    return firestore.client()


# ═══════════════════════════════════════════════════════════════
# INIT GMAIL
# ═══════════════════════════════════════════════════════════════
def init_gmail():
    token_json = os.environ.get("GMAIL_TOKEN_JSON")
    if not token_json:
        raise RuntimeError("GMAIL_TOKEN_JSON env var not set")
    token_data = json.loads(token_json)
    creds = Credentials(
        token=token_data.get("token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
        scopes=token_data.get("scopes", ["https://www.googleapis.com/auth/gmail.readonly"]),
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("gmail", "v1", credentials=creds)


# ═══════════════════════════════════════════════════════════════
# INIT ANTHROPIC
# ═══════════════════════════════════════════════════════════════
def init_claude():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY env var not set")
    return anthropic.Anthropic(api_key=api_key)


# ═══════════════════════════════════════════════════════════════
# GMAIL HELPERS
# ═══════════════════════════════════════════════════════════════
def get_email_body(msg_payload):
    """Recursively extract plain-text body from Gmail payload."""
    body = ""
    if "parts" in msg_payload:
        for part in msg_payload["parts"]:
            body += get_email_body(part)
    else:
        mime = msg_payload.get("mimeType", "")
        if mime == "text/plain":
            data = msg_payload.get("body", {}).get("data", "")
            if data:
                body += base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    return body


def get_message_details(gmail, msg_id):
    """Fetch full message and return structured dict."""
    msg = gmail.users().messages().get(userId="me", id=msg_id, format="full").execute()
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
    body    = get_email_body(msg.get("payload", {}))
    return {
        "id":        msg_id,
        "thread_id": msg.get("threadId"),
        "subject":   headers.get("subject", "(no subject)"),
        "from":      headers.get("from", ""),
        "to":        headers.get("to", ""),
        "date":      headers.get("date", ""),
        "body":      body[:4000],   # cap to 4k chars per message
        "snippet":   msg.get("snippet", ""),
        "labels":    msg.get("labelIds", []),
    }


def get_thread_messages(gmail, thread_id):
    """Fetch all messages in a thread."""
    thread = gmail.users().threads().get(userId="me", id=thread_id, format="full").execute()
    messages = []
    for msg in thread.get("messages", []):
        headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
        body    = get_email_body(msg.get("payload", {}))
        messages.append({
            "id":      msg["id"],
            "from":    headers.get("from", ""),
            "date":    headers.get("date", ""),
            "subject": headers.get("subject", ""),
            "body":    body[:2000],
        })
    return messages


def fetch_new_messages(gmail, after_timestamp_ms=None, max_results=50):
    """Fetch message IDs newer than the given timestamp."""
    query = "in:inbox"
    if after_timestamp_ms:
        after_sec = int(after_timestamp_ms / 1000)
        query += f" after:{after_sec}"

    results = gmail.users().messages().list(
        userId="me", q=query, maxResults=max_results
    ).execute()
    return results.get("messages", [])


# ═══════════════════════════════════════════════════════════════
# CLAUDE AI ANALYSIS
# ═══════════════════════════════════════════════════════════════
SYSTEM_PROMPT = """You are an intelligent email task extraction assistant for a business professional.
Your job is to analyse email threads and extract structured task information.

You must respond ONLY with valid JSON matching the schema provided — no markdown, no explanation."""

def analyse_thread_with_claude(claude, thread_msgs, existing_task=None):
    """
    Ask Claude to analyse an email thread and return structured task data.
    Returns a dict or None on failure.
    """
    thread_text = "\n\n---\n\n".join([
        f"From: {m['from']}\nDate: {m['date']}\nSubject: {m['subject']}\n\n{m['body']}"
        for m in thread_msgs
    ])
    thread_text = thread_text[:8000]  # cap total context

    existing_json = json.dumps(existing_task, default=str) if existing_task else "null"

    user_prompt = f"""Analyse the following email thread and extract task information.

=== EMAIL THREAD ===
{thread_text}

=== EXISTING TASK (null if new) ===
{existing_json}

Return ONLY a JSON object with these exact fields:
{{
  "client_name": "<company or person name this email is about>",
  "task_title": "<concise actionable title, max 80 chars>",
  "summary": "<2-3 sentence summary of the situation>",
  "actionables": ["<action item 1>", "<action item 2>"],
  "responsible": "<who needs to act next and what they need to do>",
  "thread_summary": "<paragraph summarising the full email conversation so far>",
  "priority": "<urgent|medium|low>",
  "status": "<pending|completed>",
  "is_closed": <true if the email clearly indicates the matter is resolved, false otherwise>,
  "keywords_found": ["<any relevant keywords>"]
}}

Rules:
- client_name: Extract the company/person being discussed, not the email sender.
- priority: urgent = deadline/critical; medium = standard business; low = informational.
- status: completed only if the thread clearly shows resolution.
- If existing_task is provided, update it — don't replace actionables that are still open.
- Keep task_title short and action-oriented."""

    try:
        response = claude.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": user_prompt}],
            system=SYSTEM_PROMPT,
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        return json.loads(raw)
    except Exception as e:
        print(f"[WARN] Claude analysis failed: {e}")
        return None


# ═══════════════════════════════════════════════════════════════
# FIRESTORE HELPERS
# ═══════════════════════════════════════════════════════════════
def get_last_read_timestamp(db):
    ref  = db.collection("config").document("settings")
    snap = ref.get()
    if snap.exists:
        return snap.to_dict().get("lastEmailReadMs", None)
    return None


def set_last_read_timestamp(db, ts_ms):
    db.collection("config").document("settings").set(
        {"lastEmailReadMs": ts_ms, "lastSyncAt": firestore.SERVER_TIMESTAMP},
        merge=True
    )


def get_task_by_thread(db, thread_id):
    docs = db.collection("tasks") \
             .where("emailThreadId", "==", thread_id) \
             .limit(1) \
             .stream()
    for doc in docs:
        return {"id": doc.id, **doc.to_dict()}
    return None


def slugify(text):
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')


def ensure_client(db, client_name, color=None):
    """Create client document if it doesn't exist."""
    client_id = slugify(client_name)
    ref = db.collection("clients").document(client_id)
    if not ref.get().exists:
        colors = ["#6366f1","#ec4899","#14b8a6","#f59e0b","#8b5cf6","#06b6d4","#ef4444","#84cc16"]
        idx = int(hashlib.md5(client_name.encode()).hexdigest(), 16) % len(colors)
        ref.set({
            "id":        client_id,
            "name":      client_name,
            "color":     color or colors[idx],
            "order":     999,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    return client_id


def upsert_task(db, thread_id, analysis, subject):
    """Create or update a task based on Claude's analysis."""
    existing = get_task_by_thread(db, thread_id)

    client_name = analysis.get("client_name") or "Unknown Client"
    client_id   = ensure_client(db, client_name)

    # Map Claude's output → Firestore fields
    status   = "completed" if analysis.get("is_closed") else (analysis.get("status") or "pending")
    priority = analysis.get("priority") or "medium"
    if priority not in ("urgent", "medium", "low"):
        priority = "medium"

    task_data = {
        "title":         analysis.get("task_title") or subject or "Email Task",
        "clientName":    client_name,
        "clientId":      client_id,
        "summary":       analysis.get("summary") or "",
        "actionables":   analysis.get("actionables") or [],
        "responsible":   analysis.get("responsible") or "",
        "threadSummary": analysis.get("thread_summary") or "",
        "emailThreadId": thread_id,
        "priority":      priority,
        "status":        status,
        "source":        "email",
        "updatedAt":     firestore.SERVER_TIMESTAMP,
    }

    if existing:
        # Preserve manual overrides (assignedTo, manual priority bumps)
        if existing.get("assignedTo"):
            task_data["assignedTo"] = existing["assignedTo"]
        # Don't demote priority if user manually set it higher
        priority_order = {"urgent": 0, "medium": 1, "low": 2}
        if priority_order.get(existing.get("priority","medium"), 1) < priority_order.get(priority, 1):
            task_data["priority"] = existing["priority"]
        db.collection("tasks").document(existing["id"]).update(task_data)
        action = "updated"
        task_id = existing["id"]
    else:
        task_id = f"task_{int(time.time()*1000)}_{thread_id[:8]}"
        task_data["id"]        = task_id
        task_data["assignedTo"] = ""
        task_data["createdAt"] = firestore.SERVER_TIMESTAMP
        db.collection("tasks").document(task_id).set(task_data)
        action = "created"

    return task_id, action


# ═══════════════════════════════════════════════════════════════
# MAIN PROCESSOR
# ═══════════════════════════════════════════════════════════════
def main():
    print("[INFO] Starting email processor…")

    # Init services
    db     = init_firebase()
    gmail  = init_gmail()
    claude = init_claude()

    # Determine time window
    first_run_flag = os.environ.get("FIRST_RUN", "false").lower() == "true"
    last_read_ms   = get_last_read_timestamp(db)

    if first_run_flag or last_read_ms is None:
        # Process last FIRST_RUN_DAYS days
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=FIRST_RUN_DAYS)
        after_ms = int(cutoff.timestamp() * 1000)
        print(f"[INFO] First run — fetching emails since {cutoff.strftime('%Y-%m-%d')}")
    else:
        after_ms = last_read_ms
        since_dt = datetime.datetime.utcfromtimestamp(after_ms / 1000)
        print(f"[INFO] Incremental run — fetching emails since {since_dt.strftime('%Y-%m-%d %H:%M')} UTC")

    # Fetch messages
    messages = fetch_new_messages(gmail, after_ms, MAX_EMAILS_PER_RUN)
    print(f"[INFO] Found {len(messages)} new message(s)")

    if not messages:
        print("[INFO] No new messages. Updating timestamp.")
        set_last_read_timestamp(db, int(time.time() * 1000))
        return

    # Track processed threads (avoid duplicate processing within same run)
    processed_threads = set()
    newest_ts_ms = after_ms or 0

    for msg_stub in messages:
        msg_id = msg_stub["id"]
        try:
            msg = get_message_details(gmail, msg_id)
        except Exception as e:
            print(f"[WARN] Could not fetch message {msg_id}: {e}")
            continue

        thread_id = msg["thread_id"]
        if thread_id in processed_threads:
            continue
        processed_threads.add(thread_id)

        # Track newest email timestamp
        try:
            msg_ts = int(parsedate_to_datetime(msg["date"]).timestamp() * 1000)
            newest_ts_ms = max(newest_ts_ms, msg_ts)
        except Exception:
            pass

        # Skip automated/newsletter emails
        skip_senders = ["noreply", "no-reply", "notifications@", "mailer@", "newsletter@",
                        "alerts@", "donotreply", "bounce@"]
        if any(kw in msg["from"].lower() for kw in skip_senders):
            print(f"[SKIP] Auto-email: {msg['subject'][:60]}")
            continue

        print(f"[PROC] Thread {thread_id}: {msg['subject'][:60]}")

        # Get full thread for context
        try:
            thread_msgs = get_thread_messages(gmail, thread_id)
        except Exception as e:
            print(f"[WARN] Could not fetch thread {thread_id}: {e}")
            thread_msgs = [msg]

        # Get existing task (for update)
        existing_task = get_task_by_thread(db, thread_id)

        # Analyse with Claude
        time.sleep(BATCH_DELAY)
        analysis = analyse_thread_with_claude(claude, thread_msgs, existing_task)

        if analysis is None:
            print(f"[WARN] Could not analyse thread {thread_id}, skipping")
            continue

        # Write to Firestore
        try:
            task_id, action = upsert_task(db, thread_id, analysis, msg["subject"])
            client = analysis.get("client_name", "?")
            status = "closed" if analysis.get("is_closed") else analysis.get("status", "pending")
            print(f"[OK] Task {action}: {task_id} | Client: {client} | Status: {status}")
        except Exception as e:
            print(f"[ERROR] Firestore write failed for thread {thread_id}: {e}")

    # Update last-read timestamp
    new_ts = max(newest_ts_ms, int(time.time() * 1000))
    set_last_read_timestamp(db, new_ts)

    # Clear FIRST_RUN flag in config so next run is incremental
    if first_run_flag:
        db.collection("config").document("settings").set(
            {"firstRunComplete": True}, merge=True
        )

    print(f"[INFO] Done. Processed {len(processed_threads)} thread(s).")


if __name__ == "__main__":
    main()
