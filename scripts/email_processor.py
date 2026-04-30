#!/usr/bin/env python3
"""
Email processor for Sabhya's Daily Task Tracker.
Reads Gmail via API, analyses threads with Claude, updates data/tasks.json.
Run by GitHub Actions every 10 minutes.
"""

import os
import json
import base64
import uuid
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import anthropic

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASKS_FILE = os.path.join(ROOT, 'data', 'tasks.json')

CLIENT_COLORS = [
    '#4a90e2', '#e24a6b', '#4ae29a', '#e2a84a',
    '#9a4ae2', '#4ae2e2', '#e24ae2', '#a8e24a',
]

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def get_gmail_service():
    raw_creds = os.environ.get('GMAIL_CREDENTIALS_JSON', '').strip()
    raw_token = os.environ.get('GMAIL_TOKEN_JSON', '').strip()

    if not raw_creds or not raw_token:
        print('ERROR: GMAIL_CREDENTIALS_JSON and GMAIL_TOKEN_JSON must be set.')
        sys.exit(1)

    creds_data = json.loads(raw_creds)
    token_data = json.loads(raw_token)

    app_info = creds_data.get('installed') or creds_data.get('web', {})

    creds = Credentials(
        token=token_data.get('token'),
        refresh_token=token_data.get('refresh_token'),
        token_uri=token_data.get('token_uri', 'https://oauth2.googleapis.com/token'),
        client_id=app_info.get('client_id'),
        client_secret=app_info.get('client_secret'),
        scopes=SCOPES,
    )

    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            print('Access token refreshed.')
        except Exception as e:
            print(f'WARN: Token refresh failed: {e}')

    return build('gmail', 'v1', credentials=creds)

# ---------------------------------------------------------------------------
# Task DB helpers
# ---------------------------------------------------------------------------

def load_tasks():
    os.makedirs(os.path.dirname(TASKS_FILE), exist_ok=True)
    if os.path.exists(TASKS_FILE):
        with open(TASKS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {
        'version': 1, 'lastSync': None,
        'clients': {}, 'employees': [],
        'metadata': {
            'lastHistoryId': None,
            'lastSyncTime': None,
            'initialSyncDone': False,
        },
    }

def save_tasks(tasks):
    tasks['lastSync'] = utcnow()
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)
    print(f'Saved tasks to {TASKS_FILE}')

def utcnow():
    return datetime.now(timezone.utc).isoformat()

def uid():
    return uuid.uuid4().hex[:12]

# ---------------------------------------------------------------------------
# Gmail helpers
# ---------------------------------------------------------------------------

def decode_body(part):
    data = part.get('body', {}).get('data', '')
    if not data:
        return ''
    return base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')

def extract_text(payload):
    mime = payload.get('mimeType', '')
    if mime == 'text/plain':
        return decode_body(payload)
    if mime.startswith('multipart/'):
        for part in payload.get('parts', []):
            text = extract_text(part)
            if text:
                return text
    return decode_body(payload)

def header(headers, name):
    for h in headers:
        if h['name'].lower() == name.lower():
            return h['value']
    return ''

def get_thread_messages(svc, thread_id):
    thread = svc.users().threads().get(
        userId='me', id=thread_id, format='full'
    ).execute()
    msgs = []
    for msg in thread.get('messages', []):
        hdrs = msg.get('payload', {}).get('headers', [])
        body = extract_text(msg.get('payload', {}))
        msgs.append({
            'id': msg['id'],
            'from': header(hdrs, 'from'),
            'to': header(hdrs, 'to'),
            'subject': header(hdrs, 'subject'),
            'date': header(hdrs, 'date'),
            'body': body[:2500],
        })
    return msgs

def get_initial_thread_ids(svc):
    """Return thread IDs from the last 30 days."""
    cutoff = int((datetime.now() - timedelta(days=30)).timestamp())
    ids, token = [], None
    while True:
        kw = {'userId': 'me', 'q': f'after:{cutoff}', 'maxResults': 100}
        if token:
            kw['pageToken'] = token
        res = svc.users().threads().list(**kw).execute()
        ids += [t['id'] for t in res.get('threads', [])]
        token = res.get('nextPageToken')
        if not token:
            break
    print(f'Initial sync: {len(ids)} threads')
    return ids

def get_incremental_thread_ids(svc, history_id):
    """Return thread IDs changed since history_id, plus new history_id."""
    try:
        res = svc.users().history().list(
            userId='me', startHistoryId=history_id,
            historyTypes=['messageAdded'],
        ).execute()
        thread_ids = {
            msg['message']['threadId']
            for record in res.get('history', [])
            for msg in record.get('messagesAdded', [])
        }
        print(f'Incremental: {len(thread_ids)} threads')
        return list(thread_ids), res.get('historyId')
    except Exception as e:
        print(f'History API error ({e}); falling back to 24-hour window')
        cutoff = int((datetime.now() - timedelta(hours=24)).timestamp())
        res = svc.users().threads().list(
            userId='me', q=f'after:{cutoff}', maxResults=100,
        ).execute()
        return [t['id'] for t in res.get('threads', [])], None

def current_history_id(svc):
    return svc.users().getProfile(userId='me').execute().get('historyId')

# ---------------------------------------------------------------------------
# Claude analysis
# ---------------------------------------------------------------------------

def fmt_thread(msgs):
    parts = []
    for i, m in enumerate(msgs, 1):
        parts.append(
            f'--- Email {i} ---\n'
            f'From: {m["from"]}\nTo: {m["to"]}\n'
            f'Date: {m["date"]}\nSubject: {m["subject"]}\n\n'
            f'{m["body"]}'
        )
    return '\n\n'.join(parts)

def analyse_thread(client_api, msgs, existing_task, employees):
    emp_str = ', '.join(e['name'] for e in employees) or 'None'
    ctx = ''
    if existing_task:
        ctx = (
            f'\nEXISTING TASK:\nTitle: {existing_task.get("title","")}\n'
            f'Priority: {existing_task.get("priority","")}\n'
            f'Status: {existing_task.get("status","")}\n'
        )

    prompt = f"""You are an AI assistant that extracts business task information from email threads.

KNOWN TEAM MEMBERS: {emp_str}
{ctx}
EMAIL THREAD:
{fmt_thread(msgs)}

Respond with ONLY a valid JSON object — no markdown, no explanation:
{{
  "clientName": "company/client name (not person name — use domain or signature company)",
  "taskTitle": "concise action-oriented title, max 80 chars",
  "taskDescription": "detailed description with context",
  "priority": "urgent|medium|low",
  "status": "pending|completed",
  "actionables": ["specific action 1", "specific action 2"],
  "nextStepsPerson": "who needs to act next",
  "emailSummary": "3-5 sentence summary of the full conversation",
  "taskCompleted": false,
  "isBusinessRelevant": true
}}

RULES:
- urgent = payment/legal/deadline/time-sensitive
- medium = follow-up/proposals/regular tasks
- low = info/FYI/newsletters
- Set isBusinessRelevant=false for spam, newsletters, OTP, subscriptions
- Set taskCompleted=true if latest email shows resolution/closure
- clientName from company name in signature, domain, or content"""

    response = client_api.messages.create(
        model='claude-opus-4-7',
        max_tokens=1200,
        messages=[{'role': 'user', 'content': prompt}],
    )
    text = response.content[0].text.strip()
    # Strip markdown fences if present
    if text.startswith('```'):
        text = text.split('```', 2)[1]
        if text.startswith('json'):
            text = text[4:]
        text = text.rsplit('```', 1)[0].strip()
    return json.loads(text)

# ---------------------------------------------------------------------------
# DB update
# ---------------------------------------------------------------------------

def find_existing(tasks, thread_id):
    for cid, client in tasks.get('clients', {}).items():
        for task in client.get('tasks', []):
            if thread_id in task.get('emailThreadIds', []):
                return cid, task
    return None, None

def get_or_create_client(tasks, name):
    norm = name.strip().lower()
    for cid, c in tasks['clients'].items():
        if c['name'].lower() == norm:
            return cid, c
    cid = 'client-' + uid()
    color = CLIENT_COLORS[len(tasks['clients']) % len(CLIENT_COLORS)]
    client = {
        'id': cid, 'name': name.strip(),
        'color': color, 'order': len(tasks['clients']),
        'tasks': [],
    }
    tasks['clients'][cid] = client
    print(f'  New client: {name}')
    return cid, client

def apply_analysis(tasks, thread_id, analysis, msgs):
    if not analysis.get('isBusinessRelevant', True):
        return

    client_name = analysis.get('clientName') or ''
    if not client_name or client_name.lower() in ('unknown', 'n/a', ''):
        # Derive from sender domain
        sender = msgs[0].get('from', '') if msgs else ''
        _, addr = parseaddr(sender)
        domain = addr.split('@')[-1].split('.')[0] if '@' in addr else ''
        client_name = domain.capitalize() or 'Unknown'

    cid, client = get_or_create_client(tasks, client_name)
    existing_cid, existing_task = find_existing(tasks, thread_id)
    now = utcnow()

    if existing_task:
        existing_task['emailSummary'] = analysis.get('emailSummary', existing_task.get('emailSummary', ''))
        existing_task['actionables'] = analysis.get('actionables', existing_task.get('actionables', []))
        existing_task['nextStepsPerson'] = analysis.get('nextStepsPerson', existing_task.get('nextStepsPerson', ''))
        existing_task['updatedAt'] = now
        if thread_id not in existing_task.get('emailThreadIds', []):
            existing_task.setdefault('emailThreadIds', []).append(thread_id)
        if analysis.get('taskCompleted') and existing_task.get('status') != 'completed':
            existing_task['status'] = 'completed'
            existing_task['completedAt'] = now
            print(f'  Marked complete: {existing_task["title"]}')
        if not existing_task.get('priorityManuallySet'):
            existing_task['priority'] = analysis.get('priority', existing_task['priority'])
    else:
        task = {
            'id': 'task-' + uid(),
            'clientId': cid,
            'title': analysis.get('taskTitle', 'Untitled Task'),
            'description': analysis.get('taskDescription', ''),
            'priority': analysis.get('priority', 'medium'),
            'status': 'completed' if analysis.get('taskCompleted') else 'pending',
            'assignee': None, 'assigneeName': None,
            'emailThreadIds': [thread_id],
            'emailSummary': analysis.get('emailSummary', ''),
            'actionables': analysis.get('actionables', []),
            'nextStepsPerson': analysis.get('nextStepsPerson', ''),
            'notes': '',
            'createdAt': now, 'updatedAt': now,
            'completedAt': now if analysis.get('taskCompleted') else None,
            'source': 'email', 'userCreated': False,
            'priorityManuallySet': False,
        }
        client['tasks'].append(task)
        print(f'  New task: {task["title"]} [{task["priority"]}]')

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print('=== Email Processor Starting ===')
    tasks = load_tasks()
    meta = tasks.setdefault('metadata', {})
    anthropic_client = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
    svc = get_gmail_service()

    force_full = os.environ.get('FORCE_FULL_SYNC', 'false').lower() == 'true'
    initial_done = meta.get('initialSyncDone', False)
    last_history = meta.get('lastHistoryId')

    if not initial_done or force_full:
        thread_ids = get_initial_thread_ids(svc)
        new_history = current_history_id(svc)
    else:
        thread_ids, new_history = get_incremental_thread_ids(svc, last_history)

    if not thread_ids:
        print('No new threads to process.')
        meta['lastSyncTime'] = utcnow()
        meta['initialSyncDone'] = True
        if new_history:
            meta['lastHistoryId'] = new_history
        save_tasks(tasks)
        return

    ok = err = 0
    for tid in thread_ids:
        try:
            print(f'Processing thread {tid}…')
            msgs = get_thread_messages(svc, tid)
            if not msgs:
                continue
            _, existing = find_existing(tasks, tid)
            analysis = analyse_thread(
                anthropic_client, msgs, existing,
                tasks.get('employees', []),
            )
            apply_analysis(tasks, tid, analysis, msgs)
            ok += 1
        except Exception as e:
            print(f'  ERROR on {tid}: {e}')
            err += 1

    print(f'Done: {ok} processed, {err} errors')

    meta['lastSyncTime'] = utcnow()
    meta['initialSyncDone'] = True
    if new_history:
        meta['lastHistoryId'] = new_history
    elif not last_history:
        meta['lastHistoryId'] = current_history_id(svc)

    save_tasks(tasks)
    print('=== Email Processor Complete ===')


if __name__ == '__main__':
    main()
