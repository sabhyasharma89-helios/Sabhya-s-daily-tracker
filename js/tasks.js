/* ═══════════════════════════════════════
   TASKS  –  CRUD + business logic
═══════════════════════════════════════ */
const Tasks = (() => {

  /* ── Clients ─────────────────────────────────────── */
  const CLIENT_COLORS = ['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'];

  async function getOrCreateClient(name) {
    const trimmed = (name || 'Unknown').trim();
    const all     = await DB.getAll('clients');
    const existing = all.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const id    = `cl_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const color = CLIENT_COLORS[all.length % CLIENT_COLORS.length];
    const client = { id, name: trimmed, color, position: all.length, createdAt: new Date().toISOString() };
    await DB.put('clients', client);
    return client;
  }

  async function getAllClients() {
    const all = await DB.getAll('clients');
    return all.sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  async function updateClientPosition(id, position) {
    const c = await DB.get('clients', id);
    if (c) await DB.put('clients', { ...c, position });
  }

  /* ── Task helpers ────────────────────────────────── */
  function _slug(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  }

  /* ── Create / Update from AI result ─────────────── */
  async function upsertFromEmail(threadId, aiData, threadMessages) {
    if (!aiData) return null;

    const client    = await getOrCreateClient(aiData.clientName || 'Unclassified');
    const existing  = await findTaskByThread(threadId);

    if (existing) {
      const updated = {
        ...existing,
        description:  aiData.description   || existing.description,
        priority:     aiData.priority       || existing.priority,
        actionables:  aiData.actionables    || existing.actionables,
        responsible:  aiData.responsible    || existing.responsible,
        summary:      aiData.summary        || existing.summary,
        status:       aiData.isCompleted    ? 'completed' : existing.status,
        dueDate:      aiData.dueDate        || existing.dueDate,
        updatedAt:    new Date().toISOString(),
        threadIds:    [...new Set([...(existing.threadIds || []), threadId])]
      };
      await DB.put('tasks', updated);
      return updated;
    }

    const task = {
      clientId:    client.id,
      clientName:  client.name,
      title:       (aiData.taskTitle || 'Untitled Task').slice(0, 80),
      description: aiData.description  || '',
      priority:    aiData.priority     || 'medium',
      status:      aiData.isCompleted  ? 'completed' : 'pending',
      assignee:    '',
      dueDate:     aiData.dueDate      || null,
      actionables: aiData.actionables  || [],
      responsible: aiData.responsible  || '',
      summary:     aiData.summary      || '',
      threadIds:   [threadId],
      source:      'email',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString()
    };
    const id = await DB.put('tasks', task);
    return { ...task, id };
  }

  async function findTaskByThread(threadId) {
    const all = await DB.getAll('tasks');
    return all.find(t => t.threadIds && t.threadIds.includes(threadId)) || null;
  }

  /* ── Manual CRUD ─────────────────────────────────── */
  async function createTask(data) {
    const client = await getOrCreateClient(data.clientName || 'Unclassified');
    const task   = {
      clientId:    client.id,
      clientName:  client.name,
      title:       (data.title || 'Untitled').slice(0, 80),
      description: data.description  || '',
      priority:    data.priority     || 'medium',
      status:      'pending',
      assignee:    data.assignee     || '',
      dueDate:     data.dueDate      || null,
      actionables: data.actionables  || [],
      responsible: '',
      summary:     '',
      threadIds:   [],
      source:      'manual',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString()
    };
    const id = await DB.put('tasks', task);
    return { ...task, id };
  }

  async function updateTask(id, changes) {
    const task = await DB.get('tasks', id);
    if (!task) return null;

    if (changes.clientName && changes.clientName !== task.clientName) {
      const client     = await getOrCreateClient(changes.clientName);
      changes.clientId = client.id;
    }

    const updated = { ...task, ...changes, updatedAt: new Date().toISOString() };
    await DB.put('tasks', updated);
    return updated;
  }

  async function setStatus(id, status) {
    return updateTask(id, { status });
  }

  async function setPriority(id, priority) {
    return updateTask(id, { priority });
  }

  async function setAssignee(id, assignee) {
    return updateTask(id, { assignee });
  }

  async function getAllTasks(filters = {}) {
    let tasks = await DB.getAll('tasks');

    if (filters.status    && filters.status    !== 'all') tasks = tasks.filter(t => t.status   === filters.status);
    if (filters.priority  && filters.priority  !== 'all') tasks = tasks.filter(t => t.priority === filters.priority);
    if (filters.assignee  && filters.assignee  !== 'all') tasks = tasks.filter(t => t.assignee === filters.assignee);
    if (filters.clientId  && filters.clientId  !== 'all') tasks = tasks.filter(t => t.clientId === filters.clientId);

    if (filters.query) {
      const q = filters.query.toLowerCase();
      tasks = tasks.filter(t =>
        (t.title       || '').toLowerCase().includes(q) ||
        (t.clientName  || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.assignee    || '').toLowerCase().includes(q)
      );
    }

    return tasks;
  }

  async function getStats() {
    const tasks    = await DB.getAll('tasks');
    const pending  = tasks.filter(t => t.status === 'pending');
    return {
      total:     tasks.length,
      pending:   pending.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      urgent:    pending.filter(t => t.priority === 'urgent').length,
      medium:    pending.filter(t => t.priority === 'medium').length,
      low:       pending.filter(t => t.priority === 'low').length
    };
  }

  async function getUniqueAssignees() {
    const tasks = await DB.getAll('tasks');
    const set   = new Set(tasks.map(t => t.assignee).filter(Boolean));
    return [...set].sort();
  }

  return {
    getOrCreateClient, getAllClients, updateClientPosition,
    upsertFromEmail, findTaskByThread,
    createTask, updateTask, setStatus, setPriority, setAssignee,
    getAllTasks, getStats, getUniqueAssignees
  };
})();
