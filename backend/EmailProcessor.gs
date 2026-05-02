/**
 * EmailProcessor.gs — Reads Gmail, analyses with Gemini, creates/updates tasks.
 *
 * Flow:
 *  1. Determine lookback window (30 days on first run, else since last run)
 *  2. Search Gmail threads updated in that window
 *  3. For each thread: analyse with Gemini, create/update tasks in DB
 *  4. Save last-run timestamp
 */

const EmailProcessor = (() => {

  const GEMINI_MODEL = 'gemini-1.5-flash';
  const MAX_BODY_LEN = 8000;   // truncate long emails before sending to Gemini

  // ── main entry ───────────────────────────────────────────────
  function run(forceFullSync) {
    DB.init();   // ensure sheets exist

    const isFirstRun = DB.getConfig('isFirstRun') === 'true';
    const doFullSync = forceFullSync || isFirstRun;

    let after;
    if (doFullSync) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      after = _dateToGmailQuery(d);
    } else {
      const last = DB.getConfig('lastProcessedTime');
      if (last) {
        const d = new Date(last);
        after = _dateToGmailQuery(d);
      } else {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        after = _dateToGmailQuery(d);
      }
    }

    console.log('EmailProcessor.run — after:', after, '| fullSync:', doFullSync);

    const query   = `after:${after} -from:me`;
    const threads = GmailApp.search(query, 0, 100);  // max 100 threads per run

    console.log('Found', threads.length, 'threads');

    threads.forEach(thread => {
      try {
        _processThread(thread);
      } catch (err) {
        console.error('Error processing thread', thread.getId(), ':', err);
      }
    });

    DB.setConfig('lastProcessedTime', new Date().toISOString());
    if (isFirstRun) DB.setConfig('isFirstRun', 'false');
  }

  // ── process one thread ────────────────────────────────────────
  function _processThread(thread) {
    const threadId  = thread.getId();
    const messages  = thread.getMessages();
    const msgCount  = messages.length;

    // Check if we've already processed this thread at this message count
    const existing = DB.getThread(threadId);
    if (existing && Number(existing.messageCount) >= msgCount) return;  // no new messages

    const subject   = thread.getFirstMessageSubject();
    const allBodies = messages.map(m => {
      const from = m.getFrom();
      const date = m.getDate().toLocaleDateString();
      const body = _cleanBody(m.getPlainBody() || m.getBody());
      return `[${date}] From: ${from}\n${body}`;
    }).join('\n\n---\n\n');

    const truncated = allBodies.length > MAX_BODY_LEN
      ? allBodies.slice(0, MAX_BODY_LEN) + '\n\n[... truncated for analysis ...]'
      : allBodies;

    const analysis = _analyzeWithGemini(subject, truncated, messages[0].getFrom());
    if (!analysis) return;

    const clientName = analysis.clientName || _extractClientFromSubject(subject);
    const clientId   = _clientIdFromName(clientName);

    if (existing && existing.taskId) {
      // Update existing task
      const updates = {
        threadSummary:  analysis.threadSummary || '',
        emailSummary:   analysis.summary || '',
        updatedAt:      new Date().toISOString(),
      };

      // Add any new actionables
      if (analysis.tasks && analysis.tasks.length > 0) {
        const mainTask = analysis.tasks[0];
        if (mainTask.priority) updates.priority = mainTask.priority;
        if (mainTask.nextStepPerson) updates.nextStepPerson = mainTask.nextStepPerson;
        // Merge new actionables
        const existingTask = DB.getTasks().find(t => t.id === existing.taskId);
        if (existingTask) {
          const newActions = (mainTask.actionItems || []).filter(a =>
            !existingTask.actionables.includes(a)
          );
          if (newActions.length > 0) {
            updates.actionables = [...existingTask.actionables, ...newActions];
          }
        }
      }

      // Auto-close task if email indicates resolution
      if (analysis.isClosingExistingTask) {
        updates.status      = 'completed';
        updates.completedAt = new Date().toISOString();
        console.log('Auto-closing task', existing.taskId, 'for thread', threadId);
      }

      DB.updateTask(existing.taskId, updates);
      DB.upsertThread({ threadId, clientId, taskId: existing.taskId, subject, messageCount: msgCount });

    } else if (analysis.tasks && analysis.tasks.length > 0) {
      // Create new task(s)
      const mainTask = analysis.tasks[0];   // use first task as primary; could create multiple
      const taskData = {
        clientId,
        clientName,
        title:          mainTask.title || subject,
        description:    mainTask.description || analysis.summary || '',
        priority:       mainTask.priority || 'medium',
        status:         analysis.isClosingExistingTask ? 'completed' : 'pending',
        emailThreadId:  threadId,
        emailSummary:   analysis.summary || '',
        threadSummary:  analysis.threadSummary || '',
        actionables:    mainTask.actionItems || [],
        nextStepPerson: mainTask.nextStepPerson || '',
        completedAt:    analysis.isClosingExistingTask ? new Date().toISOString() : '',
      };

      const result = DB.createTask(taskData);
      if (result.task) {
        DB.upsertThread({ threadId, clientId, taskId: result.task.id, subject, messageCount: msgCount });
      }

      // If there are additional tasks in the same thread, create them too
      if (analysis.tasks.length > 1) {
        analysis.tasks.slice(1).forEach(t => {
          DB.createTask({
            clientId, clientName,
            title:          t.title,
            description:    t.description || '',
            priority:       t.priority || 'medium',
            status:         'pending',
            emailThreadId:  threadId,
            emailSummary:   '',
            actionables:    t.actionItems || [],
            nextStepPerson: t.nextStepPerson || '',
          });
        });
      }
    }
  }

  // ── Gemini analysis ───────────────────────────────────────────
  function _analyzeWithGemini(subject, body, from) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
    if (!apiKey) {
      console.warn('GEMINI_KEY not set — skipping AI analysis');
      return _fallbackAnalysis(subject, body, from);
    }

    const prompt = `You are a business task extractor. Analyse this email thread and return a JSON object ONLY (no markdown, no explanation).

Email Thread:
Subject: ${subject}
From: ${from}

${body}

Return this exact JSON structure:
{
  "clientName": "The company or person name this email is from/about (not your company)",
  "summary": "2-3 sentence summary of what this email thread is about",
  "threadSummary": "Comprehensive summary of all conversations in this thread so far",
  "isClosingExistingTask": false,
  "tasks": [
    {
      "title": "Short actionable task title",
      "description": "Detailed description of what needs to be done",
      "priority": "urgent|medium|low",
      "actionItems": ["specific action 1", "specific action 2"],
      "nextStepPerson": "Name or role of who needs to act next"
    }
  ]
}

Rules:
- isClosingExistingTask: set to true if the latest email resolves/closes/completes the topic
- priority: urgent = needs action within 24h, medium = within a week, low = no deadline
- clientName: extract from email domain or signature, not your own company
- If no actionable tasks exist, return an empty tasks array
- Return ONLY valid JSON`;

    try {
      const url     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      };

      const resp   = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      const raw    = JSON.parse(resp.getContentText());
      if (raw.error) { console.error('Gemini error:', raw.error); return _fallbackAnalysis(subject, body, from); }

      const text   = raw.candidates[0].content.parts[0].text.trim();
      const clean  = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(clean);

    } catch (err) {
      console.error('Gemini parse error:', err);
      return _fallbackAnalysis(subject, body, from);
    }
  }

  // fallback when Gemini key not set
  function _fallbackAnalysis(subject, body, from) {
    const clientName = _extractClientFromSubject(subject) || _extractClientFromEmail(from);
    const isClosing  = /\b(resolved|completed|closed|done|finished|thank you for|no further action)\b/i.test(body);
    return {
      clientName,
      summary:               subject,
      threadSummary:         'AI analysis not available. Set GEMINI_KEY in Script Properties.',
      isClosingExistingTask: isClosing,
      tasks: [{
        title:         subject,
        description:   body.slice(0, 300),
        priority:      'medium',
        actionItems:   [],
        nextStepPerson:'',
      }],
    };
  }

  // ── helpers ───────────────────────────────────────────────────
  function _cleanBody(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{3,}/g, '\n\n')
      .trim();
  }

  function _dateToGmailQuery(date) {
    // Gmail 'after:' format is YYYY/MM/DD
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
  }

  function _extractClientFromSubject(subject) {
    // Try to extract [CompanyName] or Re: Meeting with CompanyName
    const bracketMatch = subject.match(/\[([^\]]+)\]/);
    if (bracketMatch) return bracketMatch[1].trim();
    const withMatch = subject.match(/\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    if (withMatch) return withMatch[1].trim();
    return 'General';
  }

  function _extractClientFromEmail(from) {
    const match = from.match(/@([^>]+)>/);
    if (!match) return 'General';
    const domain = match[1].split('.')[0];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }

  function _clientIdFromName(name) {
    return 'client_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  return { run };

})();
