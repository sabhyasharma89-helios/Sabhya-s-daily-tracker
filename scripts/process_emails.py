#!/usr/bin/env python3
"""Email processor for Sabhya's Daily Tracker.
Fetches Gmail threads, analyzes with Claude, updates data/tasks.json."""

import os
import json
import base64
import uuid
import re
import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import anthropic
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
TASKS_FILE = 'data/tasks.json'
LOOKBACK_DAYS = 30
CLIENT_COLORS = [
    '#58A6FF', '#F78166', '#3FB950', '#E3B341',
    '#BC8CFF', '#79C0FF', '#FFA657', '#FF7B72',
    '#56D364', '#F0883E', '#D2A8FF', '#A5D6FF'
]


def gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=os.environ['GMAIL_REFRESH_TOKEN'],
        token_uri='https://oauth2.googleapis.com/token',
        client_id=os.environ['GMAIL_CLIENT_ID'],
        client_secret=os.environ['GMAIL_CLIENT_SECRET'],
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


def load_db():
    if os.path.exists(TASKS_FILE):
        with open(TASKS_FILE) as f:
            return json.load(f)
    return {
        'metadata': {
            'version': '1.0',
            'created': datetime.now(timezone.utc).isoformat(),
            'lastSync': None,
            'lastEmailDate': None,
            'totalEmails': 0,
        },
        'employees': [],
        'clients': {},
        'processedThreads': [],
    }


def save_db(db):
    os.makedirs('data', exist_ok=True)
    with open(TASKS_FILE, 'w') as f:
        json.dump(db, f, indent=2, default=str)


def after_ts(db):
    last = db['metadata'].get('lastEmailDate')
    if last:
        try:
            return int(datetime.fromisoformat(last).timestamp())
        except Exception:
            pass
    return int((datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).timestamp())


def list_threads(svc, ts):
    threads, page_token = [], None
    while True:
        kw = {'userId': 'me', 'q': f'after:{ts}', 'maxResults': 500}
        if page_token:
            kw['pageToken'] = page_token
        r = svc.users().threads().list(**kw).execute()
        threads.extend(r.get('threads', []))
        page_token = r.get('nextPageToken')
        if not page_token:
            break
    return threads


def get_thread(svc, tid):
    return svc.users().threads().get(userId='me', id=tid, format='full').execute()


def header(msg, name):
    for h in msg.get('payload', {}).get('headers', []):
        if h['name'].lower() == name.lower():
            return h['value']
    return ''


def decode_body(part):
    data = part.get('body', {}).get('data', '')
    if not data:
        return ''
    raw = base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
    if 'html' in part.get('mimeType', ''):
        raw = re.sub(r'<[^>]+>', ' ', raw)
        raw = re.sub(r'\s+', ' ', raw)
    return raw.strip()


def extract_text(part):
    if 'parts' in part:
        return '\n'.join(filter(None, [extract_text(p) for p in part['parts']]))
    mime = part.get('mimeType', '')
    if mime in ('text/plain', 'text/html'):
        return decode_body(part)
    return ''


def color_for(name):
    return CLIENT_COLORS[sum(ord(c) for c in name) % len(CLIENT_COLORS)]


ANALYSIS_PROMPT = """\
Analyze this email thread and extract structured task information.

EMAIL THREAD:
{thread_text}

{existing_hint}

Return ONLY a raw JSON object with exactly these fields:
{{
  "clientName": "Company or person name this email is about (null if internal/newsletter/automated)",
  "title": "Short action-oriented task title under 90 chars",
  "description": "Clear description of what needs to be done",
  "priority": "urgent" or "medium" or "low",
  "status": "pending" or "completed",
  "actionables": ["specific action items as strings"],
  "nextResponsible": "Name/email of who acts next",
  "threadSummary": "2-3 sentence summary of the full conversation",
  "isActionable": true or false
}}

Guidelines:
- clientName: company or individual client/prospect this relates to. null for newsletters, system alerts, purely internal org emails
- priority: urgent = needs action within 24h; medium = within a week; low = no rush
- status: completed if the thread shows the matter is resolved
- isActionable: false for FYI-only, automated alerts, newsletters"""


def analyze(claude, thread_data, existing=None):
    msgs = thread_data['messages']
    thread_text = '\n\n---\n\n'.join(
        f"From: {m['from']}\nTo: {m['to']}\nDate: {m['date']}\nSubject: {m['subject']}\n\n{m['body'][:1500]}"
        for m in msgs[:20]
    )
    existing_hint = ''
    if existing:
        existing_hint = (
            f'Existing task: title="{existing.get("title","")}" '
            f'priority={existing.get("priority","")} status={existing.get("status","")}. '
            'Update if new emails change things.'
        )
    prompt = ANALYSIS_PROMPT.format(thread_text=thread_text, existing_hint=existing_hint)
    resp = claude.messages.create(
        model='claude-sonnet-4-6',
        max_tokens=1024,
        messages=[{'role': 'user', 'content': prompt}],
    )
    text = resp.content[0].text.strip()
    # Strip markdown code fences if present
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    try:
        return json.loads(text)
    except Exception as e:
        log.error(f'Claude JSON parse error: {e}\nText: {text[:200]}')
        return None


def find_existing(db, thread_id):
    for client_name, cd in db.get('clients', {}).items():
        for task in cd.get('tasks', []):
            if task.get('threadId') == thread_id:
                return client_name, task
    return None, None


def process():
    log.info('Starting email sync...')
    db = load_db()
    done_threads = set(db.get('processedThreads', []))

    try:
        svc = gmail_service()
        claude = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
    except Exception as e:
        log.error(f'Service init failed: {e}')
        raise

    ts = after_ts(db)
    log.info(f'Querying Gmail after epoch {ts}')
    threads = list_threads(svc, ts)
    log.info(f'Found {len(threads)} threads')

    new_count = updated_count = 0
    newest_dt = None

    for ti in threads:
        tid = ti['id']
        try:
            raw_thread = get_thread(svc, tid)
            msgs = raw_thread.get('messages', [])
            if not msgs:
                continue

            thread_data = {'id': tid, 'messages': []}
            latest_dt = None

            for msg in msgs:
                d = header(msg, 'date')
                try:
                    dt = parsedate_to_datetime(d)
                    if latest_dt is None or dt > latest_dt:
                        latest_dt = dt
                except Exception:
                    pass
                thread_data['messages'].append({
                    'from': header(msg, 'from'),
                    'to': header(msg, 'to'),
                    'date': d,
                    'subject': header(msg, 'subject'),
                    'body': extract_text(msg.get('payload', {})),
                })

            if latest_dt and (newest_dt is None or latest_dt > newest_dt):
                newest_dt = latest_dt

            old_client, existing_task = find_existing(db, tid)
            # Skip threads with no new messages that we've already processed
            msg_count = len(msgs)
            cached_count = existing_task.get('_msgCount', 0) if existing_task else 0
            if tid in done_threads and existing_task and msg_count == cached_count:
                continue

            info = analyze(claude, thread_data, existing_task)
            if not info or not info.get('isActionable', True) or not info.get('clientName'):
                done_threads.add(tid)
                continue

            client_name = info['clientName'].strip()
            subject = thread_data['messages'][0]['subject'] if thread_data['messages'] else ''
            participants = list(set(
                [m['from'] for m in thread_data['messages']] +
                [m['to'] for m in thread_data['messages']]
            ))[:20]

            if client_name not in db['clients']:
                db['clients'][client_name] = {
                    'color': color_for(client_name),
                    'order': len(db['clients']),
                    'tasks': [],
                }

            now = datetime.now(timezone.utc).isoformat()

            if existing_task:
                existing_task.update({
                    'title': info.get('title', existing_task['title']),
                    'description': info.get('description', existing_task.get('description', '')),
                    'priority': info.get('priority', existing_task['priority']),
                    'status': info.get('status', existing_task['status']),
                    'actionables': info.get('actionables', existing_task.get('actionables', [])),
                    'nextResponsible': info.get('nextResponsible', existing_task.get('nextResponsible', '')),
                    'threadSummary': info.get('threadSummary', existing_task.get('threadSummary', '')),
                    'participants': participants,
                    'updatedAt': now,
                    '_msgCount': msg_count,
                })
                if info.get('status') == 'completed' and not existing_task.get('completedAt'):
                    existing_task['completedAt'] = now
                elif info.get('status') == 'pending':
                    existing_task['completedAt'] = None
                # Move to new client if name changed
                if old_client and old_client != client_name:
                    db['clients'][old_client]['tasks'] = [
                        t for t in db['clients'][old_client]['tasks']
                        if t['id'] != existing_task['id']
                    ]
                    db['clients'][client_name]['tasks'].append(existing_task)
                updated_count += 1
            else:
                task = {
                    'id': str(uuid.uuid4()),
                    'clientName': client_name,
                    'title': info.get('title', subject[:90]),
                    'description': info.get('description', ''),
                    'priority': info.get('priority', 'medium'),
                    'status': info.get('status', 'pending'),
                    'assignee': None,
                    'threadId': tid,
                    'threadSubject': subject,
                    'threadSummary': info.get('threadSummary', ''),
                    'actionables': info.get('actionables', []),
                    'nextResponsible': info.get('nextResponsible', ''),
                    'participants': participants,
                    'createdAt': now,
                    'updatedAt': now,
                    'completedAt': now if info.get('status') == 'completed' else None,
                    '_msgCount': msg_count,
                }
                db['clients'][client_name]['tasks'].append(task)
                new_count += 1

            done_threads.add(tid)
            db['metadata']['totalEmails'] = db['metadata'].get('totalEmails', 0) + 1

        except Exception as e:
            log.error(f'Thread {tid} error: {e}', exc_info=True)
            continue

    db['metadata']['lastSync'] = datetime.now(timezone.utc).isoformat()
    if newest_dt:
        db['metadata']['lastEmailDate'] = newest_dt.isoformat()
    db['processedThreads'] = list(done_threads)

    save_db(db)
    log.info(f'Done — new={new_count} updated={updated_count}')


if __name__ == '__main__':
    process()
