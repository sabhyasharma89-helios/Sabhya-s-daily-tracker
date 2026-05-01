"""
Email → Task Processor
======================
Runs on a GitHub Actions schedule every 10 minutes.
  1. Reads Gmail (last 30 days on first run, incremental thereafter).
  2. Groups messages by thread; identifies threads with new activity.
  3. Calls Claude to extract client name, task, priority, summary, actionables.
  4. Creates or updates tasks in data/tasks.json.
  5. Writes updated JSON back to the repo via git (handled by the workflow).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Any

import anthropic
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).parent.parent
TASKS_FILE  = ROOT / "data" / "tasks.json"
STATE_FILE  = ROOT / "data" / "email_state.json"

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# ── Helpers ───────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def task_id_from_thread(thread_id: str) -> str:
    return "task-" + hashlib.md5(thread_id.encode()).hexdigest()[:10]


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Gmail auth ────────────────────────────────────────────────────────────────

def build_gmail_service():
    raw_token = os.environ.get("GMAIL_TOKEN", "")
    if not raw_token:
        raise EnvironmentError("GMAIL_TOKEN secret is not set.")

    token_data = json.loads(raw_token)
    creds = Credentials(
        token=token_data.get("token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
        scopes=token_data.get("scopes", SCOPES),
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# ── Email fetching ────────────────────────────────────────────────────────────

def _decode_b64(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_body(payload: dict) -> str:
    """Recursively extract plain-text body from a message payload."""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        return _decode_b64(payload.get("body", {}).get("data", ""))
    if mime.startswith("multipart/"):
        for part in payload.get("parts", []):
            text = _extract_body(part)
            if text:
                return text
    return ""


def fetch_thread(service, thread_id: str) -> list[dict]:
    """Return list of simplified message dicts for a thread."""
    try:
        thread = service.users().threads().get(
            userId="me", id=thread_id, format="full"
        ).execute()
    except HttpError as e:
        print(f"  [WARN] Could not fetch thread {thread_id}: {e}")
        return []

    messages = []
    for msg in thread.get("messages", []):
        headers = {h["name"].lower(): h["value"]
                   for h in msg["payload"].get("headers", [])}
        body = _extract_body(msg["payload"]).strip()
        messages.append({
            "id":      msg["id"],
            "from":    headers.get("from", ""),
            "to":      headers.get("to", ""),
            "cc":      headers.get("cc", ""),
            "subject": headers.get("subject", "(no subject)"),
            "date":    headers.get("date", ""),
            "body":    body[:3000],          # keep under token budget
            "snippet": msg.get("snippet", ""),
        })
    return messages


def fetch_new_threads(service, state: dict) -> tuple[list[str], str | None]:
    """
    Return list of thread IDs that have activity since last run, plus the
    historyId of the newest message seen (for future incremental sync).
    First run fetches last 30 days.
    """
    is_first = state.get("isFirstRun", True)
    processed_set = set(state.get("processedThreadIds", []))

    if is_first or os.environ.get("FORCE_FIRST_RUN") == "true":
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y/%m/%d")
        query = f"after:{cutoff}"
        print(f"First run – fetching emails after {cutoff}")
    else:
        last_ts = state.get("lastProcessedTimestamp")
        if last_ts:
            cutoff = datetime.fromisoformat(last_ts.replace("Z", "+00:00")).strftime("%Y/%m/%d")
            query = f"after:{cutoff}"
        else:
            query = "newer_than:20m"
        print(f"Incremental run – query: {query}")

    thread_ids: list[str] = []
    page_token = None
    while True:
        kwargs: dict = {"userId": "me", "q": query, "maxResults": 200}
        if page_token:
            kwargs["pageToken"] = page_token
        result = service.users().messages().list(**kwargs).execute()
        for msg in result.get("messages", []):
            tid = msg["threadId"]
            if tid not in thread_ids:
                thread_ids.append(tid)
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    # For incremental runs, include threads already in DB that have new messages
    new_thread_ids = [t for t in thread_ids if t not in processed_set] if not is_first else thread_ids

    print(f"Found {len(thread_ids)} threads total, {len(new_thread_ids)} new/updated")
    return new_thread_ids, None


# ── Claude analysis ───────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a professional business assistant helping to track tasks from email threads.
Analyse the provided email thread and extract structured information. Always reply with valid JSON only — no markdown, no prose."""

ANALYSIS_PROMPT_TMPL = """Analyse this email thread and return a JSON object.

{existing_context}

EMAIL THREAD ({count} messages):
{thread_text}

Return ONLY a valid JSON object with these exact keys:
{{
  "clientName": "<company or person name this email is about – not an email address>",
  "taskTitle": "<concise action-oriented title, max 80 chars>",
  "priority": "<urgent|medium|low>",
  "status": "<pending|completed>",
  "summary": "<2-3 sentence summary of the entire thread>",
  "actionables": ["<specific action item 1>", "<specific action item 2>"],
  "nextStepPerson": "<name of the person responsible for the next action>",
  "completionEvidence": "<brief evidence the matter is closed, or empty string>"
}}

Priority rules:
- urgent: deadlines within 7 days, financial decisions, urgent client requests, legal matters
- medium: standard business tasks, follow-ups, proposals
- low: FYI emails, newsletters, informational updates

Status rules:
- completed: latest emails clearly indicate the matter is resolved, confirmed, or closed
- pending: anything else
"""


def analyse_thread(
    client: anthropic.Anthropic,
    messages: list[dict],
    existing_task: dict | None,
    retries: int = 3,
) -> dict | None:
    thread_text = "\n\n---\n".join(
        f"From: {m['from']}\nTo: {m['to']}\nDate: {m['date']}\n"
        f"Subject: {m['subject']}\n\n{m['body'] or m['snippet']}"
        for m in messages
    )

    existing_ctx = ""
    if existing_task:
        existing_ctx = (
            f"There is an existing task for this thread:\n"
            f"- Title: {existing_task.get('title')}\n"
            f"- Priority: {existing_task.get('priority')}\n"
            f"- Status: {existing_task.get('status')}\n"
            f"- Current actionables: {json.dumps(existing_task.get('actionables', []))}\n\n"
            f"Update the task if the thread has evolved; keep unchanged fields if nothing new.\n"
        )

    prompt = ANALYSIS_PROMPT_TMPL.format(
        existing_context=existing_ctx,
        count=len(messages),
        thread_text=thread_text[:12000],   # ~3k tokens safety margin
    )

    for attempt in range(retries):
        try:
            resp = client.messages.create(
                model="claude-opus-4-5",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
            # Strip potential markdown code fences
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw.strip())
        except json.JSONDecodeError as e:
            print(f"  [WARN] JSON parse error attempt {attempt+1}: {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
        except anthropic.RateLimitError:
            wait = 10 * (2 ** attempt)
            print(f"  [WARN] Rate limit – waiting {wait}s")
            time.sleep(wait)
        except Exception as e:
            print(f"  [ERROR] Claude API error attempt {attempt+1}: {e}")
            if attempt < retries - 1:
                time.sleep(3)
    return None


# ── DB helpers ────────────────────────────────────────────────────────────────

def empty_db() -> dict:
    return {
        "version": "1.0",
        "lastUpdated": "",
        "emailLastRun": "",
        "settings": {"employees": []},
        "tasks": [],
        "clients": [],
    }


def refresh_clients(db: dict) -> None:
    db["clients"] = sorted({t["clientName"] for t in db["tasks"] if t.get("clientName")})


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    # Validate required secrets
    missing = [k for k in ("GMAIL_TOKEN", "ANTHROPIC_API_KEY") if not os.environ.get(k)]
    if missing:
        print(f"[ERROR] Missing required environment variables: {', '.join(missing)}")
        sys.exit(1)

    # Load state
    db    = load_json(TASKS_FILE, empty_db())
    state = load_json(STATE_FILE, {"isFirstRun": True, "processedThreadIds": []})

    # Ensure db has required top-level keys
    db.setdefault("settings", {"employees": []})
    db.setdefault("tasks", [])
    db.setdefault("clients", [])

    # Build clients
    gmail_svc     = build_gmail_service()
    claude_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    thread_ids, _ = fetch_new_threads(gmail_svc, state)

    if not thread_ids:
        print("No new threads to process.")
    else:
        tasks_by_thread = {t["emailThreadId"]: t for t in db["tasks"] if t.get("emailThreadId")}
        processed_set   = set(state.get("processedThreadIds", []))
        changed = 0

        for i, thread_id in enumerate(thread_ids, 1):
            print(f"[{i}/{len(thread_ids)}] Processing thread {thread_id}")
            messages = fetch_thread(gmail_svc, thread_id)
            if not messages:
                continue

            existing = tasks_by_thread.get(thread_id)
            analysis = analyse_thread(claude_client, messages, existing)
            if not analysis:
                print("  Skipped (no analysis returned)")
                continue

            ts = now_iso()
            if existing:
                # Update existing task
                existing.update({
                    "clientName":    analysis.get("clientName", existing["clientName"]),
                    "title":         analysis.get("taskTitle", existing["title"]),
                    "priority":      analysis.get("priority", existing["priority"]),
                    "summary":       analysis.get("summary", existing.get("summary", "")),
                    "actionables":   analysis.get("actionables", existing.get("actionables", [])),
                    "nextStepPerson":analysis.get("nextStepPerson", existing.get("nextStepPerson", "")),
                    "emailHistory":  messages,
                    "updatedAt":     ts,
                })
                # Auto-complete only if Claude is confident and was pending
                if (analysis.get("status") == "completed"
                        and analysis.get("completionEvidence")
                        and existing["status"] == "pending"):
                    existing["status"]      = "completed"
                    existing["completedAt"] = ts
                    print(f"  Auto-completed: {existing['title']}")
                print(f"  Updated: {existing['title']}")
                changed += 1
            else:
                # Create new task
                status = analysis.get("status", "pending")
                new_task: dict = {
                    "id":             task_id_from_thread(thread_id),
                    "clientName":     analysis.get("clientName", "Unknown Client"),
                    "title":          analysis.get("taskTitle", messages[0].get("subject", "Untitled")),
                    "description":    analysis.get("summary", ""),
                    "priority":       analysis.get("priority", "medium"),
                    "status":         status,
                    "assignedTo":     "",
                    "emailThreadId":  thread_id,
                    "summary":        analysis.get("summary", ""),
                    "actionables":    analysis.get("actionables", []),
                    "nextStepPerson": analysis.get("nextStepPerson", ""),
                    "createdAt":      ts,
                    "updatedAt":      ts,
                    "completedAt":    ts if status == "completed" else None,
                    "emailHistory":   messages,
                    "manuallyCreated": False,
                }
                db["tasks"].append(new_task)
                tasks_by_thread[thread_id] = new_task
                print(f"  Created: {new_task['title']} [{new_task['priority']}]")
                changed += 1

            processed_set.add(thread_id)
            # Small pause to respect Claude's rate limits
            time.sleep(0.5)

        print(f"\nProcessed {changed}/{len(thread_ids)} threads.")

    # Update metadata
    db["lastUpdated"] = now_iso()
    db["emailLastRun"] = now_iso()
    refresh_clients(db)

    # Persist
    save_json(TASKS_FILE, db)

    new_state = {
        "lastProcessedTimestamp": now_iso(),
        "isFirstRun": False,
        "processedThreadIds": list(
            set(state.get("processedThreadIds", [])) | {t["emailThreadId"]
            for t in db["tasks"] if t.get("emailThreadId")}
        )[-2000:],   # Keep last 2000 to avoid unbounded growth
    }
    save_json(STATE_FILE, new_state)
    print("Done. data/tasks.json and data/email_state.json updated.")


if __name__ == "__main__":
    main()
