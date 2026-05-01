/* Smart rule-based email parser — no external AI API required */
const EmailParser = (() => {
  const GENERIC_DOMAINS = new Set([
    'gmail.com','yahoo.com','hotmail.com','outlook.com','live.com',
    'icloud.com','me.com','aol.com','protonmail.com','ymail.com',
    'rediffmail.com','msn.com','comcast.net','att.net','verizon.net'
  ]);

  const PRIORITY_URGENT = [
    'urgent','asap','immediately','critical','emergency',
    'high priority','p0','p1','overdue','past due','right now',
    'deadline today','due today','eod today','by today','!!!',
    'action required immediately','time sensitive'
  ];
  const PRIORITY_HIGH = [
    'important','priority','deadline','due by','by end of day',
    'by eod','eod','by tomorrow','needed today','by close of business',
    'cob','follow up required','requires your attention','please confirm by'
  ];
  const PRIORITY_LOW = [
    'fyi','for your information','whenever','no rush','low priority',
    'at your convenience','when you get a chance','no urgency',
    'just a heads up','just wanted to share','heads up'
  ];

  const COMPLETION_PHRASES = [
    'has been done','has been completed','have completed','is done',
    'is completed','is resolved','has been resolved','issue resolved',
    'fixed','closed','task done','task completed','all done',
    'finished','completed successfully','done and dusted','please close',
    'can be closed','marked as resolved','no further action required',
    'this has been taken care of','already done','already taken care'
  ];

  const ACTION_PATTERNS = [
    /(?:please|kindly|could you|can you|would you)\s+([^.!?\n]{10,150})/gi,
    /(?:action(?:\s+required)?|action item|to-?do|task)[\s:]+([^\n.!?]{10,150})/gi,
    /(?:need(?:s)? to|must|should|have to|has to)\s+([^.!?\n]{10,150})/gi,
    /(?:^\s*[\d]+[.)]\s+|^\s*[-•*]\s+)([A-Z][^.\n]{10,150})/gm,
    /(?:deadline|due date|due by|expected by)[:\s]+([^\n.!?]{5,80})/gi,
    /(?:please ensure|please make sure|please confirm)\s+([^.!?\n]{10,150})/gi
  ];

  const RESPONSIBLE_PATTERNS = [
    /(?:please\s+(?:ask|contact|reach out to|get\s+in\s+touch\s+with))\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /(?:assigned to|responsibility of|owned by|handled by|taking care of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
    /(?:point of contact|poc)[\s:]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:will|is going to|shall)\s+(?:handle|take care of|look into|follow up)/g
  ];

  const DUE_DATE_PATTERNS = [
    /(?:due|deadline|by|before)\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:,?\s+\w+\s+\d+)?)/gi,
    /(?:due|deadline|by|before)\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/gi,
    /(?:due|deadline|by|before)\s+((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?)/gi,
    /(?:by|before)\s+(EOD|COB|end of (?:day|week|month))/gi
  ];

  function extractClientName(email) {
    // 1. Extract from sender domain (non-personal)
    const fromMatch = email.from.match(/<?\s*([^@<>\s]+@([^@<>\s,>]+))\s*>?/);
    if (fromMatch) {
      const domain = fromMatch[2].toLowerCase().replace(/[>]/g, '');
      if (!GENERIC_DOMAINS.has(domain)) {
        const parts = domain.split('.');
        // e.g. mail.acmecorp.com → AcmeCorp
        const company = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        return toTitleCase(company);
      }
    }

    // 2. Subject prefix patterns: [Company], "Company -", "Re: Company:"
    const subjectPatterns = [
      /^\[([A-Za-z][A-Za-z0-9 &.'-]{1,40})\]/,
      /^([A-Z][A-Za-z0-9 &.'-]{2,30})\s*[-:|]/,
      /(?:from|re|regarding)\s+([A-Z][A-Za-z0-9 &.'-]{2,30})\s*[-:|]/i,
      /\(([A-Z][A-Za-z0-9 &.'-]{2,30})\)/
    ];
    for (const p of subjectPatterns) {
      const m = email.subject.replace(/^(Re:|Fwd?:|FW:|AW:)\s*/gi, '').match(p);
      if (m) return toTitleCase(m[1].trim());
    }

    // 3. Display name from From field
    const nameMatch = email.from.match(/^"?([^"<,@\n]{2,40})"?\s*</);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (name && name.length > 1 && !/^(no.reply|noreply|donotreply)/i.test(name)) {
        return toTitleCase(name);
      }
    }

    // 4. Use clean subject as fallback client placeholder
    const subj = email.subject.replace(/^(Re:|Fwd?:|FW:|AW:)\s*/gi, '').trim();
    if (subj) return subj.substring(0, 30);

    return 'General';
  }

  function detectPriority(email) {
    const content = `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();
    for (const kw of PRIORITY_URGENT) if (content.includes(kw)) return 'urgent';
    for (const kw of PRIORITY_HIGH) if (content.includes(kw)) return 'high';
    for (const kw of PRIORITY_LOW) if (content.includes(kw)) return 'low';
    return 'medium';
  }

  function isCompleted(email) {
    const content = `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();
    return COMPLETION_PHRASES.some(p => content.includes(p));
  }

  function extractActionItems(email) {
    const text = removeQuotedText(email.body || email.snippet);
    const items = new Set();

    for (const pattern of ACTION_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const item = m[1].trim().replace(/\s+/g, ' ');
        if (item.length > 8 && item.length < 200) {
          items.add(capitalise(item));
        }
        if (items.size >= 8) break;
      }
    }

    // Fallback: use subject as single action item
    if (items.size === 0) {
      const clean = email.subject.replace(/^(Re:|Fwd?:|FW:|AW:)\s*/gi, '').trim();
      if (clean) items.add(capitalise(clean));
    }

    return [...items].slice(0, 6);
  }

  function extractResponsible(email) {
    const text = `${email.subject} ${removeQuotedText(email.body || '')}`;
    for (const p of RESPONSIBLE_PATTERNS) {
      p.lastIndex = 0;
      const m = p.exec(text);
      if (m) return m[1].trim();
    }
    // Fallback: sender name
    const nameM = email.from.match(/^"?([^"<,@]{2,40})"?\s*</);
    return nameM ? toTitleCase(nameM[1].trim()) : '';
  }

  function extractDueDate(email) {
    const text = `${email.subject} ${email.body}`;
    for (const p of DUE_DATE_PATTERNS) {
      p.lastIndex = 0;
      const m = p.exec(text);
      if (m) return m[0].trim();
    }
    return null;
  }

  function generateTitle(email) {
    // Strip Re/Fwd prefixes
    const clean = email.subject.replace(/^(Re:|Fwd?:|FW:|AW:)\s*/gi, '').trim();
    return clean || 'Email task';
  }

  function generateSummary(email) {
    const body = removeQuotedText(email.body || email.snippet || '');
    const sentences = body
      .replace(/\n{2,}/g, '\n')
      .split(/[.!?]\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 300);

    if (sentences.length === 0) return email.snippet || '';
    // Return first 3 meaningful sentences
    return sentences.slice(0, 3).join('. ') + '.';
  }

  function removeQuotedText(text) {
    return text
      .replace(/^>.*$/gm, '')
      .replace(/^On .{10,120}wrote:\s*$/gm, '')
      .replace(/^-{3,}.*$/gm, '')
      .replace(/^_{3,}.*$/gm, '')
      .replace(/^From:\s.+(\nSent:.+)?(\nTo:.+)?(\nSubject:.+)?/gim, '')
      .replace(/\[cid:[^\]]+\]/g, '')
      .replace(/\s{3,}/g, ' ')
      .trim();
  }

  /* Build a chronological thread summary from multiple emails */
  function buildThreadSummary(emails) {
    const sorted = [...emails].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sorted.length === 0) return '';

    const parts = sorted.map(e => {
      const name = extractDisplayName(e.from);
      const date = formatDate(e.date);
      const body = removeQuotedText(e.body || e.snippet || '');
      const preview = body.substring(0, 400).trim();
      return `[${date}] ${name}: ${preview}`;
    });

    return parts.join('\n\n---\n\n');
  }

  function extractDisplayName(from) {
    const m = from.match(/^"?([^"<,@\n]+)"?\s*</);
    if (m) return m[1].trim();
    const emailM = from.match(/<([^>]+)>/);
    return emailM ? emailM[1] : from.split('@')[0];
  }

  function toTitleCase(str) {
    return str.replace(/\b\w/g, c => c.toUpperCase()).trim();
  }

  function capitalise(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function formatDate(isoStr) {
    try {
      return new Date(isoStr).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch { return isoStr; }
  }

  function parse(email) {
    return {
      clientName: extractClientName(email),
      priority: detectPriority(email),
      isCompleted: isCompleted(email),
      taskTitle: generateTitle(email),
      taskDescription: generateSummary(email),
      actionItems: extractActionItems(email),
      responsiblePerson: extractResponsible(email),
      dueDate: extractDueDate(email),
      summary: generateSummary(email)
    };
  }

  return { parse, buildThreadSummary, extractDisplayName, removeQuotedText };
})();
