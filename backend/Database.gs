/**
 * Database.gs — Google Sheets as the persistent database.
 *
 * Sheet tabs:
 *   Tasks        — all tasks (pending + completed, never deleted)
 *   Clients      — client list + display order
 *   Employees    — employee list
 *   EmailThreads — email thread tracking (prevents duplicate task creation)
 *   Config       — key/value configuration store
 */

const DB = (() => {

  // ── sheet names ──────────────────────────────────────────────
  const SHEETS = {
    tasks:    'Tasks',
    clients:  'Clients',
    employees:'Employees',
    threads:  'EmailThreads',
    config:   'Config',
  };

  // ── column indices (0-based) ──────────────────────────────────
  const TASK_COLS = {
    id:0, clientId:1, clientName:2, title:3, description:4,
    priority:5, status:6, assignedTo:7, emailThreadId:8,
    emailSummary:9, threadSummary:10, actionables:11,
    nextStepPerson:12, createdAt:13, updatedAt:14, completedAt:15,
  };

  const CLIENT_COLS    = { id:0, name:1, order:2, lastUpdated:3 };
  const EMPLOYEE_COLS  = { id:0, name:1, addedAt:2 };
  const THREAD_COLS    = { threadId:0, clientId:1, taskId:2, subject:3, lastProcessed:4, messageCount:5 };
  const CONFIG_COLS    = { key:0, value:1 };

  // ── helpers ───────────────────────────────────────────────────
  function _ss() {
    const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }

  function _sheet(name) {
    const ss = _ss();
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      _addHeaders(sh, name);
    }
    return sh;
  }

  function _addHeaders(sh, name) {
    const headers = {
      [SHEETS.tasks]:     ['id','clientId','clientName','title','description','priority','status','assignedTo','emailThreadId','emailSummary','threadSummary','actionables','nextStepPerson','createdAt','updatedAt','completedAt'],
      [SHEETS.clients]:   ['id','name','order','lastUpdated'],
      [SHEETS.employees]: ['id','name','addedAt'],
      [SHEETS.threads]:   ['threadId','clientId','taskId','subject','lastProcessed','messageCount'],
      [SHEETS.config]:    ['key','value'],
    };
    if (headers[name]) {
      sh.appendRow(headers[name]);
      sh.getRange(1, 1, 1, headers[name].length).setFontWeight('bold').setBackground('#1A1A38');
      sh.setFrozenRows(1);
    }
  }

  function _rows(sh) {
    const data = sh.getDataRange().getValues();
    if (data.length <= 1) return [];
    return data.slice(1);   // skip header
  }

  function _rowToTask(row) {
    const actionables = row[TASK_COLS.actionables];
    return {
      id:             row[TASK_COLS.id],
      clientId:       row[TASK_COLS.clientId],
      clientName:     row[TASK_COLS.clientName],
      title:          row[TASK_COLS.title],
      description:    row[TASK_COLS.description],
      priority:       row[TASK_COLS.priority] || 'medium',
      status:         row[TASK_COLS.status]   || 'pending',
      assignedTo:     row[TASK_COLS.assignedTo],
      emailThreadId:  row[TASK_COLS.emailThreadId],
      emailSummary:   row[TASK_COLS.emailSummary],
      threadSummary:  row[TASK_COLS.threadSummary],
      actionables:    actionables ? String(actionables).split('|||').filter(Boolean) : [],
      nextStepPerson: row[TASK_COLS.nextStepPerson],
      createdAt:      row[TASK_COLS.createdAt]  ? new Date(row[TASK_COLS.createdAt]).toISOString()  : '',
      updatedAt:      row[TASK_COLS.updatedAt]  ? new Date(row[TASK_COLS.updatedAt]).toISOString()  : '',
      completedAt:    row[TASK_COLS.completedAt]? new Date(row[TASK_COLS.completedAt]).toISOString(): '',
    };
  }

  function _taskToRow(t) {
    return [
      t.id, t.clientId, t.clientName, t.title, t.description,
      t.priority, t.status, t.assignedTo || '', t.emailThreadId || '',
      t.emailSummary || '', t.threadSummary || '',
      (t.actionables || []).join('|||'),
      t.nextStepPerson || '',
      t.createdAt || new Date().toISOString(),
      t.updatedAt || new Date().toISOString(),
      t.completedAt || '',
    ];
  }

  function _uid(prefix) {
    return prefix + '_' + Utilities.getUuid().replace(/-/g,'').slice(0,12);
  }

  function _findRowNum(sh, colIdx, value) {
    // Returns 1-based row number (2+ since row 1 is header), or -1
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][colIdx]) === String(value)) return i + 1;
    }
    return -1;
  }

  // ── init ──────────────────────────────────────────────────────
  function init() {
    Object.values(SHEETS).forEach(name => _sheet(name));
    // Seed config if empty
    const sh = _sheet(SHEETS.config);
    if (sh.getLastRow() <= 1) {
      sh.appendRow(['lastProcessedTime', '']);
      sh.appendRow(['isFirstRun', 'true']);
    }
  }

  // ── config ────────────────────────────────────────────────────
  function getConfig(key) {
    const rows = _rows(_sheet(SHEETS.config));
    const row  = rows.find(r => r[CONFIG_COLS.key] === key);
    return row ? String(row[CONFIG_COLS.value]) : null;
  }

  function setConfig(key, value) {
    const sh  = _sheet(SHEETS.config);
    const row = _findRowNum(sh, CONFIG_COLS.key, key);
    if (row > 0) {
      sh.getRange(row, CONFIG_COLS.value + 1).setValue(value);
    } else {
      sh.appendRow([key, value]);
    }
  }

  // ── tasks ─────────────────────────────────────────────────────
  function getTasks(filters) {
    const rows  = _rows(_sheet(SHEETS.tasks));
    let tasks = rows.filter(r => r[TASK_COLS.id]).map(_rowToTask);

    if (filters) {
      if (filters.status   && filters.status   !== 'all') tasks = tasks.filter(t => t.status   === filters.status);
      if (filters.priority && filters.priority !== 'all') tasks = tasks.filter(t => t.priority === filters.priority);
      if (filters.clientId)                               tasks = tasks.filter(t => t.clientId === filters.clientId);
    }
    return tasks;
  }

  function createTask(data) {
    const sh  = _sheet(SHEETS.tasks);
    const now = new Date().toISOString();
    const task = {
      id:             _uid('task'),
      clientId:       data.clientId || _uid('client'),
      clientName:     data.clientName || 'Uncategorised',
      title:          data.title || 'Untitled',
      description:    data.description || '',
      priority:       data.priority || 'medium',
      status:         data.status || 'pending',
      assignedTo:     data.assignedTo || '',
      emailThreadId:  data.emailThreadId || '',
      emailSummary:   data.emailSummary || '',
      threadSummary:  data.threadSummary || '',
      actionables:    data.actionables || [],
      nextStepPerson: data.nextStepPerson || '',
      createdAt:      data.createdAt || now,
      updatedAt:      data.updatedAt || now,
      completedAt:    data.completedAt || '',
    };

    // Ensure client exists
    _ensureClient(task.clientId, task.clientName);

    sh.appendRow(_taskToRow(task));
    return { task };
  }

  function updateTask(id, updates) {
    const sh  = _sheet(SHEETS.tasks);
    const row = _findRowNum(sh, TASK_COLS.id, id);
    if (row < 0) return { error: 'Task not found' };

    const existing = _rowToTask(sh.getRange(row, 1, 1, Object.keys(TASK_COLS).length).getValues()[0]);
    const merged   = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    sh.getRange(row, 1, 1, Object.keys(TASK_COLS).length).setValues([_taskToRow(merged)]);
    return { task: merged };
  }

  function deleteTask(id) {
    const sh  = _sheet(SHEETS.tasks);
    const row = _findRowNum(sh, TASK_COLS.id, id);
    if (row < 0) return { error: 'Task not found' };
    sh.deleteRow(row);
    return { ok: true };
  }

  // ── clients ───────────────────────────────────────────────────
  function getClients() {
    return _rows(_sheet(SHEETS.clients))
      .filter(r => r[CLIENT_COLS.id])
      .map(r => ({
        id:          r[CLIENT_COLS.id],
        name:        r[CLIENT_COLS.name],
        order:       Number(r[CLIENT_COLS.order]) || 0,
        lastUpdated: r[CLIENT_COLS.lastUpdated] ? new Date(r[CLIENT_COLS.lastUpdated]).toISOString() : '',
      }))
      .sort((a, b) => a.order - b.order);
  }

  function _ensureClient(clientId, clientName) {
    const sh  = _sheet(SHEETS.clients);
    const row = _findRowNum(sh, CLIENT_COLS.id, clientId);
    if (row < 0) {
      const order = sh.getLastRow();   // place at end
      sh.appendRow([clientId, clientName, order, new Date().toISOString()]);
    } else {
      sh.getRange(row, CLIENT_COLS.lastUpdated + 1).setValue(new Date().toISOString());
    }
  }

  function reorderClients(orderedIds) {
    const sh = _sheet(SHEETS.clients);
    if (!Array.isArray(orderedIds)) return { error: 'orderedIds must be an array' };
    orderedIds.forEach((id, idx) => {
      const row = _findRowNum(sh, CLIENT_COLS.id, id);
      if (row > 0) sh.getRange(row, CLIENT_COLS.order + 1).setValue(idx);
    });
    return { ok: true };
  }

  // ── employees ─────────────────────────────────────────────────
  function getEmployees() {
    return _rows(_sheet(SHEETS.employees))
      .filter(r => r[EMPLOYEE_COLS.id])
      .map(r => ({
        id:      r[EMPLOYEE_COLS.id],
        name:    r[EMPLOYEE_COLS.name],
        addedAt: r[EMPLOYEE_COLS.addedAt] ? new Date(r[EMPLOYEE_COLS.addedAt]).toISOString() : '',
      }));
  }

  function addEmployee(name) {
    if (!name) return { error: 'Name required' };
    const emp = { id: _uid('emp'), name, addedAt: new Date().toISOString() };
    _sheet(SHEETS.employees).appendRow([emp.id, emp.name, emp.addedAt]);
    return { employee: emp };
  }

  function removeEmployee(id) {
    const sh  = _sheet(SHEETS.employees);
    const row = _findRowNum(sh, EMPLOYEE_COLS.id, id);
    if (row > 0) sh.deleteRow(row);
    return { ok: true };
  }

  // ── email threads ─────────────────────────────────────────────
  function getThread(threadId) {
    const sh  = _sheet(SHEETS.threads);
    const row = _findRowNum(sh, THREAD_COLS.threadId, threadId);
    if (row < 0) return null;
    const r = sh.getRange(row, 1, 1, Object.keys(THREAD_COLS).length).getValues()[0];
    return { threadId: r[0], clientId: r[1], taskId: r[2], subject: r[3], lastProcessed: r[4], messageCount: r[5] };
  }

  function upsertThread(data) {
    const sh  = _sheet(SHEETS.threads);
    const row = _findRowNum(sh, THREAD_COLS.threadId, data.threadId);
    const values = [data.threadId, data.clientId, data.taskId, data.subject, new Date().toISOString(), data.messageCount || 0];
    if (row < 0) sh.appendRow(values);
    else sh.getRange(row, 1, 1, values.length).setValues([values]);
  }

  // ── stats ─────────────────────────────────────────────────────
  function getStats() {
    const tasks   = getTasks();
    const pending = tasks.filter(t => t.status !== 'completed');
    const done    = tasks.filter(t => t.status === 'completed');
    return {
      total:   tasks.length,
      pending: pending.length,
      done:    done.length,
      urgent:  pending.filter(t => t.priority === 'urgent').length,
      medium:  pending.filter(t => t.priority === 'medium').length,
      low:     pending.filter(t => t.priority === 'low').length,
    };
  }

  // ── getAll (used by dashboard on load) ───────────────────────
  function getAll() {
    return {
      tasks:     getTasks(),
      clients:   getClients(),
      employees: getEmployees(),
      stats:     getStats(),
    };
  }

  // ── public API ────────────────────────────────────────────────
  return {
    init, getConfig, setConfig,
    getTasks, createTask, updateTask, deleteTask,
    getClients, reorderClients,
    getEmployees, addEmployee, removeEmployee,
    getThread, upsertThread,
    getStats, getAll,
    _ensureClient,
  };

})();
