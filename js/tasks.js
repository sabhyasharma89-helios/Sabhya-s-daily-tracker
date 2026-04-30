/* ════════════════════════════════════════════════════
   tasks.js — task CRUD modal logic
════════════════════════════════════════════════════ */

const Tasks = (() => {

  /* ── open add-task modal ── */
  function openAdd(prefillClient) {
    _resetForm();
    document.getElementById('task-modal-title').textContent = 'Add Task';
    document.getElementById('task-edit-id').value = '';
    if (prefillClient) document.getElementById('task-client').value = prefillClient;
    _refreshDataLists();
    openModal('task-modal-backdrop');
  }

  /* ── open edit-task modal ── */
  function openEdit(taskId) {
    const task   = DB.findTask(taskId);
    const client = DB.findClientOfTask(taskId);
    if (!task || !client) return;

    _resetForm();
    document.getElementById('task-modal-title').textContent  = 'Edit Task';
    document.getElementById('task-edit-id').value            = taskId;
    document.getElementById('task-client').value             = client.name;
    document.getElementById('task-title-inp').value          = task.title;
    document.getElementById('task-desc').value               = task.description || '';
    document.getElementById('task-priority-sel').value       = task.priority;
    document.getElementById('task-assignee-inp').value       = task.assignedTo  || '';

    _refreshDataLists();
    openModal('task-modal-backdrop');
  }

  /* ── save (add or edit) ── */
  async function save() {
    const editId    = document.getElementById('task-edit-id').value.trim();
    const client    = document.getElementById('task-client').value.trim();
    const title     = document.getElementById('task-title-inp').value.trim();
    const desc      = document.getElementById('task-desc').value.trim();
    const priority  = document.getElementById('task-priority-sel').value;
    const assignee  = document.getElementById('task-assignee-inp').value.trim();

    if (!client || !title) {
      toast('Client and title are required', 'error');
      return;
    }

    if (editId) {
      DB.updateTask(editId, { title, description: desc, priority, assignedTo: assignee || null });
      /* move to new client if changed */
      const oldClient = DB.findClientOfTask(editId);
      if (oldClient && oldClient.name.toLowerCase() !== client.toLowerCase()) {
        const task = DB.findTask(editId);
        oldClient.tasks = oldClient.tasks.filter(t => t.id !== editId);
        const newClient = DB.ensureClient(client);
        task.clientId = newClient.id;
        newClient.tasks.push(task);
      }
      toast('Task updated');
    } else {
      DB.addTask({ clientName: client, title, description: desc, priority, assignedTo: assignee || null });
      toast('Task added');
    }

    closeModal('task-modal-backdrop');
    await _saveAndRefresh();
  }

  /* ── delete (called from detail modal) ── */
  async function remove(taskId) {
    if (!confirm('Delete this task permanently?')) return;
    DB.deleteTask(taskId);
    closeModal('detail-modal-backdrop');
    toast('Task deleted');
    await _saveAndRefresh();
  }

  /* ── complete / uncomplete ── */
  async function toggleComplete(taskId) {
    const task = DB.findTask(taskId);
    if (!task) return;
    const willComplete = task.status !== 'completed';

    if (willComplete) {
      DB.completeTask(taskId);
      DB.patchLocal(taskId, { status: 'completed', completedAt: new Date().toISOString() });
      toast('Task marked complete ✓', 'success');
    } else {
      DB.uncompleteTask(taskId);
      DB.patchLocal(taskId, { status: 'pending', completedAt: null });
      toast('Task moved back to pending');
    }

    /* update detail modal button if open */
    const btn = document.getElementById('detail-toggle-complete-btn');
    if (btn) btn.textContent = willComplete ? 'Mark Pending' : 'Mark Complete';

    await _saveAndRefresh();
  }

  /* ── inline priority change ── */
  async function changePriority(taskId, newPriority) {
    DB.updateTask(taskId, { priority: newPriority });
    DB.patchLocal(taskId, { priority: newPriority });
    toast(`Priority set to ${newPriority}`);
    await _saveAndRefresh();
  }

  /* ── private ── */
  function _resetForm() {
    ['task-client','task-title-inp','task-desc','task-assignee-inp'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('task-priority-sel').value = 'medium';
  }

  function _refreshDataLists() {
    /* client datalist */
    const cDl = document.getElementById('client-datalist');
    cDl.innerHTML = '';
    const data = DB.get();
    if (data) {
      Object.values(data.clients).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        cDl.appendChild(opt);
      });
    }

    /* employee datalist */
    const eDl = document.getElementById('employee-datalist');
    eDl.innerHTML = '';
    DB.getEmployees().forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      eDl.appendChild(opt);
    });
  }

  async function _saveAndRefresh() {
    const ok = await DB.save();
    if (!ok && localStorage.getItem(CFG.LS.GITHUB_PAT)) {
      toast('Saved locally (GitHub sync failed)', 'error');
    }
    Dashboard.render();
  }

  return { openAdd, openEdit, save, remove, toggleComplete, changePriority };
})();
