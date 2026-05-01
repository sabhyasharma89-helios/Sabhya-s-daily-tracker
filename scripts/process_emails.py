#!/usr/bin/env python3
"""
process_emails.py
─────────────────
Reads Gmail, analyses each thread with Claude (claude-sonnet-4-6),
and upserts tasks into data/tasks.json.

Environment variables expected (set as GitHub Secrets):
  GMAIL_TOKEN_JSON   – JSON blob produced by setup_auth.py
  ANTHROPIC_API_KEY  – Anthropic API key
"""

import os, sys, json, re, uuid, base64, logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anthropic
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

DB_PATH    = Path('data/tasks.json')
SCOPES     = ['https://www.googleapis.com/auth/gmail.readonly']
MAX_BODY   = 2000   # chars per email body included in Claude prompt
MAX_EMAILS = 150    # threads per run


# ── Gmail ──────────────────────────────────────────────────────────────

def get_gmail_service():
    raw = os.environ.get('GMAIL_TOKEN_JSON')
    if not raw:
        sys.exit('GMAIL_TOKEN_JSON secret is not set.')
    d = json.loads(raw)
    creds = Credentials(
        token=d.get('token'),
        refresh_token=d['refresh_token'],
        token_uri=d.get('token_uri', 'https://oauth2.googleapis.com/token'),
        client_id=d['client_id'],
        client_secret=d['client_secret'],
        scopes=d.get('scopes', SCOPES),
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


def _decode_body(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='ignore')
    except Exception:
        return ''


def _strip_html(html: str) -> str:
    return re.sub(r'<[^>]+>', ' ', html).strip()


def extract_body(payload) -> str:
    mime = payload.get('mimeType', '')
    body_data = payload.get('body', {}).get('data', '')

    if body_data:
        text = _decode_body(body_data)
        if 'html' in mime:
            text = _strip_html(text)
        return text[:MAX_BODY]

    for part in payload.get('parts', []):
        if part.get('mimeType') == 'text/plain':
            data = part.get('body', {}).get('data', '')
            if data:
                return _decode_body(data)[:MAX_BODY]

    for part in payload.get('parts', []):
        if part.get('mimeType') == 'text/html':
            data = part.get('body', {}).get('data', '')
            if data:
                return _strip_html(_decode_body(data))[:MAX_BODY]

    # Nested multipart
    for part in payload.get('parts', []):
        result = extract_body(part)
        if result:
            return result

    return ''


def get_thread_messages(service, thread_id: str) -> list:
    thread = service.users().threads().get(
        userId='me', id=thread_id, format='full'
    ).execute()
    messages = []
    for msg in thread.get('messages', []):
        hdrs = {h['name'].lower(): h['value'] for h in msg['payload'].get('headers', [])}
        messages.append({
            'id':      msg['id'],
            'from':    hdrs.get('from', ''),
            'to':      hdrs.get('to',   ''),
            'subject': hdrs.get('subject', '(no subject)'),
            'date':    hdrs.get('date',    ''),
            'snippet': msg.get('snippet', ''),
            'body':    extract_body(msg['payload']),
        })
    return messages


# ── Claude ─────────────────────────────────────────────────────────────

def analyse_thread(client: anthropic.Anthropic, messages: list, existing_task: dict | None) -> dict | None:
    thread_text = ''
    for i, m in enumerate(messages, 1):
        thread_text += (
            f'\n--- Email {i} ---\n'
            f'From: {m["from"]}\nTo: {m["to"]}\nDate: {m["date"]}\n'
            f'Subject: {m["subject"]}\nBody: {m["body"] or m["snippet"]}\n'
        )

    existing_ctx = ''
    if existing_task:
        existing_ctx = (
            f'\nExisting task info:\n'
            f'- Client: {existing_task.get("client", "")}\n'
            f'- Priority: {existing_task.get("priority", "")}\n'
            f'- Current summary: {existing_task.get("summary", "")}\n'
            f'- Status: {existing_task.get("status", "")}\n'
        )

    prompt = f"""You are an AI assistant helping manage a professional task tracker.
Analyse the email thread below and return a single JSON object with these keys:

  "client_name"          : The company or individual client this email relates to.
                           Use company name, domain (e.g. acme.com → Acme), or sender/recipient name.
  "task_title"           : Concise task title, max 80 chars.
  "priority"             : "urgent" | "medium" | "low"  (based on deadlines, urgency words, tone).
  "status"               : "pending" | "completed"  (completed only if the thread shows clear resolution).
  "summary"              : 2-3 sentence summary of the thread's purpose and current state.
  "actionables"          : Array of up to 5 specific action items (strings).
  "next_responsible"     : Full name (or role) of the person who must act next.
  "conversation_summary" : One paragraph summarising all conversations chronologically.

{existing_ctx}
Email Thread:{thread_text}

Return ONLY valid JSON – no markdown, no code fences, no extra text."""

    try:
        resp = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=1024,
            messages=[{'role': 'user', 'content': prompt}],
        )
        raw = resp.content[0].text.strip()
        # Strip potential ```json ``` wrapper
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        return json.loads(raw)
    except Exception as e:
        log.warning('Claude parse error: %s', e)
        return None


# ── Database helpers ────────────────────────────────────────────────────

def load_db() -> dict:
    if DB_PATH.exists():
        return json.loads(DB_PATH.read_text())
    return {
        'meta': {
            'last_updated':      '',
            'last_email_check':  '',
            'first_run_complete': False,
            'version':           '1.0',
        },
        'tasks': [],
    }


def save_db(db: dict):
    db['meta']['last_updated'] = datetime.now(timezone.utc).isoformat()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    DB_PATH.write_text(json.dumps(db, indent=2, ensure_ascii=False))


# ── Main ────────────────────────────────────────────────────────────────

def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        sys.exit('ANTHROPIC_API_KEY secret is not set.')

    gmail   = get_gmail_service()
    claude  = anthropic.Anthropic(api_key=api_key)
    db      = load_db()

    is_first = not db['meta'].get('first_run_complete')
    if is_first:
        after_dt = datetime.now(timezone.utc) - timedelta(days=30)
        log.info('First run — fetching emails from last 30 days.')
    else:
        last_iso = db['meta'].get('last_email_check') or ''
        if last_iso:
            after_dt = datetime.fromisoformat(last_iso.replace('Z', '+00:00'))
        else:
            after_dt = datetime.now(timezone.utc) - timedelta(hours=1)
        log.info('Incremental run — fetching emails after %s', after_dt.strftime('%Y-%m-%d %H:%M UTC'))

    after_str = after_dt.strftime('%Y/%m/%d')
    results   = gmail.users().threads().list(
        userId='me', q=f'after:{after_str}', maxResults=MAX_EMAILS
    ).execute()
    threads = results.get('threads', [])
    log.info('Found %d thread(s) to process.', len(threads))

    # Index existing tasks by Gmail thread ID
    thread_idx: dict[str, dict] = {
        t['email_thread_id']: t
        for t in db['tasks']
        if t.get('email_thread_id')
    }

    created_count = updated_count = skipped_count = 0

    for thread_info in threads:
        tid = thread_info['id']
        try:
            messages = get_thread_messages(gmail, tid)
            if not messages:
                continue

            existing = thread_idx.get(tid)
            analysis = analyse_thread(claude, messages, existing)
            if not analysis:
                skipped_count += 1
                continue

            history = [
                {
                    'from':         m['from'],
                    'from_name':    m['from'].split('<')[0].strip().strip('"'),
                    'date':         m['date'],
                    'subject':      m['subject'],
                    'body_preview': (m['body'] or m['snippet'])[:300],
                }
                for m in messages
            ]

            now = datetime.now(timezone.utc).isoformat()

            if existing:
                # Only overwrite fields that should be auto-updated
                existing['updated_at']            = now
                existing['summary']               = analysis.get('summary', existing['summary'])
                existing['actionables']            = analysis.get('actionables', existing['actionables'])
                existing['next_responsible']       = analysis.get('next_responsible', existing.get('next_responsible', ''))
                existing['conversation_summary']   = analysis.get('conversation_summary', '')
                existing['conversation_history']   = history

                # Auto-complete if AI says so and task is still pending
                if analysis.get('status') == 'completed' and existing['status'] == 'pending':
                    existing['status']       = 'completed'
                    existing['completed_at'] = now

                # Respect manually-set priority
                if not existing.get('priority_manual'):
                    existing['priority'] = analysis.get('priority', existing['priority'])

                updated_count += 1
                log.info('Updated  "%s" (%s)', existing['subject'][:60], existing['client'])
            else:
                status = analysis.get('status', 'pending')
                task = {
                    'id':                    str(uuid.uuid4()),
                    'source':                'email',
                    'email_thread_id':       tid,
                    'client':                analysis.get('client_name', 'Unknown'),
                    'subject':               analysis.get('task_title', messages[0]['subject'])[:80],
                    'priority':              analysis.get('priority', 'medium'),
                    'status':                status,
                    'assignee':              '',
                    'created_at':            now,
                    'updated_at':            now,
                    'summary':               analysis.get('summary', ''),
                    'actionables':           analysis.get('actionables', []),
                    'next_responsible':      analysis.get('next_responsible', ''),
                    'conversation_summary':  analysis.get('conversation_summary', ''),
                    'conversation_history':  history,
                    'priority_manual':       False,
                }
                if status == 'completed':
                    task['completed_at'] = now
                db['tasks'].append(task)
                thread_idx[tid] = task
                created_count += 1
                log.info('Created  "%s" (%s)', task['subject'][:60], task['client'])

        except Exception as e:
            log.error('Thread %s failed: %s', tid, e)
            skipped_count += 1

    db['meta']['last_email_check']  = datetime.now(timezone.utc).isoformat()
    db['meta']['first_run_complete'] = True
    save_db(db)

    log.info(
        'Done. created=%d  updated=%d  skipped=%d  total_tasks=%d',
        created_count, updated_count, skipped_count, len(db['tasks'])
    )


if __name__ == '__main__':
    main()
