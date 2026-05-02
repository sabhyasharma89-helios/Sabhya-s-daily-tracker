/* ═══════════════════════════════════════════════════════
   EMAIL PROCESSOR — CLAUDE AI INTEGRATION
═══════════════════════════════════════════════════════ */

const Processor = {
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  API_URL: 'https://api.anthropic.com/v1/messages',

  async init(db) {
    this.db = db;
    this.apiKey = await db.getSetting('claudeApiKey');
  },

  async refreshKey() {
    this.apiKey = await this.db.getSetting('claudeApiKey');
  },

  // ─── Core Claude call ────────────────────────────────────
  async _callClaude(systemPrompt, userMessage) {
    if (!this.apiKey) throw new Error('Claude API key not set');

    const res = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.CLAUDE_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API error ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return data.content[0].text;
  },

  // ─── Process a single email thread ───────────────────────
  async processThread(formattedThread) {
    const { threadId, subject, messages } = formattedThread;

    const threadText = messages.map((m, i) =>
      `--- Message ${i + 1} ---\nFrom: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`
    ).join('\n\n');

    const system = `You are an intelligent email analysis assistant. Your job is to read email threads and extract structured task information. You always respond with valid JSON only — no markdown fences, no extra text.`;

    const user = `Analyse this email thread and extract task information. Return a JSON object with EXACTLY this structure:

{
  "clientName": "Name of the client/company this email is about (infer from domain, signatures, or context)",
  "isActionable": true or false,
  "tasks": [
    {
      "title": "Short, clear task title (max 80 chars)",
      "priority": "urgent" | "medium" | "low",
      "status": "pending" | "completed",
      "summary": "2-3 sentence summary of the overall email thread and what needs to be done",
      "actionables": ["Specific action item 1", "Specific action item 2"],
      "nextStepsPerson": "Name of person responsible for next action (from email)",
      "isCompleted": true or false
    }
  ],
  "overallCompleted": true or false
}

Rules:
- clientName: Identify the external client/company (not your own company). If internal email, use "Internal".
- isActionable: false if the email is just FYI, newsletters, receipts, or no action required.
- priority: "urgent" if deadline < 3 days or marked urgent; "medium" for general work; "low" for informational/follow-ups.
- status: "completed" if the thread shows the task is done.
- overallCompleted: true if the thread as a whole shows all work is done.
- If not actionable, return tasks as empty array.

EMAIL THREAD (Subject: ${subject}):

${threadText}`;

    try {
      const raw = await this._callClaude(system, user);
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        // Try to extract JSON from response
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error('Could not parse Claude response as JSON');
      }
      return parsed;
    } catch (err) {
      console.error('Processor error for thread', threadId, err);
      return null;
    }
  },

  // ─── Update database from processed result ─────────────
  async applyResult(threadId, subject, messages, result) {
    if (!result || !result.isActionable) return;

    const client = await this.db.findOrCreateClient(result.clientName || 'Unknown');

    // Save thread record
    await this.db.saveThread({
      id: threadId,
      clientId: client.id,
      subject,
      processedAt: Date.now(),
      messages: messages.map(m => ({
        from: m.from,
        date: m.date,
        body: m.body,
      })),
    });

    // Find existing tasks for this thread
    const existingTasks = await this.db.getTasksByThread(threadId);

    for (const taskData of (result.tasks || [])) {
      // Try to find matching existing task (by title similarity)
      const existing = existingTasks.find(t =>
        t.title.toLowerCase().trim() === taskData.title.toLowerCase().trim()
      );

      if (existing) {
        // Update existing task
        existing.priority  = taskData.priority || existing.priority;
        existing.summary   = taskData.summary  || existing.summary;
        existing.actionables = taskData.actionables || existing.actionables;
        existing.nextStepsPerson = taskData.nextStepsPerson || existing.nextStepsPerson;
        // Only auto-complete, never auto-uncomplete
        if (taskData.status === 'completed' || taskData.isCompleted) {
          existing.status = 'completed';
          existing.completedAt = existing.completedAt || Date.now();
        }
        await this.db.saveTask(existing);
      } else {
        // Create new task
        const newTask = {
          id: crypto.randomUUID(),
          threadId,
          clientId: client.id,
          clientName: client.name,
          title: taskData.title,
          priority: taskData.priority || 'medium',
          status: (taskData.status === 'completed' || taskData.isCompleted) ? 'completed' : 'pending',
          summary: taskData.summary || '',
          actionables: taskData.actionables || [],
          nextStepsPerson: taskData.nextStepsPerson || '',
          assignedTo: '',
          emailSubject: subject,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: null,
        };
        await this.db.saveTask(newTask);
      }
    }

    // If overall thread completed, mark all thread tasks as completed
    if (result.overallCompleted) {
      const allThreadTasks = await this.db.getTasksByThread(threadId);
      for (const t of allThreadTasks) {
        if (t.status === 'pending') await this.db.markComplete(t.id);
      }
    }
  },

  // ─── Batch process multiple threads ─────────────────────
  async processThreads(threads, onProgress) {
    let processed = 0;
    for (const thread of threads) {
      try {
        const result = await this.processThread(thread);
        await this.applyResult(thread.threadId, thread.subject, thread.messages, result);
      } catch (err) {
        console.error('Failed to process thread', thread.threadId, err);
      }
      processed++;
      if (onProgress) onProgress(processed, threads.length);
      // Small delay to avoid rate limiting
      if (processed < threads.length) await new Promise(r => setTimeout(r, 300));
    }
  },
};
