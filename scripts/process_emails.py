#!/usr/bin/env python3
"""
Email processor for Sabhya's Daily Tracker.

Reads Gmail threads, analyses each with Claude AI, and writes
structured task data to data/tasks.json.

Usage:
  python process_emails.py             # incremental (since last run)
  python process_emails.py --initial   # last 30 days (first run)

Required environment variables (set as GitHub Secrets):
  GMAIL_REFRESH_TOKEN
  GMAIL_CLIENT_ID
  GMAIL_CLIENT_SECRET
  ANTHROPIC_API_KEY
"""

import os
import sys
import json
import base64
import hashlib
import re
import time
import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import anthropic
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

SCOPES    = ['https://www.googleapis.com/auth/gmail.readonly']
DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'tasks.json')
DATA_FILE = os.path.normpath(DATA_FILE)

# Skip obviously non-actionable senders
SKIP_PATTERNS = re.compile(
    r'(noreply|no-reply|donotreply|mailer-daemon|postmaster|'
    r'newsletter|notification|alert|unsubscribe|bounce)',
    re.IGNORECASE,
)


# ═══════════════════════════════════════════════
#   Gmail authentication
# ═══════════════════════════════════════════════

def build_gmail_service():
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


# ═══════════════════════════════════════════════
#   Database helpers
# ═══════════════════════════════════════════════

def load_db():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {
        'version': 1,
        'lastUpdated': None,
        'lastEmailDate': None,
        'tasks': [],
        'clients': [],
    }


def save_db(db):
    db['lastUpdated'] = datetime.now(timezone.utc).isoformat()
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    log.info('Database saved → %s', DATA_FILE)


# ═══════════════════════════════════════════════
#   Gmail helpers
# ═══════════════════════════════════════════════

def list_threads(service, after_date: datetime):
    """Yield thread stubs that have messages newer than after_date."""
    query = 'after:' + after_date.strftime('%Y/%m/%d')
    page_token = None
    while True:
        resp = service.users().threads().list(
            userId='me', q=query, pageToken=page_token, maxResults=200
        ).execute()
        for t in resp.get('threads', []):
            yield t
        page_token = resp.get('nextPageToken')
        if not page_token:
            break


def get_thread(service, thread_id):
    return service.users().threads().get(
        userId='me', id=thread_id, format='full'
    ).execute()


def _text_from_part(part):
    """Recursively extract plain-text body from a MIME part."""
    mime = part.get('mimeType', '')
    data = part.get('body', {}).get('data', '')

    if mime == 'text/plain' and data:
        return base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')

    if mime == 'text/html' and data:
        html = base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')
        return re.sub(r'<[^>]+>', ' ', html)

    for sub in part.get('parts', []):
        result = _text_from_part(sub)
        if result:
            return result
    return ''


def parse_message(msg):
    headers = {h['name'].lower(): h['value'] for h in msg.get('payload', {}).get('headers', [])}
    date_str = headers.get('date', '')
    try:
        dt = parsedate_to_datetime(date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        dt = datetime.now(timezone.utc)

    return {
        'id':      msg['id'],
        'from':    headers.get('from', ''),
        'to':      headers.get('to', ''),
        'subject': headers.get('subject', '(no subject)'),
        'date':    dt.isoformat(),
        'body':    _text_from_part(msg.get('payload', {})),
        '_dt':     dt,
    }


# ═══════════════════════════════════════════════
#   Claude analysis
# ═══════════════════════════════════════════════

def build_thread_text(emails, max_chars=7000):
    parts = []
    for e in emails:
        snippet = e['body'][:1500].strip() if e['body'] else ''
        parts.append(
            f"--- From: {e['from']} | Date: {e['date']} ---\n"
            f"Subject: {e['subject']}\n"
            f"{snippet}\n"
        )
    return ('\n'.join(parts))[:max_chars]


def analyse_thread(client: anthropic.Anthropic, emails: list) -> dict | None:
    thread_text = build_thread_text(emails)

    prompt = f"""You are an executive assistant. Analyse the email thread below and extract task information.

EMAIL THREAD:
{thread_text}

Respond ONLY with a single JSON object — no markdown, no extra text:
{{
  "isActionable": true,
  "clientName": "Name of the client/company/project (infer from email domain, signatures, context; use 'Internal' for internal team emails)",
  "taskTitle": "Concise task title under 10 words",
  "taskDescription": "Clear description of what needs to be done",
  "priority": "urgent",
  "status": "pending",
  "actionables": ["Specific action 1", "Specific action 2"],
  "responsiblePerson": "Full name and/or email of next-step owner",
  "emailSummary": "2-3 sentence summary of the entire conversation"
}}

Priority rules:
  "urgent"  = needs action within 24 hours (deadlines today/tomorrow, escalations, legal/financial urgency)
  "medium"  = needs action this week
  "low"     = whenever convenient

Status rules:
  "completed" = the latest emails clearly indicate the task is resolved/closed/done
  "pending"   = otherwise

isActionable:
  false = newsletters, automated notifications, receipts, spam, FYI-only with no action needed
  true  = anything requiring a human response or decision

If you cannot determine clientName with confidence, use the sender's email domain as company name."""

    try:
        msg = client.messages.create(
            model='claude-opus-4-7',
            max_tokens=800,
            messages=[{'role': 'user', 'content': prompt}],
        )
        text = msg.content[0].text.strip()
        # Strip markdown fences if model adds them
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.MULTILINE).strip()
        return json.loads(text)
    except json.JSONDecodeError as e:
        log.warning('Claude returned non-JSON: %s', e)
        return None
    except anthropic.RateLimitError:
        log.warning('Rate limited — sleeping 20s')
        time.sleep(20)
        return None
    except Exception as e:
        log.warning('Claude error: %s', e)
        return None


# ═══════════════════════════════════════════════
#   Main processing loop
# ═══════════════════════════════════════════════

def process(service, claude_client, db, initial=False):
    # Determine look-back date
    if initial or not db.get('lastEmailDate'):
        since = datetime.now(timezone.utc) - timedelta(days=30)
        log.info('Initial run — reading last 30 days')
    else:
        since = datetime.fromisoformat(db['lastEmailDate'])
        log.info('Incremental run — since %s', since.isoformat())

    # Index existing tasks by thread ID
    thread_index = {t['emailThreadId']: t for t in db['tasks'] if t.get('emailThreadId')}
    clients_set  = set(db.get('clients', []))

    latest_dt    = since
    new_count    = 0
    updated_count = 0

    thread_stubs = list(list_threads(service, since))
    log.info('Found %d thread stubs', len(thread_stubs))

    for stub in thread_stubs:
        tid = stub['id']
        try:
            thread  = get_thread(service, tid)
            emails  = [parse_message(m) for m in thread.get('messages', [])]
            if not emails:
                continue

            # Skip if all emails are older than our since-date (thread predates window)
            most_recent_dt = max(e['_dt'] for e in emails)
            if most_recent_dt <= since and tid in thread_index:
                continue   # nothing new in thread

            # Track latest email date
            if most_recent_dt > latest_dt:
                latest_dt = most_recent_dt

            # Skip obvious automated senders
            last_from = emails[-1].get('from', '')
            if SKIP_PATTERNS.search(last_from):
                continue

            # Analyse
            analysis = analyse_thread(claude_client, emails)
            if not analysis:
                continue
            if not analysis.get('isActionable', True):
                log.debug('Non-actionable thread skipped: %s', emails[0].get('subject'))
                continue

            # Clean emails for storage (remove internal _dt)
            clean_emails = [{k: v for k, v in e.items() if k != '_dt'} for e in emails]

            client_name = (analysis.get('clientName') or 'Unknown').strip()
            if not client_name:
                client_name = 'Unknown'

            now_iso = datetime.now(timezone.utc).isoformat()

            if tid in thread_index:
                # Update existing task
                task = thread_index[tid]
                task['emailSummary']     = analysis.get('emailSummary', task.get('emailSummary', ''))
                task['actionables']      = analysis.get('actionables', task.get('actionables', []))
                task['responsiblePerson'] = analysis.get('responsiblePerson', task.get('responsiblePerson', ''))
                task['emails']           = clean_emails
                task['updatedAt']        = now_iso

                # Auto-complete only if Claude is confident
                if analysis.get('status') == 'completed' and task.get('status') != 'completed':
                    task['status']      = 'completed'
                    task['completedAt'] = now_iso

                updated_count += 1
                log.info('Updated task: %s / %s', client_name, task['title'])
            else:
                # New task
                status = analysis.get('status', 'pending')
                task = {
                    'id':               'email-' + tid,
                    'clientName':       client_name,
                    'title':            (analysis.get('taskTitle') or emails[0]['subject'])[:120],
                    'description':      analysis.get('taskDescription', ''),
                    'priority':         analysis.get('priority', 'medium'),
                    'status':           status,
                    'assignee':         '',
                    'source':           'email',
                    'emailThreadId':    tid,
                    'emailSubject':     emails[0]['subject'],
                    'emailSummary':     analysis.get('emailSummary', ''),
                    'actionables':      analysis.get('actionables', []),
                    'responsiblePerson': analysis.get('responsiblePerson', ''),
                    'emails':           clean_emails,
                    'createdAt':        now_iso,
                    'updatedAt':        now_iso,
                    'completedAt':      now_iso if status == 'completed' else None,
                }
                db['tasks'].append(task)
                thread_index[tid] = task
                new_count += 1
                log.info('New task [%s]: %s / %s', task['priority'], client_name, task['title'])

            clients_set.add(client_name)

            # Brief sleep to respect Claude rate limits
            time.sleep(0.5)

        except HttpError as e:
            log.warning('Gmail HTTP error for thread %s: %s', tid, e)
            continue
        except Exception as e:
            log.error('Unexpected error processing thread %s: %s', tid, e, exc_info=True)
            continue

    db['lastEmailDate'] = latest_dt.isoformat()
    db['clients']       = sorted(clients_set)

    log.info('Done — %d new, %d updated tasks', new_count, updated_count)
    return db


# ═══════════════════════════════════════════════
#   Entry point
# ═══════════════════════════════════════════════

def main():
    initial = '--initial' in sys.argv

    required = ['GMAIL_REFRESH_TOKEN', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'ANTHROPIC_API_KEY']
    missing  = [k for k in required if not os.environ.get(k)]
    if missing:
        log.error('Missing environment variables: %s', ', '.join(missing))
        sys.exit(1)

    log.info('Building Gmail service…')
    service = build_gmail_service()

    log.info('Connecting to Anthropic…')
    claude_client = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])

    log.info('Loading database…')
    db = load_db()

    db = process(service, claude_client, db, initial=initial)
    save_db(db)


if __name__ == '__main__':
    main()
