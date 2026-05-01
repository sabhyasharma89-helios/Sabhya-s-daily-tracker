/* ═══════════════════════════════════════════════════════════
   DATABASE MODULE — Firebase Firestore
   Collections:
     tasks/{taskId}
     clients/{clientId}
     employees/{employeeId}
     config/settings  (lastEmailRead, etc.)
═══════════════════════════════════════════════════════════ */

const DB = (() => {
  let db, F;

  function ready() {
    if (window._firebase) {
      db = window._firebase.db;
      F  = window._firebase;
      return true;
    }
    return false;
  }

  // ── TASKS ──────────────────────────────────────────────────

  async function getTasks(filters = {}) {
    if (!ready()) return [];
    const col = F.collection(db, 'tasks');
    const snap = await F.getDocs(col);
    let tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (filters.clientId && filters.clientId !== 'all') {
      tasks = tasks.filter(t => t.clientId === filters.clientId);
    }
    if (filters.status) {
      tasks = tasks.filter(t => t.status === filters.status);
    }
    if (filters.priority) {
      tasks = tasks.filter(t => t.priority === filters.priority);
    }
    if (filters.assignedTo) {
      tasks = tasks.filter(t => t.assignedTo === filters.assignedTo);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      tasks = tasks.filter(t =>
        t.title?.toLowerCase().includes(q)  ||
        t.clientName?.toLowerCase().includes(q) ||
        t.summary?.toLowerCase().includes(q)
      );
    }

    // Sort: urgent first, then by updatedAt desc
    const priorityOrder = { urgent: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => {
      const pd = (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
      if (pd !== 0) return pd;
      const ta = a.updatedAt?.seconds || 0;
      const tb = b.updatedAt?.seconds || 0;
      return tb - ta;
    });

    return tasks;
  }

  async function createTask(data) {
    if (!ready()) return null;
    const id   = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const ref  = F.doc(db, 'tasks', id);
    const task = {
      id,
      title:        data.title        || 'Untitled Task',
      clientName:   data.clientName   || 'Unknown Client',
      clientId:     data.clientId     || slugify(data.clientName || 'unknown'),
      summary:      data.summary      || '',
      actionables:  data.actionables  || [],
      responsible:  data.responsible  || '',
      threadSummary: data.threadSummary || '',
      emailThreadId: data.emailThreadId || null,
      priority:     data.priority     || 'medium',
      status:       data.status       || 'pending',
      assignedTo:   data.assignedTo   || '',
      source:       data.source       || 'manual',
      createdAt:    F.serverTimestamp(),
      updatedAt:    F.serverTimestamp(),
    };
    await F.setDoc(ref, task);
    return task;
  }

  async function updateTask(taskId, updates) {
    if (!ready()) return;
    const ref = F.doc(db, 'tasks', taskId);
    await F.updateDoc(ref, { ...updates, updatedAt: F.serverTimestamp() });
  }

  async function deleteTask(taskId) {
    if (!ready()) return;
    await F.deleteDoc(F.doc(db, 'tasks', taskId));
  }

  // Real-time listener
  function subscribeToTasks(callback) {
    if (!ready()) return () => {};
    const col = F.collection(db, 'tasks');
    return F.onSnapshot(col, snap => {
      const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(tasks);
    });
  }

  // ── CLIENTS ────────────────────────────────────────────────

  async function getClients() {
    if (!ready()) return [];
    const snap = await F.getDocs(F.collection(db, 'clients'));
    const clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    clients.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    return clients;
  }

  async function upsertClient(name, color) {
    if (!ready()) return;
    const id  = slugify(name);
    const ref = F.doc(db, 'clients', id);
    const existing = await F.getDoc(ref);
    if (!existing.exists()) {
      const allClients = await getClients();
      await F.setDoc(ref, {
        id, name,
        color: color || randomColor(),
        order: allClients.length,
        createdAt: F.serverTimestamp(),
      });
    }
    return id;
  }

  async function updateClientOrder(clientIds) {
    if (!ready()) return;
    const promises = clientIds.map((id, i) =>
      F.updateDoc(F.doc(db, 'clients', id), { order: i })
    );
    await Promise.all(promises);
  }

  async function deleteClient(clientId) {
    if (!ready()) return;
    await F.deleteDoc(F.doc(db, 'clients', clientId));
  }

  function subscribeToClients(callback) {
    if (!ready()) return () => {};
    return F.onSnapshot(F.collection(db, 'clients'), snap => {
      const clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      clients.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      callback(clients);
    });
  }

  // ── EMPLOYEES ──────────────────────────────────────────────

  async function getEmployees() {
    if (!ready()) return [];
    const snap = await F.getDocs(F.collection(db, 'employees'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function addEmployee(name, email) {
    if (!ready()) return;
    const id  = 'emp_' + Date.now();
    const ref = F.doc(db, 'employees', id);
    await F.setDoc(ref, { id, name, email: email || '', createdAt: F.serverTimestamp() });
    return id;
  }

  async function deleteEmployee(empId) {
    if (!ready()) return;
    await F.deleteDoc(F.doc(db, 'employees', empId));
  }

  function subscribeToEmployees(callback) {
    if (!ready()) return () => {};
    return F.onSnapshot(F.collection(db, 'employees'), snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  // ── CONFIG ─────────────────────────────────────────────────

  async function getConfig() {
    if (!ready()) return {};
    const ref  = F.doc(db, 'config', 'settings');
    const snap = await F.getDoc(ref);
    return snap.exists() ? snap.data() : {};
  }

  async function setConfig(updates) {
    if (!ready()) return;
    const ref = F.doc(db, 'config', 'settings');
    await F.setDoc(ref, updates, { merge: true });
  }

  // ── HELPERS ────────────────────────────────────────────────

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function randomColor() {
    const colors = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#84cc16'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // ── STATS ──────────────────────────────────────────────────

  function computeStats(tasks) {
    const pending   = tasks.filter(t => t.status === 'pending');
    const completed = tasks.filter(t => t.status === 'completed');
    return {
      total:     tasks.length,
      urgent:    pending.filter(t => t.priority === 'urgent').length,
      medium:    pending.filter(t => t.priority === 'medium').length,
      low:       pending.filter(t => t.priority === 'low').length,
      pending:   pending.length,
      completed: completed.length,
    };
  }

  return {
    getTasks, createTask, updateTask, deleteTask, subscribeToTasks,
    getClients, upsertClient, updateClientOrder, deleteClient, subscribeToClients,
    getEmployees, addEmployee, deleteEmployee, subscribeToEmployees,
    getConfig, setConfig,
    computeStats, slugify,
  };
})();

window.DB = DB;
