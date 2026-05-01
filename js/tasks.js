/* Task business logic — creates, updates and organises tasks from emails */
const TaskManager = (() => {
  const CLIENT_COLORS = [
    '#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316',
    '#f59e0b','#10b981','#06b6d4','#3b82f6','#a855f7',
    '#14b8a6','#84cc16','#f43f5e','#0ea5e9','#d946ef'
  ];

  const PRIORITY_ORDER = { urgent: 4, high: 3, medium: 2, low: 1 };

  /* ---------- Client helpers ---------- */

  async function findOrCreateClient(name, emailFrom) {
    if (!name || name === 'General') name = 'General';

    // Normalise: trim, title-case
    name = name.replace(/\s+/g, ' ').trim();

    // Try to find existing client by name (case-insensitive)
    const all = await db.getAll('clients');
    const existing = all.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;

    // Derive domain from email address
    const domainM = emailFrom?.match(/@([^@<>\s]+)/);
    const domain = domainM ? domainM[1].toLowerCase() : '';

    // Pick next colour from palette
    const colorIdx = all.length % CLIENT_COLORS.length;
    const client = {
      id: generateId(),
      name,
      domain,
      color: CLIENT_COLORS[colorIdx],
      order: all.length,
      createdAt: new Date().toISOString()
    };
    await db.put('clients', client);
    return client;
  }

  /* ---------- Email processing ---------- */

  async function processEmail(emailData) {
    // Skip if already stored and processed
    const existing = await db.get('emails', emailData.id);
    if (existing?.processed) return { isNew: false, task: null };

    // Save raw email (always keep, never delete)
    await db.put('emails', { ...emailData, processed: false });

    const parsed = EmailParser.parse(emailData);
    const client = await findOrCreateClient(parsed.clientName, emailData.from);

    // Look for existing task on the same thread
    const existingTasks = await db.getAllByIndex('tasks', 'threadId', emailData.threadId);

    if (existingTasks.length > 0) {
      // Update the most recently modified task in this thread
      const task = existingTasks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];

      // Escalate priority but never de-escalate automatically
      if (PRIORITY_ORDER[parsed.priority] > PRIORITY_ORDER[task.priority]) {
        task.priority = parsed.priority;
      }

      // Auto-complete
      if (parsed.isCompleted && task.status !== 'completed') {
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
      }

      // Merge action items
      const merged = new Set([...(task.actionables || []), ...parsed.actionItems]);
      task.actionables = [...merged].slice(0, 10);
      task.emailIds = [...new Set([...(task.emailIds || []), emailData.id])];
      task.updatedAt = new Date().toISOString();

      // Rebuild thread summary with all stored emails
      const threadEmails = await db.getEmailsByThread(emailData.threadId);
      task.emailThreadSummary = EmailParser.buildThreadSummary(threadEmails);

      if (!task.responsiblePerson && parsed.responsiblePerson) {
        task.responsiblePerson = parsed.responsiblePerson;
      }

      await db.put('tasks', task);
      await db.put('emails', { ...emailData, processed: true });
      return { isNew: false, task };
    }

    // Create new task
    const task = {
      id: generateId(),
      clientId: client.id,
      threadId: emailData.threadId,
      subject: emailData.subject,
      title: parsed.taskTitle,
      description: parsed.taskDescription,
      priority: parsed.priority,
      status: parsed.isCompleted ? 'completed' : 'pending',
      assigneeId: null,
      emailIds: [emailData.id],
      emailThreadSummary: parsed.summary,
      actionables: parsed.actionItems,
      responsiblePerson: parsed.responsiblePerson,
      dueDate: parsed.dueDate,
      createdAt: emailData.date || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: parsed.isCompleted ? new Date().toISOString() : null,
      fromEmail: emailData.from,
      tags: []
    };

    await db.put('tasks', task);
    await db.put('emails', { ...emailData, processed: true });
    return { isNew: true, task };
  }

  /* ---------- Manual task CRUD ---------- */

  async function createTask(data) {
    const task = {
      id: generateId(),
      clientId: data.clientId,
      threadId: null,
      subject: data.title,
      title: data.title,
      description: data.description || '',
      priority: data.priority || 'medium',
      status: 'pending',
      assigneeId: data.assigneeId || null,
      emailIds: [],
      emailThreadSummary: '',
      actionables: data.actionables || [],
      responsiblePerson: data.responsiblePerson || '',
      dueDate: data.dueDate || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      fromEmail: '',
      tags: data.tags || [],
      manuallyCreated: true
    };
    await db.put('tasks', task);
    return task;
  }

  async function updateTask(id, changes) {
    const task = await db.get('tasks', id);
    if (!task) throw new Error('Task not found');
    Object.assign(task, changes, { updatedAt: new Date().toISOString() });
    if (changes.status === 'completed' && !task.completedAt) {
      task.completedAt = new Date().toISOString();
    }
    if (changes.status && changes.status !== 'completed') {
      task.completedAt = null;
    }
    await db.put('tasks', task);
    return task;
  }

  async function toggleComplete(id) {
    const task = await db.get('tasks', id);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    return updateTask(id, {
      status: newStatus,
      completedAt: newStatus === 'completed' ? new Date().toISOString() : null
    });
  }

  /* ---------- Client management ---------- */

  async function reorderClient(clientId, direction) {
    const clients = (await db.getAll('clients')).sort((a, b) => a.order - b.order);
    const idx = clients.findIndex(c => c.id === clientId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= clients.length) return;

    const tmp = clients[idx].order;
    clients[idx].order = clients[swapIdx].order;
    clients[swapIdx].order = tmp;

    await Promise.all([
      db.put('clients', clients[idx]),
      db.put('clients', clients[swapIdx])
    ]);
  }

  async function updateClient(id, changes) {
    const client = await db.get('clients', id);
    if (!client) return;
    Object.assign(client, changes);
    await db.put('clients', client);
    return client;
  }

  /* ---------- Employee management ---------- */

  async function addEmployee(name, email, department) {
    // Check for duplicate
    const all = await db.getAll('employees');
    if (all.find(e => e.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('Employee with this email already exists');
    }
    const emp = { id: generateId(), name, email, department: department || '', createdAt: new Date().toISOString() };
    await db.put('employees', emp);
    return emp;
  }

  async function getEmployeeMap() {
    const employees = await db.getAll('employees');
    return Object.fromEntries(employees.map(e => [e.id, e]));
  }

  async function getClientMap() {
    const clients = await db.getAll('clients');
    return Object.fromEntries(clients.map(c => [c.id, c]));
  }

  return {
    processEmail,
    createTask,
    updateTask,
    toggleComplete,
    findOrCreateClient,
    reorderClient,
    updateClient,
    addEmployee,
    getEmployeeMap,
    getClientMap
  };
})();
