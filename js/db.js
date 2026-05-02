/* ══════════════════════════════════════════════════════════════════
   db.js — IndexedDB Persistence Layer
   All task data is stored in IndexedDB so it survives refreshes and
   accumulates indefinitely. GitHub sync writes into here on load.
   ══════════════════════════════════════════════════════════════════ */

'use strict';

const DB = (() => {
  const NAME    = 'SabhyaDailyTracker';
  const VERSION = 2;

  const STORES = {
    tasks:     { keyPath: 'id' },
    clients:   { keyPath: 'id' },
    employees: { keyPath: 'id' },
    config:    { keyPath: 'key' },
    syncLog:   { keyPath: 'id', autoIncrement: true }
  };

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const [storeName, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, opts);
            if (storeName === 'tasks') {
              store.createIndex('clientId',  'clientId',  { unique: false });
              store.createIndex('status',    'status',    { unique: false });
              store.createIndex('priority',  'priority',  { unique: false });
              store.createIndex('assignedTo','assignedTo',{ unique: false });
            }
          }
        }
      };

      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  function _tx(storeName, mode = 'readonly') {
    return _db.transaction(storeName, mode).objectStore(storeName);
  }

  function _promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /* ── Generic CRUD ── */

  function getAll(storeName) {
    return open().then(() => _promisify(_tx(storeName).getAll()));
  }

  function getById(storeName, id) {
    return open().then(() => _promisify(_tx(storeName).get(id)));
  }

  function put(storeName, obj) {
    obj.updatedAt = obj.updatedAt || new Date().toISOString();
    return open().then(() => _promisify(_tx(storeName, 'readwrite').put(obj)));
  }

  function putMany(storeName, items) {
    return open().then(() => {
      return new Promise((resolve, reject) => {
        const tx = _db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        items.forEach(item => store.put(item));
        tx.oncomplete = resolve;
        tx.onerror    = () => reject(tx.error);
      });
    });
  }

  function remove(storeName, id) {
    return open().then(() => _promisify(_tx(storeName, 'readwrite').delete(id)));
  }

  function clearStore(storeName) {
    return open().then(() => _promisify(_tx(storeName, 'readwrite').clear()));
  }

  /* ── Config helpers ── */

  async function getConfig(key, defaultVal = null) {
    await open();
    const row = await _promisify(_tx('config').get(key));
    return row ? row.value : defaultVal;
  }

  async function setConfig(key, value) {
    await open();
    return _promisify(_tx('config', 'readwrite').put({ key, value }));
  }

  /* ── Task helpers ── */

  async function getAllTasks() { return getAll('tasks'); }

  async function getTask(id) { return getById('tasks', id); }

  async function saveTask(task) {
    if (!task.id) task.id = crypto.randomUUID();
    if (!task.createdAt) task.createdAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    await put('tasks', task);
    return task;
  }

  async function deleteTask(id) { return remove('tasks', id); }

  async function getTasksByClient(clientId) {
    await open();
    return _promisify(_tx('tasks').index('clientId').getAll(clientId));
  }

  /* ── Client helpers ── */

  async function getAllClients() { return getAll('clients'); }

  async function saveClient(client) {
    if (!client.id) client.id = crypto.randomUUID();
    await put('clients', client);
    return client;
  }

  async function deleteClient(id) { return remove('clients', id); }

  /* ── Employee helpers ── */

  async function getAllEmployees() { return getAll('employees'); }

  async function saveEmployee(emp) {
    if (!emp.id) emp.id = crypto.randomUUID();
    await put('employees', emp);
    return emp;
  }

  async function deleteEmployee(id) { return remove('employees', id); }

  /* ── Sync log ── */

  async function addSyncLog(entry) {
    entry.timestamp = new Date().toISOString();
    await open();
    return _promisify(_tx('syncLog', 'readwrite').add(entry));
  }

  /* ── Bulk sync from GitHub JSON ── */

  async function mergeFromGitHub(remoteData) {
    if (!remoteData || !remoteData.tasks) return;

    const remoteTasks    = remoteData.tasks    || [];
    const remoteClients  = remoteData.clients  || {};
    const remoteEmployees= remoteData.employees|| [];

    // Merge tasks: remote data wins for AI-generated fields;
    // local wins for user-modified fields (priority, assignedTo, status if user changed it)
    const localTasks = await getAllTasks();
    const localMap   = new Map(localTasks.map(t => [t.id, t]));

    for (const rt of remoteTasks) {
      const lt = localMap.get(rt.id);
      if (!lt) {
        // New task from remote
        await saveTask(rt);
      } else {
        // Merge: keep user's manual changes to priority/assignee/status
        // but update AI-generated fields like summary, actionables, emailThread
        const merged = {
          ...rt,
          priority:    lt._userPriority  ?? rt.priority,
          assignedTo:  lt._userAssignee  ?? rt.assignedTo,
          status:      lt._userStatus    ?? rt.status,
          _userPriority: lt._userPriority,
          _userAssignee: lt._userAssignee,
          _userStatus:   lt._userStatus,
        };
        await saveTask(merged);
      }
    }

    // Merge clients
    const clientArr = Object.values(remoteClients);
    for (const rc of clientArr) {
      await saveClient(rc);
    }

    // Merge employees
    const localEmps = await getAllEmployees();
    const localEmpNames = new Set(localEmps.map(e => e.name.toLowerCase()));
    for (const re of remoteEmployees) {
      if (!localEmpNames.has(re.name?.toLowerCase())) {
        await saveEmployee(re);
      }
    }

    await setConfig('lastGitHubSync', new Date().toISOString());
    await setConfig('initialized', true);
  }

  /* ── Export all data as JSON (for GitHub write-back) ── */

  async function exportAll() {
    const tasks     = await getAllTasks();
    const clients   = await getAllClients();
    const employees = await getAllEmployees();

    const clientMap = {};
    for (const c of clients) clientMap[c.id] = c;

    return {
      metadata: {
        version: '1.0.0',
        lastUpdated:    new Date().toISOString(),
        totalTasks:     tasks.length,
        pendingTasks:   tasks.filter(t => t.status !== 'completed').length,
        completedTasks: tasks.filter(t => t.status === 'completed').length,
      },
      clients:   clientMap,
      tasks,
      employees
    };
  }

  /* ── Full reset ── */

  async function resetAll() {
    for (const store of Object.keys(STORES)) {
      await clearStore(store);
    }
  }

  return {
    open, getConfig, setConfig,
    getAllTasks, getTask, saveTask, deleteTask, getTasksByClient,
    getAllClients, saveClient, deleteClient,
    getAllEmployees, saveEmployee, deleteEmployee,
    addSyncLog, mergeFromGitHub, exportAll, resetAll
  };
})();
