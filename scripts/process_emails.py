#!/usr/bin/env python3
"""
process_emails.py
─────────────────
GitHub Actions backend for Sabhya's Daily Tracker.

Flow:
  1. Read data/tasks.json from repo (existing state)
  2. Authenticate with Gmail using a refresh token stored in GMAIL_TOKEN env var
  3. On first run: fetch emails from last 30 days
     On subsequent runs: fetch emails since last processed timestamp
  4. For each thread, call Claude to extract client, tasks, priority, status
  5. Merge results into data/tasks.json
  6. Commit updated data/tasks.json back to the repo

Required environment variables (GitHub Secrets):
  GMAIL_TOKEN        — JSON string: {"token":..., "refresh_token":..., "token_uri":...,
                         "client_id":..., "client_secret":..., "scopes":[...]}
  ANTHROPIC_API_KEY  — Your Anthropic API key
  GITHUB_TOKEN       — Automatically provided by GitHub Actions
  GITHUB_REPOSITORY  — Automatically provided by GitHub Actions (owner/repo)
  GITHUB_REF_NAME    — Branch name (auto-provided)
"""

import os
import json
import base64
import hashlib
import time
import traceback
from datetime import datetime, timezone, timedelta
from email.utils import parseaddr

import anthropic
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ─── Configuration ────────────────────────────────────────────────────────────

DATA_FILE   = 'data/tasks.json'
CONFIG_FILE = 'data/config.json'

INITIAL_DAYS   = 30      # days to look back on first run
MAX_THREADS    = 200     # max threads per run to avoid rate limits
MAX_EMAILS_PER_THREAD = 20

CLAUDE_MODEL = "claude-sonnet-4-6"

# ─── GitHub file I/O ──────────────────────────────────────────────────────────

def read_json_file(path):
    """Read a JSON file from disk (the checked-out repo)."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def write_json_file(path, data):
    """Write data as formatted JSON to disk."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)

# ─── Gmail Authentication ─────────────────────────────────────────────────────

def get_gmail_service():
    """Build Gmail API client from GMAIL_TOKEN env var."""
    token_json = os.environ.get('GMAIL_TOKEN')
    if not token_json:
        raise RuntimeError("GMAIL_TOKEN environment variable is not set.")

    token_data = json.loads(token_json)
    creds = Credentials(
        token=token_data.get('token'),
        refresh_token=token_data.get('refresh_token'),
        token_uri=token_data.get('token_uri', 'https://oauth2.googleapis.com/token'),
        client_id=token_data.get('client_id'),
        client_secret=token_data.get('client_secret'),
        scopes=token_data.get('scopes', ['https://www.googleapis.com/auth/gmail.readonly'])
    )

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    return build('gmail', 'v1', credentials=creds)

# ─── Gmail helpers ────────────────────────────────────────────────────────────

def gmail_search(service, query, max_results=MAX_THREADS):
    """Return list of {id, threadId} message stubs matching query."""
    results = []
    page_token = None
    while len(results) < max_results:
        resp = service.users().messages().list(
            userId='me', q=query,
            maxResults=min(100, max_results - len(results)),
            pageToken=page_token
        ).execute()
        results.extend(resp.get('messages', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return results

def get_thread(service, thread_id):
    """Return full thread with all messages."""
    return service.users().threads().get(
        userId='me', id=thread_id, format='full'
    ).execute()

def decode_body(part):
    """Decode base64url-encoded email body."""
    data = part.get('body', {}).get('data', '')
    if not data:
        for sub in part.get('parts', []):
            result = decode_body(sub)
            if result:
                return result
        return ''
    return base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')

def extract_text(part):
    """Recursively extract plain text from MIME part."""
    mime = part.get('mimeType', '')
    if mime == 'text/plain':
        return decode_body(part)
    if mime.startswith('multipart/'):
        texts = [extract_text(p) for p in part.get('parts', [])]
        return '\n'.join(t for t in texts if t)
    return ''

def parse_message(msg):
    """Parse a Gmail message into a dict."""
    headers = {h['name'].lower(): h['value'] for h in msg.get('payload', {}).get('headers', [])}
    text = extract_text(msg.get('payload', {}))
    # Truncate very long texts
    if len(text) > 4000:
        text = text[:4000] + '\n[... truncated ...]'
    return {
        'id':      msg['id'],
        'date':    headers.get('date', ''),
        'from':    headers.get('from', ''),
        'to':      headers.get('to', ''),
        'subject': headers.get('subject', ''),
        'snippet': msg.get('snippet', ''),
        'body':    text
    }

def thread_to_prompt(thread_messages):
    """Format thread messages into a compact string for Claude."""
    parts = []
    for m in thread_messages[-MAX_EMAILS_PER_THREAD:]:
        parts.append(
            f"From: {m['from']}\nDate: {m['date']}\nSubject: {m['subject']}\n\n{m['body'] or m['snippet']}"
        )
    return '\n\n---\n\n'.join(parts)

# ─── Claude analysis ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an intelligent task extraction assistant for a business professional.
You analyze email threads and extract structured task information.
Always respond with valid JSON only — no markdown, no explanation."""

TASK_PROMPT = """Analyze this email thread and extract task information.

EMAIL THREAD:
{thread_text}

Extract the following and respond as JSON:
{{
  "clientName": "<name of the external company or person — NOT the user's own company>",
  "taskTitle": "<one concise sentence describing the main action needed>",
  "priority": "<urgent|medium|low — urgent if deadline within 48h or explicitly urgent, low if FYI>",
  "actionables": ["<specific action 1>", "<specific action 2>"],
  "nextStepPerson": "<who needs to act: 'Us' (if we must act) or the client/person name>",
  "summary": "<2-3 sentence summary of what this email thread is about and what was discussed>",
  "status": "<pending|completed — completed only if the issue/request is clearly resolved in the thread>",
  "conversationHistory": [
    {{"date": "<ISO date>", "from": "<sender name/email>", "subject": "<subject>", "snippet": "<1-sentence summary of this email>"}}
  ]
}}

Rules:
- clientName: use the company name or person name of the OTHER party, not the user's org
- If the thread has no clear actionable, set taskTitle to a brief description and priority to "low"
- Keep each actionable under 80 characters
- conversationHistory: include all emails in the thread, newest last"""

def analyse_thread_with_claude(client, thread_messages):
    """Call Claude to extract task from thread. Returns dict or None."""
    thread_text = thread_to_prompt(thread_messages)
    try:
        msg = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{
                'role': 'user',
                'content': TASK_PROMPT.format(thread_text=thread_text)
            }]
        )
        raw = msg.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[1].rsplit('```', 1)[0]
        return json.loads(raw)
    except Exception as e:
        print(f"  Claude error: {e}")
        return None

# ─── Task ID generation ───────────────────────────────────────────────────────

def make_task_id(thread_id):
    return 'task_' + hashlib.md5(thread_id.encode()).hexdigest()[:12]

def make_client_id(client_name):
    return 'client_' + hashlib.md5(client_name.lower().encode()).hexdigest()[:10]

# ─── Merge logic ──────────────────────────────────────────────────────────────

def merge_task(existing_task, analysis, thread_id, message_ids, now_iso):
    """
    Merge Claude's analysis into an existing task, preserving user overrides.
    User overrides are stored in _userPriority, _userAssignedTo, _userStatus fields
    (set when user_data.json is loaded and merged — see below).
    """
    task = dict(existing_task)

    # Always update AI-derived fields
    task['title']               = analysis.get('taskTitle', task.get('title', ''))
    task['summary']             = analysis.get('summary',   task.get('summary', ''))
    task['actionables']         = analysis.get('actionables', task.get('actionables', []))
    task['nextStepPerson']      = analysis.get('nextStepPerson', task.get('nextStepPerson', ''))
    task['conversationHistory'] = analysis.get('conversationHistory', task.get('conversationHistory', []))
    task['emailMessageIds']     = list(set(task.get('emailMessageIds', []) + message_ids))
    task['updatedAt']           = now_iso

    # Only update priority/status if user has NOT manually overridden them
    if not task.get('_userEdited'):
        task['priority'] = analysis.get('priority', task.get('priority', 'medium'))
        ai_status = analysis.get('status', 'pending')
        if ai_status == 'completed' and task.get('status') != 'completed':
            task['status']      = 'completed'
            task['completedAt'] = now_iso
        elif ai_status == 'pending' and task.get('status') == 'completed':
            pass  # Don't reopen a task the user completed

    return task

def build_new_task(analysis, thread_id, client_name, message_ids, now_iso):
    """Create a brand-new task dict from Claude's analysis."""
    ai_status = analysis.get('status', 'pending')
    return {
        'id':                 make_task_id(thread_id),
        'clientId':           make_client_id(client_name),
        'clientName':         client_name,
        'title':              analysis.get('taskTitle', 'Untitled Task'),
        'priority':           analysis.get('priority', 'medium'),
        'status':             ai_status,
        'assignedTo':         None,
        'emailThreadId':      thread_id,
        'emailMessageIds':    message_ids,
        'summary':            analysis.get('summary', ''),
        'actionables':        analysis.get('actionables', []),
        'nextStepPerson':     analysis.get('nextStepPerson', ''),
        'conversationHistory': analysis.get('conversationHistory', []),
        'createdAt':          now_iso,
        'updatedAt':          now_iso,
        'completedAt':        now_iso if ai_status == 'completed' else None,
        'source':             'email',
        '_userEdited':        False
    }

def update_client_registry(clients, client_name, client_id):
    if client_id not in clients:
        clients[client_id] = {
            'id':    client_id,
            'name':  client_name,
            'order': len(clients)
        }

# ─── Main processing loop ─────────────────────────────────────────────────────

def main():
    now_iso = datetime.now(timezone.utc).isoformat()
    print(f"[{now_iso}] Starting email processor...")

    # ── Load existing data
    data = read_json_file(DATA_FILE) or {
        'metadata': {
            'version':              '1.0',
            'lastUpdated':          now_iso,
            'lastEmailDate':        None,
            'totalEmailsProcessed': 0
        },
        'clients': {},
        'tasks':   {}
    }
    tasks   = data.get('tasks',   {})
    clients = data.get('clients', {})
    meta    = data.get('metadata', {})

    # Also load user_data to respect user overrides
    user_data_raw = read_json_file('data/user_data.json') or {}
    overrides     = user_data_raw.get('taskOverrides', {})

    # Apply user overrides to task flags so merge_task sees them
    for tid, ov in overrides.items():
        if tid in tasks:
            if ov.get('priority'):   tasks[tid]['priority']   = ov['priority']
            if ov.get('assignedTo'): tasks[tid]['assignedTo'] = ov['assignedTo']
            if ov.get('status'):     tasks[tid]['status']     = ov['status']
            tasks[tid]['_userEdited'] = True

    # ── Determine date range
    last_email_date = meta.get('lastEmailDate')
    if last_email_date:
        since = datetime.fromisoformat(last_email_date.replace('Z','+00:00'))
    else:
        since = datetime.now(timezone.utc) - timedelta(days=INITIAL_DAYS)

    since_ts   = int(since.timestamp())
    gmail_query = f'after:{since_ts} -from:noreply -from:no-reply -category:promotions -category:social'
    print(f"Fetching emails since: {since.strftime('%Y-%m-%d %H:%M UTC')}")

    # ── Connect to Gmail
    gmail_service = get_gmail_service()
    messages      = gmail_search(gmail_service, gmail_query)
    if not messages:
        print("No new emails found.")
        data['metadata']['lastUpdated'] = now_iso
        write_json_file(DATA_FILE, data)
        return

    print(f"Found {len(messages)} messages. Grouping by thread...")

    # Group messages by thread (deduplicate)
    seen_threads = {}
    for m in messages:
        tid = m['threadId']
        if tid not in seen_threads:
            seen_threads[tid] = []
        seen_threads[tid].append(m['id'])

    # Build existing thread → task mapping
    thread_to_task = {t.get('emailThreadId'): tid for tid, t in tasks.items() if t.get('emailThreadId')}

    # ── Claude client
    anthropic_client = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])

    processed = 0
    newest_date = since

    for thread_id, msg_ids in list(seen_threads.items())[:MAX_THREADS]:
        print(f"  Processing thread {thread_id[:12]}... ({processed+1}/{len(seen_threads)})")
        try:
            thread = get_gmail_service().users().threads().get(
                userId='me', id=thread_id, format='full'
            ).execute()

            raw_messages = thread.get('messages', [])
            parsed = [parse_message(m) for m in raw_messages]

            # Track newest email date
            for p in parsed:
                try:
                    d = datetime.strptime(p['date'][:31], '%a, %d %b %Y %H:%M:%S %z')
                    if d > newest_date: newest_date = d
                except Exception:
                    pass

            analysis = analyse_thread_with_claude(anthropic_client, parsed)
            if not analysis:
                processed += 1
                continue

            client_name = (analysis.get('clientName') or 'Unknown').strip()
            if not client_name or client_name.lower() in ('unknown', 'n/a', ''):
                client_name = 'Uncategorized'

            client_id = make_client_id(client_name)
            update_client_registry(clients, client_name, client_id)

            existing_task_id = thread_to_task.get(thread_id)
            if existing_task_id and existing_task_id in tasks:
                tasks[existing_task_id] = merge_task(
                    tasks[existing_task_id], analysis, thread_id,
                    [m['id'] for m in parsed], now_iso
                )
                print(f"    Updated task: {tasks[existing_task_id]['title'][:60]}")
            else:
                new_task = build_new_task(analysis, thread_id, client_name,
                                          [m['id'] for m in parsed], now_iso)
                tasks[new_task['id']] = new_task
                thread_to_task[thread_id] = new_task['id']
                print(f"    New task: {new_task['title'][:60]}")

            processed += 1
            time.sleep(0.3)  # gentle rate limiting

        except Exception as e:
            print(f"  Error processing thread {thread_id}: {e}")
            traceback.print_exc()
            processed += 1
            continue

    # ── Update metadata
    data['metadata'] = {
        'version':              '1.0',
        'lastUpdated':          now_iso,
        'lastEmailDate':        newest_date.isoformat(),
        'totalEmailsProcessed': meta.get('totalEmailsProcessed', 0) + processed
    }
    data['tasks']   = tasks
    data['clients'] = clients

    write_json_file(DATA_FILE, data)
    print(f"\nDone. Processed {processed} threads. Tasks in DB: {len(tasks)}.")

if __name__ == '__main__':
    main()
