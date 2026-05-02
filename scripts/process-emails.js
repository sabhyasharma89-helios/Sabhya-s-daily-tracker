#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   process-emails.js
   Runs as a scheduled GitHub Actions job every 10 minutes.
   1. Fetches new Gmail emails since last run
   2. Analyses each thread with Claude AI
   3. Creates / updates / completes tasks in data/tasks.json
   4. Commits the updated file back to the repo

   Required environment variables (set as GitHub Secrets):
     GMAIL_CLIENT_ID       — Google OAuth2 client ID
     GMAIL_CLIENT_SECRET   — Google OAuth2 client secret
     GMAIL_REFRESH_TOKEN   — Gmail OAuth2 refresh token
     ANTHROPIC_API_KEY     — Claude API key
     GITHUB_TOKEN          — Auto-provided by GitHub Actions
     GITHUB_REPOSITORY     — Auto-provided (owner/repo)
   ══════════════════════════════════════════════════════════════════ */

'use strict';

const fs        = require('fs');
const path      = require('path');
const { google }   = require('googleapis');
const Anthropic    = require('@anthropic-ai/sdk');
const { Octokit }  = require('@octokit/rest');

/* ── Configuration ── */
const cfg = {
  gmail: {
    clientId:     process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  github: {
    token:    process.env.GITHUB_TOKEN,
    repo:     process.env.GITHUB_REPOSITORY || '',        // "owner/repo"
    branch:   process.env.GITHUB_REF_NAME  || 'main',
    filePath: 'data/tasks.json',
  }
};

const DATA_FILE = path.join(__dirname, '..', 'data', 'tasks.json');

/* ── Helpers ── */

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Load / save task data ── */

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      metadata: { version: '1.0.0', lastUpdated: null, lastEmailFetched: null,
                  totalEmailsProcessed: 0, initialized: false },
      clients: {}, tasks: [], employees: [], syncLog: []
    };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  data.metadata.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ── Gmail ── */

function buildGmailClient() {
  const auth = new google.auth.OAuth2(cfg.gmail.clientId, cfg.gmail.clientSecret);
  auth.setCredentials({ refresh_token: cfg.gmail.refreshToken });
  return google.gmail({ version: 'v1', auth });
}

async function fetchEmailsSince(gmail, sinceDate) {
  const q = sinceDate
    ? `after:${Math.floor(new Date(sinceDate).getTime() / 1000)}`
    : `newer_than:30d`;

  log(`Fetching emails with query: ${q}`);

  const threads = [];
  let pageToken;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me', q, maxResults: 50, pageToken
    });

    const items = res.data.threads || [];
    for (const item of items) {
      const thread = await gmail.users.threads.get({
        userId: 'me', id: item.id, format: 'full'
      });
      threads.push(thread.data);
      await sleep(50); // Avoid rate limits
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken && threads.length < 200);

  log(`Fetched ${threads.length} threads`);
  return threads;
}

function extractBody(payload) {
  if (!payload) return '';

  function decode(data) {
    try { return Buffer.from(data, 'base64url').toString('utf8'); }
    catch { return ''; }
  }

  if (payload.body?.data) return decode(payload.body.data);

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data)
        return decode(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function parseMessage(msg) {
  const headers = {};
  (msg.payload?.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });

  return {
    id:      msg.id,
    from:    headers['from']    || '',
    to:      headers['to']      || '',
    subject: headers['subject'] || '',
    date:    headers['date']    || new Date(parseInt(msg.internalDate)).toISOString(),
    snippet: msg.snippet || '',
    body:    extractBody(msg.payload).substring(0, 2000), // truncate for API
  };
}

function parseThread(thread) {
  const messages = (thread.messages || []).map(parseMessage);
  return {
    id:       thread.id,
    messages,
    subject:  messages[0]?.subject || '',
    latest:   messages[messages.length - 1],
    earliest: messages[0],
  };
}

/* ── Claude AI ── */

function buildAnalysisClient() {
  return new Anthropic({ apiKey: cfg.anthropic.apiKey });
}

async function analyseThread(client, thread, existingTask) {
  const emailSummary = thread.messages.map((m, i) =>
    `Email ${i + 1} [${m.date}] From: ${m.from}\nSubject: ${m.subject}\n${m.body || m.snippet}`
  ).join('\n\n---\n\n');

  const systemPrompt = `You are an intelligent task management assistant. You analyse email threads and extract actionable task information. Always respond with valid JSON only. Today's date: ${new Date().toISOString().split('T')[0]}.`;

  const userPrompt = `Analyse this email thread and extract task information. Return a JSON object with exactly these fields:

{
  "clientName": "the company/person this email relates to (not the sender's company, but the client/project)",
  "title": "concise task title (max 80 chars)",
  "summary": "2-3 sentence summary of the entire thread and current situation",
  "priority": "urgent|medium|low — urgent if deadline within 3 days or marked urgent/ASAP, low if informational only",
  "actionables": ["list", "of", "specific", "action", "items", "needed"],
  "nextStepsResponsible": "name or role of person responsible for next action",
  "isCompleted": true or false — true if the thread shows the matter is resolved/closed/completed,
  "confidence": 0.0-1.0 — how confident you are this is a real actionable task (not spam/newsletter)
}

${existingTask ? `\nExisting task for context:\nTitle: ${existingTask.title}\nClient: ${existingTask.clientName}\nPriority: ${existingTask.priority}\n` : ''}

Email Thread:
${emailSummary}

Respond with ONLY the JSON object, no markdown, no explanation.`;

  let attempts = 0;
  while (attempts < 3) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      });

      const text = response.content[0]?.text?.trim() || '{}';
      const json = text.startsWith('{') ? text : text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
      return JSON.parse(json);
    } catch (err) {
      attempts++;
      log(`Claude error (attempt ${attempts}): ${err.message}`);
      if (attempts < 3) await sleep(2000 * attempts);
    }
  }

  return null;
}

/* ── Task matching ── */

function findMatchingTask(tasks, thread, analysis) {
  // Match by email thread ID reference
  for (const t of tasks) {
    if ((t.emailThread || []).some(e => e.id === thread.id)) return t;
  }

  // Match by Gmail thread ID stored in task
  if (tasks.some(t => t.gmailThreadId === thread.id)) {
    return tasks.find(t => t.gmailThreadId === thread.id);
  }

  // Fuzzy match by client + similar title
  const clientName = (analysis?.clientName || '').toLowerCase();
  const titleWords = (analysis?.title || '').toLowerCase().split(' ').filter(w => w.length > 4);

  return tasks.find(t => {
    if (t.status === 'completed') return false;
    const sameClient = t.clientName?.toLowerCase() === clientName;
    if (!sameClient) return false;
    const taskWords = (t.title || '').toLowerCase().split(' ');
    const matches = titleWords.filter(w => taskWords.some(tw => tw.includes(w) || w.includes(tw)));
    return matches.length >= Math.ceil(titleWords.length * 0.5);
  });
}

function ensureClient(data, clientName) {
  const existing = Object.values(data.clients).find(
    c => c.name.toLowerCase() === clientName.toLowerCase()
  );
  if (existing) return existing;

  const client = { id: uuid(), name: clientName, createdAt: new Date().toISOString() };
  data.clients[client.id] = client;
  return client;
}

/* ── Process a single thread ── */

async function processThread(aiClient, thread, data) {
  log(`Processing thread: ${thread.subject} (${thread.messages.length} messages)`);

  const existing = findMatchingTask(data.tasks, thread, null);
  const analysis = await analyseThread(aiClient, thread, existing);

  if (!analysis) { log('  → Skipped (AI error)'); return; }
  if (analysis.confidence < 0.4) { log(`  → Skipped (low confidence: ${analysis.confidence})`); return; }

  const clientName  = analysis.clientName || 'General';
  const clientRecord = ensureClient(data, clientName);

  const threadEmails = thread.messages.map(m => ({
    id:      m.id,
    from:    m.from,
    to:      m.to,
    subject: m.subject,
    date:    m.date,
    snippet: m.snippet,
    body:    m.body,
  }));

  if (existing) {
    // Update existing task
    log(`  → Updating task: "${existing.title}"`);

    // Don't override user-set priority or assignee
    if (!existing._userPriority) existing.priority = analysis.priority;
    existing.summary              = analysis.summary;
    existing.actionables          = analysis.actionables || [];
    existing.nextStepsResponsible = analysis.nextStepsResponsible;
    existing.updatedAt            = new Date().toISOString();
    existing.gmailThreadId        = thread.id;

    // Merge email thread (add new messages, don't duplicate)
    const existingIds = new Set((existing.emailThread || []).map(e => e.id));
    for (const email of threadEmails) {
      if (!existingIds.has(email.id)) existing.emailThread.push(email);
    }

    // Auto-complete if AI says it's done
    if (analysis.isCompleted && !existing._userStatus) {
      existing.status      = 'completed';
      existing.completedAt = new Date().toISOString();
      log(`  → Auto-completed task`);
    }
  } else {
    // Create new task
    log(`  → Creating task: "${analysis.title}" [${analysis.priority}] for ${clientName}`);

    const task = {
      id:                   uuid(),
      title:                analysis.title,
      clientId:             clientRecord.id,
      clientName:           clientRecord.name,
      priority:             analysis.priority || 'medium',
      status:               analysis.isCompleted ? 'completed' : 'pending',
      source:               'email',
      gmailThreadId:        thread.id,
      summary:              analysis.summary,
      description:          analysis.summary,
      actionables:          analysis.actionables || [],
      nextStepsResponsible: analysis.nextStepsResponsible,
      assignedTo:           null,
      emailThread:          threadEmails,
      createdAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString(),
      completedAt:          analysis.isCompleted ? new Date().toISOString() : null,
    };

    data.tasks.push(task);
  }
}

/* ── GitHub commit ── */

async function commitToGitHub(data) {
  const [owner, repo] = cfg.github.repo.split('/');
  if (!owner || !repo) { log('No GitHub repo configured — skipping commit'); return; }

  const octokit = new Octokit({ auth: cfg.github.token });
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

  let sha;
  try {
    const { data: fileData } = await octokit.repos.getContent({
      owner, repo, path: cfg.github.filePath, ref: cfg.github.branch
    });
    sha = fileData.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  await octokit.repos.createOrUpdateFileContents({
    owner, repo, branch: cfg.github.branch,
    path:    cfg.github.filePath,
    message: `sync: email processor update [${new Date().toISOString()}]\n\nProcessed ${data.metadata.totalEmailsProcessed} emails total`,
    content,
    ...(sha ? { sha } : {})
  });

  log('Committed tasks.json to GitHub');
}

/* ── Main ── */

async function main() {
  log('=== Email Processor Starting ===');

  // Validate required env vars
  const required = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'ANTHROPIC_API_KEY'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    log(`ERROR: Missing environment variables: ${missing.join(', ')}`);
    log('Please configure these as GitHub Secrets. See README for setup instructions.');
    process.exit(1);
  }

  const data     = loadData();
  const gmail    = buildGmailClient();
  const aiClient = buildAnalysisClient();

  const isFirstRun = !data.metadata.initialized;
  const since      = isFirstRun ? null : data.metadata.lastEmailFetched;

  if (isFirstRun) log('First run: fetching last 30 days of emails');

  // Fetch email threads
  let threads;
  try {
    threads = await fetchEmailsSince(gmail, since);
  } catch (err) {
    log(`Gmail fetch error: ${err.message}`);
    process.exit(1);
  }

  if (threads.length === 0) {
    log('No new emails. Nothing to process.');
    data.metadata.lastEmailFetched = new Date().toISOString();
    saveData(data);
    await commitToGitHub(data);
    return;
  }

  // Process each thread (with concurrency limit of 3)
  const parsed = threads.map(parseThread);
  const CONCURRENCY = 3;

  for (let i = 0; i < parsed.length; i += CONCURRENCY) {
    const batch = parsed.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(t => processThread(aiClient, t, data)));
    await sleep(1000); // Respect Claude rate limits
  }

  data.metadata.lastEmailFetched      = new Date().toISOString();
  data.metadata.totalEmailsProcessed += threads.length;
  data.metadata.initialized           = true;

  // Record sync log entry
  data.syncLog = (data.syncLog || []).slice(-100); // keep last 100 entries
  data.syncLog.push({
    timestamp:  new Date().toISOString(),
    threadsProcessed: threads.length,
    tasksTotal: data.tasks.length,
    isFirstRun,
  });

  saveData(data);
  log(`Saved data: ${data.tasks.length} total tasks`);

  await commitToGitHub(data);

  log('=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
