#!/usr/bin/env python3
"""Email processor: reads Gmail threads, extracts tasks via Claude, updates data/email_updates.json."""

import os
import json
import time
import base64
import re
import hashlib
from datetime import datetime, timedelta, timezone

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import anthropic

DATA_FILE = 'data/email_updates.json'
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']


def gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=os.environ['GMAIL_REFRESH_TOKEN'],
        token_uri='https://oauth2.googleapis.com/token',
        client_id=os.environ['GMAIL_CLIENT_ID'],
        client_secret=os.environ['GMAIL_CLIENT_SECRET'],
        scopes=SCOPES,
    )
    if not creds.valid:
        creds.refresh(Request())
    return build('gmail', 'v1', credentials=creds)


def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {
        'version': None, 'lastUpdated': None, 'lastProcessedDate': None,
        'firstRun': True, 'tasks': [], 'totalEmailsProcessed': 0,
    }


def save_data(data):
    os.makedirs('data', exist_ok=True)
    data['lastUpdated'] = datetime.now(timezone.utc).isoformat()
    payload = json.dumps(data.get('tasks', []), sort_keys=True)
    data['version'] = hashlib.md5(payload.encode()).hexdigest()[:16]
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def extract_body(payload):
    """Recursively extract plain-text body from a Gmail message payload."""
    body = ''
    if payload.get('body', {}).get('data'):
        body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='ignore')
    if not body and payload.get('parts'):
        for part in payload['parts']:
            if part['mimeType'] == 'text/plain' and part.get('body', {}).get('data'):
                body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                break
            if part['mimeType'] == 'text/html' and not body and part.get('body', {}).get('data'):
                html = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                body = re.sub(r'<[^>]+>', ' ', html)
    return re.sub(r'\s+', ' ', body).strip()[:2000]


def thread_messages(service, thread_id):
    thread = service.users().threads().get(userId='me', id=thread_id, format='full').execute()
    msgs = []
    for msg in thread.get('messages', [])[:8]:
        hdrs = {h['name']: h['value'] for h in msg['payload'].get('headers', [])}
        msgs.append({
            'from': hdrs.get('From', ''),
            'subject': hdrs.get('Subject', ''),
            'date': hdrs.get('Date', ''),
            'body': extract_body(msg['payload']),
        })
    return msgs


def format_thread(msgs):
    parts = []
    for i, m in enumerate(msgs):
        parts.append(f'[Email {i+1}]\nFrom: {m["from"]}\nDate: {m["date"]}\nSubject: {m["subject"]}\n{m["body"][:1500]}')
    return '\n\n'.join(parts)


def analyse_with_claude(client, thread_text, existing_tasks):
    refs = json.dumps([{'id': t['id'], 'title': t['title'], 'client': t['client']} for t in existing_tasks[:15]])
    prompt = f"""Analyse this email thread and extract a task.

Email Thread:
{thread_text}

Existing tasks (avoid exact duplicates):
{refs}

Return ONLY a valid JSON object — no prose, no markdown fences:
{{
  "client_name": "Company or person name (not an email address)",
  "task_title": "Concise action title (max 80 chars)",
  "description": "2-3 sentence explanation of what needs to be done",
  "priority": "urgent | medium | low",
  "actionables": ["Specific step 1", "Step 2"],
  "responsible_person": "Name of whoever acts next",
  "status": "pending | completed",
  "email_summary": "2-3 sentence summary of the conversation",
  "is_update": false,
  "update_id": null
}}

Priority rules: urgent = deadline / ASAP / emergency; low = FYI / no action needed; else medium.
Set is_update=true and update_id to the matching existing task id when this email clearly continues an existing task."""

    resp = client.messages.create(
        model='claude-opus-4-5',
        max_tokens=900,
        messages=[{'role': 'user', 'content': prompt}],
    )
    text = resp.content[0].text.strip()
    if '```' in text:
        text = text.split('```')[1].lstrip('json').strip()
        if '```' in text:
            text = text.split('```')[0].strip()
    return json.loads(text)


def list_threads(service, since):
    q = f'after:{int(since.timestamp())} -category:promotions -category:social -category:updates'
    threads, token = [], None
    while True:
        kw = {'userId': 'me', 'q': q, 'maxResults': 50}
        if token:
            kw['pageToken'] = token
        r = service.users().threads().list(**kw).execute()
        threads.extend(r.get('threads', []))
        token = r.get('nextPageToken')
        if not token or len(threads) >= 80:
            break
    return threads


def main():
    print(f'Email processor starting at {datetime.now(timezone.utc).isoformat()}')
    data = load_data()
    task_map = {t['id']: t for t in data.get('tasks', [])}

    if data.get('firstRun') or not data.get('lastProcessedDate'):
        since = datetime.now(timezone.utc) - timedelta(days=30)
        print('First run: scanning last 30 days')
    else:
        since = datetime.fromisoformat(data['lastProcessedDate'])
        print(f'Incremental run since {since.isoformat()}')

    svc = gmail_service()
    ai = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
    threads = list_threads(svc, since)
    print(f'{len(threads)} thread(s) to process')

    processed = 0
    for info in threads:
        tid = info['id']
        task_id = f'task_email_{tid}'
        try:
            msgs = thread_messages(svc, tid)
            if not msgs:
                continue
            result = analyse_with_claude(ai, format_thread(msgs), list(task_map.values()))

            target_id = result.get('update_id') if result.get('is_update') and result.get('update_id') in task_map else task_id

            if target_id in task_map:
                t = task_map[target_id]
                t['emailSummary'] = result.get('email_summary') or t.get('emailSummary', '')
                t['actionables'] = result.get('actionables') or t.get('actionables', [])
                t['responsiblePerson'] = result.get('responsible_person') or t.get('responsiblePerson', '')
                t['description'] = result.get('description') or t.get('description', '')
                if result.get('status') == 'completed':
                    t['status'] = 'completed'
                t['updatedAt'] = datetime.now(timezone.utc).isoformat()
            else:
                task_map[task_id] = {
                    'id': task_id,
                    'title': result.get('task_title') or msgs[0].get('subject') or 'Untitled',
                    'client': result.get('client_name') or 'Unknown',
                    'description': result.get('description', ''),
                    'priority': result.get('priority', 'medium'),
                    'status': result.get('status', 'pending'),
                    'assignee': '',
                    'actionables': result.get('actionables', []),
                    'responsiblePerson': result.get('responsible_person', ''),
                    'emailSummary': result.get('email_summary', ''),
                    'emailThreadId': tid,
                    'emailSubject': msgs[0].get('subject', ''),
                    'source': 'email',
                    'createdAt': datetime.now(timezone.utc).isoformat(),
                    'updatedAt': datetime.now(timezone.utc).isoformat(),
                    'completedAt': None,
                    'userModified': {},
                }
            processed += 1
            time.sleep(0.4)
        except Exception as e:
            print(f'  Error on thread {tid}: {e}')
            continue

    data['tasks'] = list(task_map.values())
    data['lastProcessedDate'] = datetime.now(timezone.utc).isoformat()
    data['firstRun'] = False
    data['totalEmailsProcessed'] = data.get('totalEmailsProcessed', 0) + processed
    save_data(data)
    print(f'Done. Processed {processed} thread(s). Total tasks: {len(data["tasks"])}')


if __name__ == '__main__':
    main()
