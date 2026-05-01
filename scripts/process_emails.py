#!/usr/bin/env python3
"""
Email Task Processor – Sabhya's Daily Task Tracker
Runs via GitHub Actions every 10 minutes.

Flow:
  1. Load existing tasks.json and metadata.json
  2. Authenticate with Gmail API using stored refresh token
  3. Fetch emails since last read (or last 30 days on first run)
  4. For each email thread, call Claude API to:
       - Identify client name
       - Extract actionable tasks
       - Determine task status (open/closed)
       - Summarise the thread
       - Set priority
  5. Upsert tasks into tasks.json
  6. Commit updated JSON files back to repo
"""

import os, json, re, time, base64, hashlib, logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import anthropic
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
log = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT      = Path(__file__).parent.parent
TASKS_F   = ROOT / 'data' / 'tasks.json'
META_F    = ROOT / 'data' / 'metadata.json'
EMP_F     = ROOT / 'data' / 'employees.json'

# ── Env vars (set as GitHub Secrets) ──────────────────────────────────────────
ANTHROPIC_API_KEY     = os.environ['ANTHROPIC_API_KEY']
GMAIL_CLIENT_ID       = os.environ['GMAIL_CLIENT_ID']
GMAIL_CLIENT_SECRET   = os.environ['GMAIL_CLIENT_SECRET']
GMAIL_REFRESH_TOKEN   = os.environ['GMAIL_REFRESH_TOKEN']
GMAIL_USER            = os.environ.get('GMAIL_USER', 'me')

CLAUDE_MODEL = 'claude-sonnet-4-6'
MAX_THREADS_PER_RUN = 50   # cap to stay within API rate limits


# ══════════════════════════════════════════════════════════════════════════════
#  DATA HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception as e:
            log.warning(f'Could not parse {path}: {e}')
    return default

def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

def task_id(thread_id: str) -> str:
    return 'email_' + hashlib.sha1(thread_id.encode()).hexdigest()[:16]

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def recalc_stats(data: dict) -> dict:
    total = pending = completed = urgent = medium = low = 0
    for client_data in data.get('clients', {}).values():
        for task in client_data.get('tasks', []):
            total += 1
            if task.get('status') == 'completed': completed += 1
            else: pending += 1
            p = task.get('priority', 'medium')
            if p == 'urgent': urgent += 1
            elif p == 'medium': medium += 1
            else: low += 1
    return dict(total=total, pending=pending, completed=completed,
                urgent=urgent, medium=medium, low=low)


# ══════════════════════════════════════════════════════════════════════════════
#  GMAIL
# ══════════════════════════════════════════════════════════════════════════════

def build_gmail():
    creds = Credentials(
        token=None,
        refresh_token=GMAIL_REFRESH_TOKEN,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=GMAIL_CLIENT_ID,
        client_secret=GMAIL_CLIENT_SECRET,
        scopes=['https://www.googleapis.com/auth/gmail.readonly'],
    )
    creds.refresh(Request())
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)

def decode_body(payload: dict) -> str:
    """Recursively extract plain-text body from MIME parts."""
    if payload.get('mimeType') == 'text/plain':
        data = payload.get('body', {}).get('data', '')
        if data:
            return base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')
    for part in payload.get('parts', []):
        result = decode_body(part)
        if result:
            return result
    return ''

def get_header(headers: list, name: str) -> str:
    for h in headers:
        if h['name'].lower() == name.lower():
            return h['value']
    return ''

def fetch_threads(service, after_ts: int | None, first_run: bool) -> list:
    """Return list of thread objects to process."""
    if first_run or after_ts is None:
        # Last 30 days
        since = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())
    else:
        since = after_ts

    query = f'after:{since}'
    threads = []
    next_token = None

    while True:
        kwargs = dict(userId='me', q=query, maxResults=100)
        if next_token:
            kwargs['pageToken'] = next_token
        resp = service.users().threads().list(**kwargs).execute()
        threads.extend(resp.get('threads', []))
        next_token = resp.get('nextPageToken')
        if not next_token or len(threads) >= MAX_THREADS_PER_RUN:
            break

    return threads[:MAX_THREADS_PER_RUN]

def fetch_thread_detail(service, thread_id: str) -> dict:
    """Return processed thread dict with messages list."""
    raw = service.users().threads().get(userId='me', id=thread_id, format='full').execute()
    messages = []
    for msg in raw.get('messages', []):
        headers = msg.get('payload', {}).get('headers', [])
        body = decode_body(msg.get('payload', {}))
        messages.append({
            'id':      msg['id'],
            'from':    get_header(headers, 'From'),
            'to':      get_header(headers, 'To'),
            'subject': get_header(headers, 'Subject'),
            'date':    get_header(headers, 'Date'),
            'body':    body[:3000],   # cap per message
        })
    subject = messages[0]['subject'] if messages else ''
    return {'threadId': thread_id, 'subject': subject, 'messages': messages}


# ══════════════════════════════════════════════════════════════════════════════
#  CLAUDE ANALYSIS
# ══════════════════════════════════════════════════════════════════════════════

def build_prompt(thread: dict) -> str:
    msgs_text = '\n\n'.join(
        f"[{m.get('date','')}] FROM: {m.get('from','')} TO: {m.get('to','')}\n{m.get('body','')}"
        for m in thread['messages']
    )
    return f"""You are an intelligent email task extractor. Analyse the following email thread and respond with a single JSON object (no markdown, no extra text).

EMAIL THREAD SUBJECT: {thread['subject']}

MESSAGES:
{msgs_text[:8000]}

Return this exact JSON structure:
{{
  "client_name": "<name of the client / company this thread is about; use 'Internal' if internal>",
  "task_title": "<short, action-focused title (max 80 chars)>",
  "task_description": "<2-3 sentence description of what needs to be done>",
  "priority": "<urgent|medium|low>",
  "status": "<pending|completed — completed only if the latest email clearly indicates the matter is resolved>",
  "action_items": ["<item 1>", "<item 2>"],
  "next_responsible": "<name/role of person responsible for next step>",
  "thread_summary": "<comprehensive 3-5 sentence summary of the entire conversation so far>",
  "is_actionable": <true|false — false for newsletters, automated notifications, etc.>
}}

Priority rules:
- urgent: deadlines within 48h, legal/financial/compliance matters, client escalations
- medium: regular client requests, follow-ups, project updates
- low: informational, newsletters, FYI threads

Status rules:
- completed: only if the email explicitly says something like "done", "resolved", "closed", "confirmed", "approved" AND no further action is pending
- pending: everything else"""

def analyse_thread(client: anthropic.Anthropic, thread: dict) -> dict | None:
    prompt = build_prompt(thread)
    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system='You are a precise task extraction assistant. Always respond with valid JSON only.',
            messages=[{'role': 'user', 'content': prompt}],
        )
        text = response.content[0].text.strip()
        # Strip markdown code fences if present
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
        return json.loads(text)
    except Exception as e:
        log.warning(f'Claude error on thread {thread["threadId"]}: {e}')
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  UPSERT LOGIC
# ══════════════════════════════════════════════════════════════════════════════

def upsert_task(tasks_data: dict, thread: dict, analysis: dict):
    if not analysis.get('is_actionable', True):
        return   # skip non-actionable threads

    client_name = (analysis.get('client_name') or 'Uncategorized').strip()
    tid = task_id(thread['threadId'])

    # Find existing task across all clients
    existing_task = None
    existing_client_key = None
    for cname, cdata in tasks_data['clients'].items():
        for task in cdata.get('tasks', []):
            if task.get('id') == tid:
                existing_task = task
                existing_client_key = cname
                break

    email_thread_payload = {
        'threadId': thread['threadId'],
        'subject':  thread['subject'],
        'messages': thread['messages'],
        'summary':  analysis.get('thread_summary', ''),
    }

    if existing_task:
        # Move to new client if changed
        if existing_client_key and existing_client_key != client_name:
            tasks_data['clients'][existing_client_key]['tasks'] = [
                t for t in tasks_data['clients'][existing_client_key]['tasks']
                if t['id'] != tid
            ]
            if not tasks_data['clients'][existing_client_key]['tasks']:
                del tasks_data['clients'][existing_client_key]

        # Only update status to completed if Claude says so;
        # never downgrade manually-completed tasks automatically
        new_status = analysis.get('status', 'pending')
        if existing_task.get('status') == 'completed' and new_status != 'completed':
            new_status = 'completed'  # preserve manual completion

        existing_task.update({
            'title':           analysis.get('task_title', existing_task['title']),
            'description':     analysis.get('task_description', ''),
            'priority':        analysis.get('priority', 'medium'),
            'status':          new_status,
            'actionItems':     analysis.get('action_items', []),
            'nextResponsible': analysis.get('next_responsible', ''),
            'emailThread':     email_thread_payload,
            'updatedAt':       now_iso(),
            'source':          'email',
        })
        if new_status == 'completed' and not existing_task.get('completedAt'):
            existing_task['completedAt'] = now_iso()
        log.info(f'Updated task: {existing_task["title"]} [{client_name}]')
    else:
        # New task
        new_task = {
            'id':              tid,
            'title':           analysis.get('task_title', thread['subject'] or 'Untitled'),
            'description':     analysis.get('task_description', ''),
            'priority':        analysis.get('priority', 'medium'),
            'status':          analysis.get('status', 'pending'),
            'actionItems':     analysis.get('action_items', []),
            'nextResponsible': analysis.get('next_responsible', ''),
            'assignedTo':      None,
            'emailThread':     email_thread_payload,
            'createdAt':       now_iso(),
            'updatedAt':       now_iso(),
            'completedAt':     now_iso() if analysis.get('status') == 'completed' else None,
            'source':          'email',
        }

        if client_name not in tasks_data['clients']:
            tasks_data['clients'][client_name] = {'tasks': []}
        tasks_data['clients'][client_name]['tasks'].append(new_task)
        log.info(f'New task: {new_task["title"]} [{client_name}]')


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    log.info('=== Email processor starting ===')

    tasks_data = load_json(TASKS_F, {'clients': {}, 'lastUpdated': None, 'stats': {}})
    meta       = load_json(META_F,  {'lastEmailRead': None, 'firstRun': True, 'version': '1.0.0', 'processingLog': []})

    # Build Gmail service
    log.info('Authenticating with Gmail…')
    try:
        gmail = build_gmail()
    except Exception as e:
        log.error(f'Gmail auth failed: {e}')
        raise

    # Determine fetch window
    first_run = meta.get('firstRun', True)
    last_read_iso = meta.get('lastEmailRead')
    last_read_ts = None
    if last_read_iso:
        try:
            last_read_ts = int(datetime.fromisoformat(last_read_iso).timestamp())
        except Exception:
            pass

    log.info(f'First run: {first_run}, last read: {last_read_iso}')

    # Fetch threads
    log.info('Fetching email threads…')
    threads_meta = fetch_threads(gmail, last_read_ts, first_run)
    log.info(f'Found {len(threads_meta)} threads to process')

    if not threads_meta:
        log.info('No new threads. Done.')
        meta['firstRun'] = False
        meta['lastEmailRead'] = now_iso()
        save_json(META_F, meta)
        return

    # Build Claude client
    claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    processed = 0
    errors = 0

    for t_meta in threads_meta:
        try:
            log.info(f'Processing thread {t_meta["id"]}…')
            thread = fetch_thread_detail(gmail, t_meta['id'])

            if not thread['messages']:
                continue

            analysis = analyse_thread(claude, thread)
            if analysis:
                upsert_task(tasks_data, thread, analysis)
                processed += 1
            else:
                errors += 1

            # Polite rate limiting
            time.sleep(0.5)

        except Exception as e:
            log.warning(f'Error on thread {t_meta.get("id")}: {e}')
            errors += 1

    # Recalc stats
    tasks_data['stats'] = recalc_stats(tasks_data)
    tasks_data['lastUpdated'] = now_iso()

    # Update metadata
    meta['firstRun'] = False
    meta['lastEmailRead'] = now_iso()
    meta['processingLog'] = (meta.get('processingLog', []) + [{
        'timestamp': now_iso(),
        'processed': processed,
        'errors': errors,
        'threads': len(threads_meta),
    }])[-50:]   # keep last 50 entries

    save_json(TASKS_F, tasks_data)
    save_json(META_F,  meta)

    log.info(f'=== Done: {processed} processed, {errors} errors ===')


if __name__ == '__main__':
    main()
