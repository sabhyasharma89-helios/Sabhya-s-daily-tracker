/**
 * Email Task Processor
 * Reads Gmail, analyzes threads with Claude, updates task database.
 * Runs via GitHub Actions every 10 minutes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// ── Clients ────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// ── File helpers ───────────────────────────────────────────────────────────

function loadData(filename) {
  const fp = path.join(DATA_DIR, filename);
  return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : null;
}

function saveData(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// ── Email parsing ──────────────────────────────────────────────────────────

function decodeBase64(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractTextFromPart(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64(part.body.data);
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return stripHtml(decodeBase64(part.body.data));
  }
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractTextFromPart(p);
      if (t) return t;
    }
  }
  return '';
}

function getHeader(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function parseMessage(msg) {
  return {
    messageId: msg.id,
    from: getHeader(msg.payload?.headers, 'from'),
    to: getHeader(msg.payload?.headers, 'to'),
    cc: getHeader(msg.payload?.headers, 'cc'),
    subject: getHeader(msg.payload?.headers, 'subject'),
    date: new Date(parseInt(msg.internalDate)).toISOString(),
    snippet: msg.snippet || '',
    body: extractTextFromPart(msg.payload).substring(0, 3000),
  };
}

// ── Claude analysis ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional business assistant. Your job is to analyze email threads and extract structured task information for a business task tracker. You must always respond with valid JSON only — no explanation, no markdown, just the raw JSON object.`;

async function analyzeThread(messages, existingTask) {
  const subject = messages[0]?.subject || 'No Subject';
  const participants = [...new Set(messages.flatMap(m => [m.from, m.to, m.cc].filter(Boolean)))].join(', ');

  const conversation = messages
    .map((m, i) => `[Email ${i + 1}]\nFrom: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`)
    .join('\n\n---\n\n');

  const userPrompt = `Analyze this email thread and return a JSON object:

SUBJECT: ${subject}
PARTICIPANTS: ${participants}

CONVERSATION:
${conversation.substring(0, 8000)}

${existingTask ? `\nEXISTING TASK (update this):\n${JSON.stringify({ title: existingTask.title, priority: existingTask.priority, status: existingTask.status }, null, 2)}` : ''}

Return ONLY this JSON (no other text):
{
  "clientName": "Company or person name this email primarily concerns (the client/project, not the sender's org)",
  "taskTitle": "Concise action-oriented title, max 90 chars",
  "priority": "high|medium|low",
  "status": "pending|completed",
  "summary": "3-4 sentence comprehensive summary of the full conversation, covering context, decisions, and current situation",
  "actionables": ["Specific action item 1", "Specific action item 2"],
  "nextStepResponsible": "Name or email of who must act next",
  "statusReason": "One sentence explaining why status is pending or completed"
}

Rules:
- priority=high if urgent, time-sensitive, client-blocking or deadline mentioned
- priority=medium if important but not immediate
- priority=low if informational or low urgency
- status=completed ONLY if the email explicitly shows the matter is fully resolved/closed
- clientName should be recognizable business entity, not an email address`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude returned non-JSON: ${text.substring(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ── Client helpers ─────────────────────────────────────────────────────────

const CLIENT_COLORS = [
  '#4A90E2', '#7B68EE', '#50C878', '#FF6B6B', '#FFA500',
  '#20B2AA', '#FF69B4', '#8FBC8F', '#DDA0DD', '#87CEEB',
];

function findOrCreateClient(clientsData, name) {
  const normalized = name.trim();
  let client = clientsData.clients.find(
    c => c.name.toLowerCase() === normalized.toLowerCase()
  );
  if (!client) {
    client = {
      id: `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: normalized,
      color: CLIENT_COLORS[clientsData.clients.length % CLIENT_COLORS.length],
      order: clientsData.clients.length,
      createdAt: new Date().toISOString(),
    };
    clientsData.clients.push(client);
    clientsData.clientOrder.push(client.id);
  }
  return client;
}

// ── Main sync ──────────────────────────────────────────────────────────────

async function syncEmails() {
  console.log('=== Email Task Sync Starting ===');

  const tasksData = loadData('tasks.json');
  const clientsData = loadData('clients.json');
  const metadata = loadData('metadata.json');

  if (!tasksData || !clientsData || !metadata) {
    console.error('ERROR: data files missing. Make sure tasks.json, clients.json, metadata.json exist.');
    process.exit(1);
  }

  // Determine date range
  const isFirstRun = metadata.isFirstRun || process.env.FORCE_FULL_SYNC === 'true';
  let afterTimestamp;

  if (isFirstRun) {
    console.log('First run detected — processing last 30 days of emails...');
    const d = new Date();
    d.setDate(d.getDate() - 30);
    afterTimestamp = Math.floor(d.getTime() / 1000);
  } else {
    console.log('Incremental sync — processing emails since last sync...');
    const lastSync = metadata.lastSyncTime
      ? new Date(metadata.lastSyncTime)
      : new Date(Date.now() - 12 * 60 * 1000);
    afterTimestamp = Math.floor(lastSync.getTime() / 1000);
  }

  // Fetch thread list
  let threads = [];
  let pageToken = undefined;
  const maxThreads = isFirstRun ? 500 : 200;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: `after:${afterTimestamp} -category:promotions -category:social`,
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    if (res.data.threads) threads = threads.concat(res.data.threads);
    pageToken = res.data.nextPageToken;
  } while (pageToken && threads.length < maxThreads);

  console.log(`Found ${threads.length} threads to process`);

  // Build lookup map: threadId → task
  const threadToTask = Object.fromEntries(
    tasksData.tasks.filter(t => t.emailThreadId).map(t => [t.emailThreadId, t])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < threads.length; i++) {
    const { id: threadId } = threads[i];
    process.stdout.write(`[${i + 1}/${threads.length}] Thread ${threadId} ... `);

    try {
      // Get full thread
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      });

      const fullThread = threadRes.data;
      const existingTask = threadToTask[threadId];
      const lastMsg = fullThread.messages[fullThread.messages.length - 1];
      const lastMsgDate = new Date(parseInt(lastMsg.internalDate));

      // Skip unchanged threads on incremental syncs
      if (existingTask && !isFirstRun) {
        const prevDate = new Date(existingTask.latestEmailDate || 0);
        if (lastMsgDate <= prevDate) {
          console.log('skipped (unchanged)');
          skipped++;
          continue;
        }
      }

      // Parse messages
      const parsedMessages = fullThread.messages.map(parseMessage);

      // Claude analysis
      let analysis;
      try {
        analysis = await analyzeThread(parsedMessages, existingTask || null);
      } catch (err) {
        console.log(`analysis failed: ${err.message}`);
        continue;
      }

      const client = findOrCreateClient(clientsData, analysis.clientName);
      const emailList = parsedMessages.map(m => ({
        messageId: m.messageId,
        from: m.from,
        to: m.to,
        subject: m.subject,
        date: m.date,
        snippet: m.snippet,
      }));
      const participants = [...new Set(parsedMessages.flatMap(m => [m.from, m.to, m.cc].filter(Boolean)))];

      if (existingTask) {
        // Update existing task
        existingTask.clientId = client.id;
        existingTask.clientName = client.name;
        existingTask.title = analysis.taskTitle;
        existingTask.priority = analysis.priority;
        existingTask.status = analysis.status;
        existingTask.emailSummary = analysis.summary;
        existingTask.actionables = analysis.actionables;
        existingTask.nextStepResponsible = analysis.nextStepResponsible;
        existingTask.participants = participants;
        existingTask.latestEmailDate = lastMsgDate.toISOString();
        existingTask.updatedAt = new Date().toISOString();
        existingTask.emails = emailList;
        if (analysis.status === 'completed' && !existingTask.completedAt) {
          existingTask.completedAt = new Date().toISOString();
        } else if (analysis.status === 'pending') {
          existingTask.completedAt = null;
        }
        updated++;
        console.log(`updated → ${analysis.taskTitle.substring(0, 50)}`);
      } else {
        // Create new task
        const newTask = {
          id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          clientId: client.id,
          clientName: client.name,
          title: analysis.taskTitle,
          description: '',
          priority: analysis.priority,
          status: analysis.status,
          assignedTo: null,
          emailThreadId: threadId,
          emailSubject: parsedMessages[0]?.subject || '',
          emailSummary: analysis.summary,
          actionables: analysis.actionables,
          nextStepResponsible: analysis.nextStepResponsible,
          participants,
          latestEmailDate: lastMsgDate.toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: analysis.status === 'completed' ? new Date().toISOString() : null,
          emails: emailList,
          manuallyAdded: false,
        };
        tasksData.tasks.push(newTask);
        threadToTask[threadId] = newTask;
        created++;
        console.log(`created → ${analysis.taskTitle.substring(0, 50)}`);
      }

      // Throttle to respect API rate limits
      if (i < threads.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  // Update metadata
  metadata.lastSyncTime = new Date().toISOString();
  metadata.isFirstRun = false;
  metadata.totalEmailsProcessed += threads.length;
  metadata.totalThreadsProcessed = tasksData.tasks.length;
  metadata.syncLog = [
    {
      time: new Date().toISOString(),
      threadsScanned: threads.length,
      created,
      updated,
      skipped,
    },
    ...(metadata.syncLog || []),
  ].slice(0, 100);

  tasksData.lastUpdated = new Date().toISOString();

  saveData('tasks.json', tasksData);
  saveData('clients.json', clientsData);
  saveData('metadata.json', metadata);

  console.log(`\n=== Sync Complete ===`);
  console.log(`Created: ${created} | Updated: ${updated} | Skipped: ${skipped}`);
  console.log(`Total tasks in database: ${tasksData.tasks.length}`);
}

syncEmails().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
