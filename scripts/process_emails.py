#!/usr/bin/env python3
"""
Email processor for Sabhya's Daily Tracker.
Reads Gmail, uses Claude to extract tasks, updates data/tasks.json.
Runs via GitHub Actions on a schedule.
"""

import base64
import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser

import anthropic
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ─────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────

TASKS_FILE = 'data/tasks.json'
GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
FIRST_RUN_DAYS = 30          # days to look back on first run
MAX_THREADS_PER_RUN = 50     # safety cap
CLAUDE_MODEL = 'claude-sonnet-4-6'


def load_env(key: str, required: bool = True) -> str:
    val = os.environ.get(key, '').strip()
    if required and not val:
        raise EnvironmentError(f"Required env var {key} is not set")
    return val


# ─────────────────────────────────────────
# Task Database
# ─────────────────────────────────────────

def load_tasks() -> dict:
    if not os.path.exists(TASKS_FILE):
        return {
            'metadata': {'lastProcessed': None, 'version': '1.0', 'createdAt': _now()},
            'employees': [],
            'clients': {}
        }
    with open(TASKS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_tasks(data: dict):
    os.makedirs(os.path.dirname(TASKS_FILE), exist_ok=True)
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def generate_id(seed: str = '') -> str:
    h = hashlib.sha256((seed + str(time.time())).encode()).hexdigest()
    return h[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_client(data: dict, name: str) -> dict:
    if name not in data['clients']:
        data['clients'][name] = {
            'id': generate_id(name),
            'name': name,
            'order': len(data['clients']),
            'tasks': []
        }
    return data['clients'][name]


def find_task_by_thread(data: dict, thread_id: str) -> tuple[str | None, dict | None]:
    """Returns (client_name, task) or (None, None)."""
    for cname, client in data['clients'].items():
        for task in client['tasks']:
            if task.get('emailThreadId') == thread_id:
                return cname, task
    return None, None


def upsert_task(data: dict, analysis: dict, thread_id: str, thread_messages: list):
    """Create or update a task based on Claude's analysis."""
    client_name = analysis.get('client', 'Unknown Client').strip() or 'Unknown Client'
    existing_cname, existing_task = find_task_by_thread(data, thread_id)

    # Build email history entries
    history = [
        {
            'messageId': m.get('id', ''),
            'from': m.get('from', ''),
            'date': m.get('date', ''),
            'snippet': m.get('snippet', '')[:300]
        }
        for m in thread_messages
    ]

    participants = list({m.get('from', '') for m in thread_messages if m.get('from')})

    if existing_task:
        # Update existing task
        existing_task['title'] = analysis.get('task_title', existing_task['title'])
        existing_task['priority'] = analysis.get('priority', existing_task['priority'])
        existing_task['summary'] = analysis.get('summary', existing_task.get('summary', ''))
        existing_task['actionables'] = analysis.get('actionables', existing_task.get('actionables', []))
        existing_task['responsibleParty'] = analysis.get('responsible_party', existing_task.get('responsibleParty'))
        existing_task['emailHistory'] = history
        existing_task['participants'] = participants
        existing_task['updatedAt'] = _now()

        # Auto-close if resolved
        if analysis.get('is_completed') and existing_task.get('status') != 'completed':
            existing_task['status'] = 'completed'
            existing_task['completedAt'] = _now()
        elif not analysis.get('is_completed') and existing_task.get('status') == 'completed':
            pass  # keep completed if Claude didn't explicitly say resolved
    else:
        # Create new task
        client = ensure_client(data, client_name)
        task = {
            'id': generate_id(thread_id),
            'clientName': client_name,
            'title': analysis.get('task_title', 'Untitled Task'),
            'description': '',
            'priority': analysis.get('priority', 'medium'),
            'status': 'completed' if analysis.get('is_completed') else 'pending',
            'assignedTo': None,
            'source': 'email',
            'emailThreadId': thread_id,
            'emailSubject': analysis.get('subject', ''),
            'participants': participants,
            'summary': analysis.get('summary', ''),
            'actionables': analysis.get('actionables', []),
            'responsibleParty': analysis.get('responsible_party'),
            'emailHistory': history,
            'createdAt': _now(),
            'updatedAt': _now(),
            'completedAt': _now() if analysis.get('is_completed') else None
        }
        if existing_cname and existing_cname != client_name:
            # Client name changed — put in new client, leave old task
            data['clients'][client_name]['tasks'].append(task)
        else:
            client['tasks'].append(task)


# ─────────────────────────────────────────
# Gmail API
# ─────────────────────────────────────────

def build_gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=load_env('GMAIL_REFRESH_TOKEN'),
        client_id=load_env('GMAIL_CLIENT_ID'),
        client_secret=load_env('GMAIL_CLIENT_SECRET'),
        token_uri='https://oauth2.googleapis.com/token',
        scopes=GMAIL_SCOPES
    )
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


def fetch_threads(service, since_dt: datetime, max_results: int = MAX_THREADS_PER_RUN) -> list:
    """Return list of thread IDs modified since since_dt."""
    after_epoch = int(since_dt.timestamp())
    query = f'after:{after_epoch}'
    threads = []
    page_token = None

    while len(threads) < max_results:
        params = {
            'userId': 'me',
            'q': query,
            'maxResults': min(50, max_results - len(threads))
        }
        if page_token:
            params['pageToken'] = page_token

        try:
            res = service.users().threads().list(**params).execute()
        except HttpError as e:
            print(f"Gmail API error listing threads: {e}")
            break

        batch = res.get('threads', [])
        threads.extend(batch)
        page_token = res.get('nextPageToken')
        if not page_token or not batch:
            break

    return threads


def decode_body(part: dict) -> str:
    """Decode a message part body to plain text."""
    data = part.get('body', {}).get('data', '')
    if not data:
        return ''
    try:
        return base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')
    except Exception:
        return ''


def extract_text(payload: dict, depth: int = 0) -> str:
    """Recursively extract plain text from a Gmail message payload."""
    if depth > 5:
        return ''
    mime = payload.get('mimeType', '')
    parts = payload.get('parts', [])

    if mime == 'text/plain':
        return decode_body(payload)
    if mime == 'text/html' and not parts:
        raw = decode_body(payload)
        return re.sub(r'<[^>]+>', ' ', raw)
    if parts:
        texts = []
        for p in parts:
            t = extract_text(p, depth + 1)
            if t.strip():
                texts.append(t)
        # Prefer plain text over html
        return '\n'.join(texts)
    return ''


def get_header(headers: list, name: str) -> str:
    for h in headers:
        if h['name'].lower() == name.lower():
            return h['value']
    return ''


def fetch_thread_messages(service, thread_id: str) -> list:
    """Return list of message dicts for a thread."""
    try:
        thread = service.users().threads().get(
            userId='me', id=thread_id, format='full'
        ).execute()
    except HttpError as e:
        print(f"Error fetching thread {thread_id}: {e}")
        return []

    messages = []
    for msg in thread.get('messages', []):
        headers = msg.get('payload', {}).get('headers', [])
        body_text = extract_text(msg.get('payload', {}))
        messages.append({
            'id': msg.get('id', ''),
            'from': get_header(headers, 'From'),
            'to': get_header(headers, 'To'),
            'subject': get_header(headers, 'Subject'),
            'date': get_header(headers, 'Date'),
            'snippet': msg.get('snippet', ''),
            'body': body_text[:3000]  # cap at 3k chars per message
        })
    return messages


# ─────────────────────────────────────────
# Claude Analysis
# ─────────────────────────────────────────

def build_thread_text(messages: list) -> str:
    parts = []
    for i, m in enumerate(messages, 1):
        parts.append(
            f"--- Message {i} ---\n"
            f"From: {m['from']}\nDate: {m['date']}\n"
            f"Subject: {m['subject']}\n\n{m['body'][:2000]}"
        )
    return '\n\n'.join(parts)


ANALYSIS_PROMPT = """You are an executive assistant analyzing an email thread for a busy professional.
Extract structured task information from this email thread.

EMAIL THREAD:
{thread_text}

Respond with ONLY valid JSON in this exact format:
{{
  "client": "Name of the client/company this email is about (infer from context, signatures, domain names)",
  "task_title": "Short actionable title (max 10 words)",
  "priority": "high|medium|low",
  "summary": "2-3 sentence summary of the entire thread and what needs to happen",
  "actionables": ["Specific action item 1", "Action item 2"],
  "responsible_party": "Who needs to take the next action (name or role)",
  "is_completed": false,
  "subject": "The email subject"
}}

Priority guide: high = urgent deadlines / legal / financial / blocking issues; medium = normal business; low = FYI / no action needed soon.
is_completed = true only if the thread clearly shows the matter is fully resolved."""


def analyze_thread(client: anthropic.Anthropic, messages: list) -> dict | None:
    if not messages:
        return None

    thread_text = build_thread_text(messages)
    prompt = ANALYSIS_PROMPT.format(thread_text=thread_text[:8000])

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            messages=[{'role': 'user', 'content': prompt}]
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"JSON parse error from Claude: {e}")
        return None
    except Exception as e:
        print(f"Claude API error: {e}")
        return None


# ─────────────────────────────────────────
# Main
# ─────────────────────────────────────────

def main():
    print(f"[{_now()}] Starting email processing…")

    # Load current task database
    data = load_tasks()
    meta = data.setdefault('metadata', {})

    # Determine time window
    last_processed = meta.get('lastProcessed')
    if last_processed:
        since = datetime.fromisoformat(last_processed.replace('Z', '+00:00'))
        # Small overlap to avoid missing emails
        since -= timedelta(minutes=5)
    else:
        since = datetime.now(timezone.utc) - timedelta(days=FIRST_RUN_DAYS)
        print(f"First run — fetching emails from last {FIRST_RUN_DAYS} days")

    print(f"Fetching threads since: {since.isoformat()}")

    # Build clients
    try:
        gmail = build_gmail_service()
        claude = anthropic.Anthropic(api_key=load_env('ANTHROPIC_API_KEY'))
    except Exception as e:
        print(f"Failed to initialize API clients: {e}")
        raise

    # Fetch threads
    threads = fetch_threads(gmail, since)
    print(f"Found {len(threads)} thread(s) to process")

    processed = 0
    errors = 0

    for thread_info in threads:
        thread_id = thread_info['id']
        print(f"Processing thread {thread_id}…", end=' ', flush=True)

        messages = fetch_thread_messages(gmail, thread_id)
        if not messages:
            print("no messages")
            continue

        analysis = analyze_thread(claude, messages)
        if not analysis:
            print("analysis failed")
            errors += 1
            continue

        upsert_task(data, analysis, thread_id, messages)
        processed += 1
        print(f"→ {analysis.get('client', '?')} | {analysis.get('task_title', '?')}")

        # Be polite to the APIs
        time.sleep(0.5)

    # Update metadata
    meta['lastProcessed'] = _now()
    if not meta.get('createdAt'):
        meta['createdAt'] = _now()

    save_tasks(data)

    print(f"\n[{_now()}] Done — {processed} processed, {errors} errors")
    print(f"Tasks file saved to {TASKS_FILE}")


if __name__ == '__main__':
    main()
