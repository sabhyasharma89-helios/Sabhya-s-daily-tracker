/**
 * email-sync.js
 * Fetches Gmail threads, analyzes with Claude, and updates data/tasks.json.
 * Run by GitHub Actions every 10 minutes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_PATH = join(DATA_DIR, 'tasks.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ── API clients ──────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// ── Data helpers ─────────────────────────────────────────────────────────────

function loadData() {
  if (!existsSync(DATA_PATH)) return makeEmpty();
  try {
    return JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return makeEmpty();
  }
}

function makeEmpty() {
  return {
    meta: {
      version: '1.0.0',
      lastSyncTime: null,
      firstRunComplete: false,
      totalEmailsProcessed: 0,
      totalTasksCreated: 0
    },
    tasks: [],
    employees: [],
    syncLog: []
  };
}

function saveData(data) {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────

function decodeB64Url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function getHeader(headers = [], name) {
  return (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
}

function extractPlainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeB64Url(payload.body.data);
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeB64Url(payload.body.data)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeB64Url(part.body.data);
    }
    for (const part of payload.parts) {
      const t = extractPlainText(part);
      if (t) return t;
    }
  }
  return '';
}

const SKIP_PATTERNS = [
  /noreply/i, /no-reply/i, /do-not-reply/i, /donotreply/i,
  /newsletter/i, /unsubscribe/i, /automated/i, /notification/i,
  /linkedin\.com/i, /twitter\.com/i, /facebook\.com/i,
  /marketing@/i, /promo@/i, /offers@/i, /hello@/i, /support@/i
];

function shouldSkip(subject, from) {
  return SKIP_PATTERNS.some(p => p.test(subject) || p.test(from));
}

// ── Thread fetching ───────────────────────────────────────────────────────────

async function fetchThreadIds(data) {
  const isFirst = !data.meta.firstRunComplete;
  let query;

  if (isFirst) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    query = `after:${y}/${m}/${dd} -category:promotions -category:social -category:updates`;
    console.log(`[FIRST RUN] Fetching 30 days of threads (after ${y}/${m}/${dd})`);
  } else {
    const epochSec = Math.floor(new Date(data.meta.lastSyncTime).getTime() / 1000);
    query = `after:${epochSec} -category:promotions -category:social -category:updates`;
    console.log(`[INCREMENTAL] Fetching threads since ${data.meta.lastSyncTime}`);
  }

  const threads = [];
  let pageToken;
  const MAX = isFirst ? 250 : 150;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken
    });
    if (res.data.threads) threads.push(...res.data.threads);
    pageToken = res.data.nextPageToken;
    if (threads.length >= MAX) break;
  } while (pageToken);

  console.log(`[INFO] ${threads.length} threads to process`);
  return threads;
}

async function getFullThread(id) {
  const res = await gmail.users.threads.get({ userId: 'me', id, format: 'full' });
  return res.data;
}

// ── Claude analysis ───────────────────────────────────────────────────────────

function formatForClaude(thread) {
  const msgs = (thread.messages || []).slice(-8);
  return msgs.map((msg, i) => {
    const h = msg.payload?.headers || [];
    const body = extractPlainText(msg.payload).substring(0, 1500);
    return `[Email ${i + 1}]
From: ${getHeader(h, 'from')}
To: ${getHeader(h, 'to')}
Date: ${getHeader(h, 'date')}
Subject: ${getHeader(h, 'subject')}

${body}`.trim();
  }).join('\n\n---\n\n');
}

async function analyzeThread(thread) {
  const firstHeaders = thread.messages?.[0]?.payload?.headers || [];
  const subject = getHeader(firstHeaders, 'subject');
  const from = getHeader(firstHeaders, 'from');

  if (shouldSkip(subject, from)) {
    console.log(`[SKIP] ${subject.substring(0, 60)}`);
    return null;
  }

  const threadText = formatForClaude(thread);
  if (!threadText.trim()) return null;

  const prompt = `You are a business task extraction assistant. Analyze this email thread and return ONLY a JSON object with no markdown, no explanation.

EMAIL THREAD:
${threadText}

Return exactly this JSON (fill all fields):
{
  "clientName": "Full name of the client/company (extract from signatures, company mentions, email domain e.g. john@acmecorp.com → Acme Corp). Use 'Internal' for internal emails.",
  "taskTitle": "Short actionable task title (max 80 chars)",
  "priority": "urgent",
  "status": "pending",
  "actionables": ["Specific action item 1", "Specific action item 2"],
  "nextStepsPerson": "Name/email of person who needs to act next",
  "summary": "Comprehensive 2-3 sentence summary of the full conversation thread and its current state",
  "isComplete": false
}

Priority rules – choose one:
• urgent: deadline mentioned, ASAP/urgent/critical language, complaint, overdue payment, escalation
• medium: important follow-up needed, deliverable requested, proposal/contract pending
• low: informational email, FYI, future planning, newsletter-like

isComplete/status rules:
• true/completed: email explicitly confirms resolution, payment received, task done, approved, delivered
• false/pending: still waiting for action, response, delivery, or decision`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }]
    });
    const text = response.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);
    // Validate required fields
    if (!parsed.clientName || !parsed.taskTitle) throw new Error('Missing required fields');
    return parsed;
  } catch (err) {
    console.error(`[ERROR] Claude failed for thread ${thread.id}: ${err.message}`);
    return null;
  }
}

// ── Task management ───────────────────────────────────────────────────────────

function buildHistory(thread) {
  return (thread.messages || []).map(msg => {
    const h = msg.payload?.headers || [];
    return {
      from: getHeader(h, 'from'),
      to: getHeader(h, 'to'),
      subject: getHeader(h, 'subject'),
      date: getHeader(h, 'date'),
      snippet: (msg.snippet || '').substring(0, 400)
    };
  });
}

async function processThread(data, threadId) {
  const thread = await getFullThread(threadId);
  const analysis = await analyzeThread(thread);
  if (!analysis) return null;

  const now = new Date().toISOString();
  const msgIds = (thread.messages || []).map(m => m.id);
  const history = buildHistory(thread);

  const existing = data.tasks.find(t => t.emailThreadId === threadId);

  if (existing) {
    existing.summary = analysis.summary;
    existing.actionables = analysis.actionables;
    existing.nextStepsPerson = analysis.nextStepsPerson;
    existing.conversationHistory = history;
    existing.emailMessageIds = msgIds;
    existing.updatedAt = now;
    if (!existing.manualPriority) {
      existing.priority = analysis.priority;
    }
    if (analysis.isComplete && existing.status === 'pending') {
      existing.status = 'completed';
      existing.completedAt = now;
    }
    return 'updated';
  }

  data.tasks.push({
    id: randomUUID(),
    clientName: analysis.clientName,
    title: analysis.taskTitle,
    priority: analysis.priority,
    status: analysis.isComplete ? 'completed' : 'pending',
    assignee: null,
    emailThreadId: threadId,
    emailMessageIds: msgIds,
    summary: analysis.summary,
    actionables: analysis.actionables,
    nextStepsPerson: analysis.nextStepsPerson,
    conversationHistory: history,
    createdAt: now,
    updatedAt: now,
    completedAt: analysis.isComplete ? now : null,
    manuallyCreated: false,
    manualPriority: false
  });
  data.meta.totalTasksCreated++;
  return 'created';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`[START] Email sync at ${new Date().toISOString()}`);
  const t0 = Date.now();

  const data = loadData();
  const threads = await fetchThreadIds(data);
  let created = 0, updated = 0, errors = 0;

  // Process in batches of 5 to respect rate limits
  for (let i = 0; i < threads.length; i += 5) {
    const batch = threads.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(({ id }) => processThread(data, id))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'created') created++;
        else if (r.value === 'updated') updated++;
      } else {
        errors++;
        console.error('[ERROR]', r.reason?.message);
      }
    }
    if (i + 5 < threads.length) await sleep(2000);
  }

  const elapsed = Date.now() - t0;
  data.meta.lastSyncTime = new Date().toISOString();
  data.meta.firstRunComplete = true;
  data.meta.totalEmailsProcessed += threads.length;

  data.syncLog = [{
    timestamp: data.meta.lastSyncTime,
    threadsProcessed: threads.length,
    tasksCreated: created,
    tasksUpdated: updated,
    errors,
    durationMs: elapsed
  }, ...data.syncLog].slice(0, 100);

  saveData(data);
  console.log(`[DONE] ${threads.length} threads | ${created} created | ${updated} updated | ${errors} errors | ${elapsed}ms`);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
