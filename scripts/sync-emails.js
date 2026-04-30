/**
 * Email sync script - runs via GitHub Actions every 10 minutes.
 * Reads Gmail threads, processes with Claude AI, updates data/tasks.json.
 * First run covers the last 30 days; subsequent runs pick up from lastSync.
 */

'use strict';

const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'tasks.json');

// ── Auth setup ──────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// ── Database ─────────────────────────────────────────────────────────────────

function loadDb() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to parse tasks.json, starting fresh:', e.message);
    }
  }
  return {
    version: 1,
    lastSync: null,
    isFirstRun: true,
    tasks: [],
    clients: [],
    employees: [],
    processedThreadIds: []
  };
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────

function decodeB64(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractTextFromPart(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body && part.body.data) {
    return decodeB64(part.body.data);
  }
  if (part.mimeType === 'text/html' && part.body && part.body.data) {
    return decodeB64(part.body.data)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (part.parts) {
    // Prefer plain text, fall back to HTML
    const plain = part.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractTextFromPart(plain);
    return part.parts.map(extractTextFromPart).filter(Boolean).join('\n');
  }
  return '';
}

function parseMessage(message) {
  const hdrs = message.payload.headers || [];
  const get = (name) => hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  let body = '';
  if (message.payload.body && message.payload.body.data) {
    body = decodeB64(message.payload.body.data);
  } else if (message.payload.parts) {
    body = extractTextFromPart(message.payload);
  }

  // Strip quoted reply lines (lines starting with ">")
  body = body
    .split('\n')
    .filter(l => !l.trim().startsWith('>'))
    .join('\n')
    .replace(/On .+ wrote:/g, '')
    .trim()
    .substring(0, 1500);

  return {
    from: get('From'),
    to: get('To'),
    cc: get('Cc'),
    subject: get('Subject'),
    date: get('Date'),
    body
  };
}

async function listThreads(db) {
  let afterDate;
  if (db.isFirstRun) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    afterDate = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    console.log(`First run: fetching emails since ${afterDate} (last 30 days)`);
  } else if (db.lastSync) {
    const d = new Date(db.lastSync);
    afterDate = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    console.log(`Incremental sync since ${afterDate}`);
  } else {
    console.log('No lastSync found, fetching all inbox');
  }

  const query = afterDate ? `in:inbox after:${afterDate}` : 'in:inbox';
  const threads = [];
  let pageToken = null;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      pageToken: pageToken || undefined
    });
    if (res.data.threads) threads.push(...res.data.threads);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`Found ${threads.length} threads`);
  return threads;
}

async function getThread(threadId) {
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full'
  });
  return res.data.messages || [];
}

// ── AI analysis ───────────────────────────────────────────────────────────────

async function analyzeThread(messages) {
  const body = messages.map((m, i) => {
    const p = parseMessage(m);
    return `--- Email ${i+1} ---\nFrom: ${p.from}\nTo: ${p.to}${p.cc ? '\nCC: '+p.cc : ''}\nDate: ${p.date}\nSubject: ${p.subject}\n\n${p.body}`;
  }).join('\n\n');

  const prompt = `You are analyzing an email thread to extract task management data.

EMAIL THREAD (${messages.length} email${messages.length > 1 ? 's' : ''}):
${body}

Analyze the above and respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "clientName": "Name of the client/company this email is about. Look for company names, project names, or the sender's organization. Use 'Internal' for internal-only emails. Never return 'Unknown Client'.",
  "subject": "A concise task title (max 80 chars) based on the email subject",
  "taskDescription": "What needs to be done - clear, actionable description",
  "priority": "urgent|medium|low — urgent means deadline/blocker/immediate action; low means informational/no rush",
  "actionables": ["specific action item 1", "specific action item 2"],
  "nextStepPerson": "Full name or email of who should act next",
  "isCompleted": false,
  "summary": "2-3 sentence summary of the full conversation and current status"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  // Strip possible markdown code fences
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

// ── Main sync ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Email Sync Started: ${new Date().toISOString()} ===`);

  const db = loadDb();
  let newCount = 0;
  let updateCount = 0;
  let errorCount = 0;

  const threads = await listThreads(db);

  for (const thread of threads) {
    const threadId = thread.id;

    try {
      const messages = await getThread(threadId);
      if (!messages.length) continue;

      const analysis = await analyzeThread(messages);

      const latestInternalDate = messages[messages.length - 1].internalDate;
      const latestDate = latestInternalDate
        ? new Date(parseInt(latestInternalDate)).toISOString()
        : new Date().toISOString();

      const existingIdx = db.tasks.findIndex(t => t.emailThreadId === threadId);

      if (existingIdx >= 0) {
        // Update existing task — respect manual overrides
        const t = db.tasks[existingIdx];
        db.tasks[existingIdx] = {
          ...t,
          subject: analysis.subject || t.subject,
          summary: analysis.summary,
          actionables: analysis.actionables,
          nextStepPerson: analysis.nextStepPerson,
          emailMessageCount: messages.length,
          updatedAt: latestDate,
          // Only override priority/status if not manually set
          priority: t.manualOverrides && t.manualOverrides.priority ? t.priority : (analysis.priority || t.priority),
          status: t.manualOverrides && t.manualOverrides.status
            ? t.status
            : (analysis.isCompleted ? 'completed' : (t.status === 'completed' && !analysis.isCompleted ? 'pending' : t.status))
        };
        updateCount++;
      } else {
        // New task
        const clientName = (analysis.clientName || 'Unknown Client').trim();
        if (!db.clients.includes(clientName)) db.clients.push(clientName);
        if (!db.processedThreadIds.includes(threadId)) db.processedThreadIds.push(threadId);

        db.tasks.push({
          id: generateId(),
          type: 'email',
          clientName,
          subject: analysis.subject || parseMessage(messages[0]).subject || 'No Subject',
          description: analysis.taskDescription || '',
          priority: analysis.priority || 'medium',
          status: analysis.isCompleted ? 'completed' : 'pending',
          assignedTo: '',
          emailThreadId: threadId,
          emailMessageCount: messages.length,
          summary: analysis.summary || '',
          actionables: analysis.actionables || [],
          nextStepPerson: analysis.nextStepPerson || '',
          notes: '',
          createdAt: messages[0].internalDate
            ? new Date(parseInt(messages[0].internalDate)).toISOString()
            : new Date().toISOString(),
          updatedAt: latestDate,
          manualOverrides: { priority: false, status: false, assignedTo: false }
        });
        newCount++;
      }
    } catch (err) {
      console.error(`Error processing thread ${threadId}: ${err.message}`);
      errorCount++;
    }

    // Throttle to respect Gmail/Anthropic rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  db.lastSync = new Date().toISOString();
  db.isFirstRun = false;
  saveDb(db);

  console.log(`\n=== Sync Complete ===`);
  console.log(`New tasks:     ${newCount}`);
  console.log(`Updated tasks: ${updateCount}`);
  console.log(`Errors:        ${errorCount}`);
  console.log(`Total tasks:   ${db.tasks.length}`);
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
