/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          SABHYA'S TASK TRACKER — Google Apps Script             ║
 * ║                                                                  ║
 * ║  Reads your Gmail → asks Claude AI to understand each email →   ║
 * ║  saves tasks to your GitHub dashboard.                          ║
 * ║                                                                  ║
 * ║  HOW TO SET UP (do this once):                                  ║
 * ║  1. In this editor, click the ⚙ (gear) icon → "Script          ║
 * ║     properties" → "Add property" and add these 4 values:        ║
 * ║        ANTHROPIC_API_KEY  →  your Claude API key                ║
 * ║        GITHUB_PAT         →  your GitHub Personal Access Token  ║
 * ║        GITHUB_OWNER       →  your GitHub username               ║
 * ║        GITHUB_REPO        →  your repository name               ║
 * ║                                                                  ║
 * ║  2. In the top menu, click "Run" → "setupTrigger"               ║
 * ║     (Google will ask for permission — click Allow)              ║
 * ║                                                                  ║
 * ║  That's it! The script will now run every 10 minutes.           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ── Read configuration from Script Properties ─────────────────────────────────
function getConfig() {
  const p = PropertiesService.getScriptProperties().getProperties();
  return {
    anthropicKey:  p.ANTHROPIC_API_KEY  || '',
    githubPat:     p.GITHUB_PAT         || '',
    githubOwner:   p.GITHUB_OWNER       || '',
    githubRepo:    p.GITHUB_REPO        || '',
    githubBranch:  p.GITHUB_BRANCH      || 'main',
  };
}

// ── STEP 1: Run this function once to start the automatic 10-minute sync ──────
function setupTrigger() {
  // Remove any existing triggers to avoid running twice
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // Create a new trigger: run syncEmails every 10 minutes
  ScriptApp.newTrigger('syncEmails')
    .timeBased()
    .everyMinutes(10)
    .create();

  Logger.log('✅ Trigger created! syncEmails will now run every 10 minutes automatically.');
  Logger.log('Running first sync right now (this reads the last 30 days of email)...');

  // Run immediately so you don't have to wait 10 minutes
  syncEmails();
}

// ── MAIN: Read emails, analyse with Claude, save tasks to GitHub ───────────────
function syncEmails() {
  var config = getConfig();

  // Safety check — make sure all config values are present
  if (!config.anthropicKey || !config.githubPat || !config.githubOwner || !config.githubRepo) {
    Logger.log('❌ ERROR: One or more Script Properties are missing.');
    Logger.log('Please add ANTHROPIC_API_KEY, GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO in Project Settings → Script Properties.');
    return;
  }

  Logger.log('🔄 Email sync started: ' + new Date().toISOString());

  // Load the existing task database from GitHub
  var db = loadDatabase(config);

  // Work out which emails to fetch
  var query = 'in:inbox';
  if (db.isFirstRun) {
    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    var dateStr = Utilities.formatDate(thirtyDaysAgo, 'UTC', 'yyyy/MM/dd');
    query = 'in:inbox after:' + dateStr;
    Logger.log('First run — fetching emails since ' + dateStr + ' (last 30 days)');
  } else if (db.lastSync) {
    var since = new Date(db.lastSync);
    var sinceStr = Utilities.formatDate(since, 'UTC', 'yyyy/MM/dd');
    query = 'in:inbox after:' + sinceStr;
    Logger.log('Incremental sync since ' + sinceStr);
  }

  // Fetch up to 200 threads (more than enough for 10-min intervals)
  var threads = GmailApp.search(query, 0, 200);
  Logger.log('Found ' + threads.length + ' email threads to process');

  var newCount     = 0;
  var updateCount  = 0;
  var errorCount   = 0;
  var startTime    = Date.now();
  var MAX_RUNTIME  = 300000; // 5 minutes (Apps Script limit is 6 min)

  for (var i = 0; i < threads.length; i++) {
    // Stop before hitting the 6-minute execution limit
    if (Date.now() - startTime > MAX_RUNTIME) {
      Logger.log('⏱ Approaching time limit — saving progress. Remaining threads will be picked up next run.');
      break;
    }

    var thread    = threads[i];
    var threadId  = thread.getId();

    try {
      var messages = thread.getMessages();
      if (!messages.length) continue;

      // Build a readable summary of the thread for Claude
      var emailText = '';
      for (var m = 0; m < messages.length; m++) {
        var msg     = messages[m];
        var body    = msg.getPlainBody();
        if (!body) body = stripHtml(msg.getBody());
        // Trim to 1 500 chars per message and remove quoted replies
        body = removeQuotedText(body).substring(0, 1500);
        emailText += '--- Email ' + (m + 1) + ' ---\n';
        emailText += 'From: '    + msg.getFrom()    + '\n';
        emailText += 'To: '      + msg.getTo()      + '\n';
        emailText += 'Date: '    + msg.getDate()    + '\n';
        emailText += 'Subject: ' + msg.getSubject() + '\n\n';
        emailText += body + '\n\n';
      }

      // Ask Claude to analyse the thread
      var analysis = analyseWithClaude(config.anthropicKey, emailText, messages.length);
      if (!analysis) {
        errorCount++;
        continue;
      }

      var latestDate = messages[messages.length - 1].getDate().toISOString();

      // Check if we already have a task for this thread
      var existingIdx = -1;
      for (var t = 0; t < db.tasks.length; t++) {
        if (db.tasks[t].emailThreadId === threadId) { existingIdx = t; break; }
      }

      if (existingIdx >= 0) {
        // Update existing task — never overwrite fields the user changed manually
        var existing = db.tasks[existingIdx];
        var overrides = existing.manualOverrides || {};

        db.tasks[existingIdx] = {
          id:                existing.id,
          type:              existing.type || 'email',
          clientName:        existing.clientName,
          subject:           analysis.subject           || existing.subject,
          description:       existing.description,
          priority:          overrides.priority         ? existing.priority  : (analysis.priority || existing.priority),
          status:            overrides.status           ? existing.status    : (analysis.isCompleted ? 'completed' : existing.status),
          assignedTo:        overrides.assignedTo       ? existing.assignedTo : existing.assignedTo,
          emailThreadId:     threadId,
          emailMessageCount: messages.length,
          summary:           analysis.summary,
          actionables:       analysis.actionables       || [],
          nextStepPerson:    analysis.nextStepPerson    || '',
          notes:             existing.notes             || '',
          createdAt:         existing.createdAt,
          updatedAt:         latestDate,
          manualOverrides:   overrides,
        };
        updateCount++;

      } else {
        // Create a brand new task
        var clientName = (analysis.clientName || 'Unknown Client').trim();

        if (db.clients.indexOf(clientName) === -1) db.clients.push(clientName);
        if (db.processedThreadIds.indexOf(threadId) === -1) db.processedThreadIds.push(threadId);

        db.tasks.push({
          id:                generateId(),
          type:              'email',
          clientName:        clientName,
          subject:           analysis.subject           || messages[0].getSubject() || 'No Subject',
          description:       analysis.taskDescription   || '',
          priority:          analysis.priority          || 'medium',
          status:            analysis.isCompleted       ? 'completed' : 'pending',
          assignedTo:        '',
          emailThreadId:     threadId,
          emailMessageCount: messages.length,
          summary:           analysis.summary           || '',
          actionables:       analysis.actionables       || [],
          nextStepPerson:    analysis.nextStepPerson    || '',
          notes:             '',
          createdAt:         messages[0].getDate().toISOString(),
          updatedAt:         latestDate,
          manualOverrides:   { priority: false, status: false, assignedTo: false },
        });
        newCount++;
      }

    } catch (err) {
      Logger.log('Error on thread ' + threadId + ': ' + err.message);
      errorCount++;
    }

    // Small pause to be kind to the APIs
    Utilities.sleep(600);
  }

  db.lastSync  = new Date().toISOString();
  db.isFirstRun = false;

  saveDatabase(config, db);

  Logger.log('✅ Sync complete — New: ' + newCount + ', Updated: ' + updateCount + ', Errors: ' + errorCount + ', Total tasks: ' + db.tasks.length);
}

// ── Ask Claude AI to understand an email thread ────────────────────────────────
function analyseWithClaude(apiKey, emailText, msgCount) {
  var prompt =
    'Analyze this email thread (' + msgCount + ' email' + (msgCount > 1 ? 's' : '') + ').\n' +
    'Respond ONLY with valid JSON — no explanation, no markdown code fences.\n\n' +
    'EMAIL THREAD:\n' + emailText + '\n\n' +
    'JSON format:\n' +
    '{\n' +
    '  "clientName": "name of the client or company (use the sender\'s organisation; use \'Internal\' for internal-only emails; never return \'Unknown Client\' if any organisation name is visible)",\n' +
    '  "subject": "concise task title (max 80 characters)",\n' +
    '  "taskDescription": "what needs to be done, written clearly",\n' +
    '  "priority": "urgent OR medium OR low  — urgent means deadline/blocker/immediate action; low means FYI/no rush",\n' +
    '  "actionables": ["specific action item 1", "specific action item 2"],\n' +
    '  "nextStepPerson": "full name or email of who should act next",\n' +
    '  "isCompleted": false,\n' +
    '  "summary": "2-3 sentences summarising the full conversation and current status"\n' +
    '}';

  try {
    var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method:  'post',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      payload: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('Claude API returned ' + code + ': ' + response.getContentText().substring(0, 200));
      return null;
    }

    var data = JSON.parse(response.getContentText());
    if (!data.content || !data.content[0]) return null;

    var text = data.content[0].text.trim();
    // Strip accidental markdown code fences
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(text);

  } catch (e) {
    Logger.log('Claude API error: ' + e.message);
    return null;
  }
}

// ── Load tasks.json from GitHub ────────────────────────────────────────────────
function loadDatabase(config) {
  var url = 'https://api.github.com/repos/' + config.githubOwner + '/' + config.githubRepo + '/contents/data/tasks.json';
  try {
    var res = UrlFetchApp.fetch(url, {
      headers: {
        Authorization: 'token ' + config.githubPat,
        Accept:        'application/vnd.github.v3+json',
      },
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() === 200) {
      var data    = JSON.parse(res.getContentText());
      var decoded = Utilities.newBlob(Utilities.base64Decode(data.content.replace(/\n/g, ''))).getDataAsString();
      var db      = JSON.parse(decoded);
      // Remember SHA so we can update the file later
      PropertiesService.getScriptProperties().setProperty('tasks_sha', data.sha);
      Logger.log('Database loaded from GitHub. Tasks: ' + (db.tasks || []).length);
      return db;
    }
  } catch (e) {
    Logger.log('Could not load database: ' + e.message);
  }

  // Return empty database if file doesn't exist yet
  return { version: 1, lastSync: null, isFirstRun: true, tasks: [], clients: [], employees: [], processedThreadIds: [] };
}

// ── Save tasks.json back to GitHub ─────────────────────────────────────────────
function saveDatabase(config, db) {
  var url     = 'https://api.github.com/repos/' + config.githubOwner + '/' + config.githubRepo + '/contents/data/tasks.json';
  var sha     = PropertiesService.getScriptProperties().getProperty('tasks_sha');
  var content = Utilities.base64Encode(JSON.stringify(db, null, 2));

  var body = {
    message: 'chore: sync tasks from email',
    content: content,
    branch:  config.githubBranch,
  };
  if (sha) body.sha = sha;

  try {
    var res = UrlFetchApp.fetch(url, {
      method:  'put',
      headers: {
        Authorization:  'token ' + config.githubPat,
        'Content-Type': 'application/json',
      },
      payload:            JSON.stringify(body),
      muteHttpExceptions: true,
    });

    var code = res.getResponseCode();
    if (code === 200 || code === 201) {
      var saved = JSON.parse(res.getContentText());
      PropertiesService.getScriptProperties().setProperty('tasks_sha', saved.content.sha);
      Logger.log('✅ Database saved to GitHub.');
    } else {
      Logger.log('❌ Failed to save: HTTP ' + code + ' — ' + res.getContentText().substring(0, 300));
    }
  } catch (e) {
    Logger.log('Save error: ' + e.message);
  }
}

// ── Small helpers ──────────────────────────────────────────────────────────────
function stripHtml(html) {
  return (html || '')
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

function removeQuotedText(text) {
  return (text || '')
    .split('\n')
    .filter(function(line) { return line.trim().charAt(0) !== '>'; })
    .join('\n')
    .replace(/On .+wrote:/g, '')
    .trim();
}

function generateId() {
  return 'gs-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
}
