/* ═══════════════════════════════════════
   AI  –  Anthropic Claude API
   Analyses email threads and returns
   structured task / client data
═══════════════════════════════════════ */
const AI = (() => {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL   = 'claude-haiku-4-5-20251001';

  async function _call(systemPrompt, userContent, maxTokens = 1024) {
    const apiKey = await DB.getConfig('anthropicKey');
    if (!apiKey) throw new Error('Anthropic API key not configured.');

    const body = {
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':                    'application/json',
        'x-api-key':                       apiKey,
        'anthropic-version':               '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Claude API error ${res.status}: ${txt}`);
    }
    const data = await res.json();
    return data.content[0].text;
  }

  function _buildThreadText(messages) {
    return messages.map((m, i) => {
      const body = (m.body || m.snippet || '').slice(0, 1200).trim();
      return `--- Message ${i + 1} ---\nFrom: ${m.from}\nTo: ${m.to || ''}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${body}`;
    }).join('\n\n');
  }

  const SYSTEM = `You are an intelligent business task extractor.
Given an email thread, extract structured task data and return ONLY a valid JSON object with NO markdown, NO explanation.

JSON schema:
{
  "clientName":    string,            // Company / person name this email relates to
  "taskTitle":     string,            // Concise task title (max 80 chars)
  "description":   string,            // What needs to be done
  "priority":      "urgent"|"medium"|"low",
  "actionables":   string[],          // Specific action items (array of strings)
  "responsible":   string,            // Person responsible for next step
  "isCompleted":   boolean,           // true if thread indicates task is done/resolved
  "summary":       string,            // Full conversational summary of the thread
  "dueDate":       string|null        // ISO date string if mentioned, else null
}

Priority rules:
- urgent: deadlines <72h, legal/financial risk, words like URGENT/ASAP/critical
- medium: regular business tasks without immediate deadline
- low: informational, FYI, newsletter, no clear action needed
- If no clear action is needed at all, set isCompleted to true.`;

  async function analyseThread(messages) {
    const threadText = _buildThreadText(messages);
    const userContent = `Analyse this email thread and return the JSON:\n\n${threadText}`;

    let raw = '';
    try {
      raw = await _call(SYSTEM, userContent, 1024);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('AI analyse error:', err, '\nRaw:', raw);
      return null;
    }
  }

  async function generateSummary(messages) {
    const threadText = _buildThreadText(messages);
    const system = 'You are a concise business assistant. Write a clear, factual 3-5 sentence summary of the following email conversation. Focus on key decisions, open issues, and next steps.';
    try {
      return await _call(system, threadText, 512);
    } catch (err) {
      console.error('Summary error:', err);
      return 'Summary unavailable.';
    }
  }

  return { analyseThread, generateSummary };
})();
