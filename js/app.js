/* ============================================================
   Sabhya's Daily Tracker — Main Application
   ============================================================ */

const App = (() => {

  /* ── State ─────────────────────────────────────────────── */
  let state = {
    db:      null,   // full tasks.json object
    sha:     null,   // current GitHub blob SHA
    saving:  false,
    filters: {
      search:   "",
      priority: "all",
      status:   "pending",
      assignee: "all",
      client:   "all",
    },
    clientOrder: [],  // array of client IDs in display order
  };

  /* ── Helpers ──────────────────────────────────────────── */
  function genId() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  }

  function isoNow() { return new Date().toISOString(); }

  function fmtDate(iso) {
    if (!iso) return "–";
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) +
           " " + d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" });
  }

  function esc(str = "") {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  function toast(msg, type = "info", dur = 2800) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = `show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), dur);
  }

  /* ── Recalculate stats ──────────────────────────────────── */
  function recalcStats() {
    let total=0, pending=0, completed=0, urgent=0, medium=0, low=0;
    for (const c of Object.values(state.db.clients)) {
      for (const t of c.tasks) {
        total++;
        if (t.status === "completed") completed++; else pending++;
        if (t.priority === "urgent") urgent++;
        else if (t.priority === "medium") medium++;
        else low++;
      }
    }
    state.db.stats = { total, pending, completed, urgent, medium, low };
  }

  /* ── Persist (write to GitHub) ──────────────────────────── */
  async function persist(msg) {
    if (state.saving) return;
    state.saving = true;
    setSyncStatus("syncing", "Saving…");
    try {
      recalcStats();
      state.db.lastUpdated = isoNow();
      state.sha = await ghAPI.writeTasks(state.db, state.sha, msg || "chore: update via dashboard");
      setSyncStatus("ok", "Saved");
    } catch (e) {
      console.error(e);
      toast("⚠ Save failed: " + e.message, "error");
      setSyncStatus("error", "Save error");
    } finally {
      state.saving = false;
    }
  }

  /* ── Load data ──────────────────────────────────────────── */
  async function loadData() {
    setSyncStatus("syncing", "Loading…");
    try {
      const { data, sha } = await ghAPI.readTasks();
      state.db  = data;
      state.sha = sha;
      // Ensure arrays/objects exist
      if (!state.db.clients)   state.db.clients   = {};
      if (!state.db.employees) state.db.employees = [];
      if (!state.db.stats)     state.db.stats     = {};
      // Build client order from stored order field
      state.clientOrder = Object.values(state.db.clients)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(c => c.id);
      setSyncStatus("ok", state.db.lastEmailCheck
        ? "Synced " + fmtDate(state.db.lastEmailCheck)
        : "No email sync yet");
      render();
    } catch (e) {
      console.error(e);
      setSyncStatus("error", "Load error");
      toast("⚠ Could not load tasks: " + e.message, "error");
    }
  }

  function setSyncStatus(state_str, text) {
    const dot  = document.getElementById("sync-dot");
    const span = document.getElementById("sync-text");
    dot.className  = "sync-dot " + state_str;
    span.textContent = text;
  }

  /* ── Filter helpers ─────────────────────────────────────── */
  function taskMatchesFilters(task) {
    const f = state.filters;
    if (f.priority !== "all" && task.priority !== f.priority) return false;
    if (f.status   !== "all" && task.status   !== f.status)   return false;
    if (f.assignee !== "all" && task.assignee  !== f.assignee) return false;
    if (f.client   !== "all" && task.clientId  !== f.client)   return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (
        !task.title.toLowerCase().includes(q) &&
        !(task.description || "").toLowerCase().includes(q) &&
        !(task.assignee     || "").toLowerCase().includes(q) &&
        !(task.emailThreadSubject || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  }

  function getVisibleClients() {
    if (!state.db) return [];
    return state.clientOrder
      .map(id => state.db.clients[id])
      .filter(Boolean)
      .filter(client => {
        if (state.filters.client !== "all" && client.id !== state.filters.client) return false;
        return true;
      });
  }

  /* ── Render ─────────────────────────────────────────────── */
  function render() {
    renderStats();
    renderFilterDropdowns();
    renderClients();
    renderCompleted();
  }

  function renderStats() {
    const s = state.db?.stats || {};
    document.getElementById("stat-total").textContent     = s.total     || 0;
    document.getElementById("stat-urgent").textContent    = s.urgent    || 0;
    document.getElementById("stat-medium").textContent    = s.medium    || 0;
    document.getElementById("stat-low").textContent       = s.low       || 0;
    document.getElementById("stat-pending").textContent   = s.pending   || 0;
    document.getElementById("stat-completed").textContent = s.completed || 0;
  }

  function renderFilterDropdowns() {
    const assigneeEl = document.getElementById("filter-assignee");
    const clientEl   = document.getElementById("filter-client");
    const assignees  = state.db?.employees || [];
    const clients    = Object.values(state.db?.clients || {});

    const curA = assigneeEl.value;
    const curC = clientEl.value;

    assigneeEl.innerHTML = `<option value="all">All Employees</option>` +
      assignees.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
    if (curA) assigneeEl.value = curA;

    clientEl.innerHTML = `<option value="all">All Clients</option>` +
      clients.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if (curC) clientEl.value = curC;

    // Form selects
    const formClientEl   = document.getElementById("form-client");
    const formAssigneeEl = document.getElementById("form-assignee");
    const fcCur = formClientEl.value;
    const faCur = formAssigneeEl.value;
    formClientEl.innerHTML =
      `<option value="">Select client</option>` +
      clients.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("") +
      `<option value="__new__">+ New client…</option>`;
    formClientEl.value = fcCur;
    formAssigneeEl.innerHTML =
      `<option value="">Unassigned</option>` +
      assignees.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("") +
      `<option value="__new__">+ New employee…</option>`;
    formAssigneeEl.value = faCur;
  }

  /* ── Client Tabs ─────────────────────────────────────────── */
  function renderClients() {
    const section   = document.getElementById("clients-section");
    const emptyEl   = document.getElementById("empty-state");
    const clients   = getVisibleClients();

    // Collect pending tasks grouped by client
    const clientsWithPending = clients.map(c => ({
      ...c,
      pendingTasks: c.tasks.filter(t => t.status === "pending" && taskMatchesFilters(t)),
    })).filter(c => c.pendingTasks.length > 0 || state.filters.status !== "pending");

    if (clientsWithPending.length === 0) {
      emptyEl.classList.remove("hidden");
      section.innerHTML = "";
      section.appendChild(emptyEl);
      return;
    }
    emptyEl.classList.add("hidden");

    section.innerHTML = clientsWithPending.map(c => renderClientCard(c)).join("");
    section.querySelectorAll(".client-card").forEach(attachClientCardEvents);
    section.querySelectorAll(".task-item").forEach(attachTaskItemEvents);
    attachDragDrop();
  }

  function renderClientCard(client) {
    const pending = client.tasks.filter(t => t.status === "pending" && taskMatchesFilters(t));
    if (pending.length === 0 && state.filters.status === "pending") return "";

    const byPriority = { urgent: [], medium: [], low: [] };
    pending.forEach(t => byPriority[t.priority || "medium"].push(t));

    const groups = ["urgent","medium","low"]
      .filter(p => byPriority[p].length > 0)
      .map(p => `
        <div class="priority-group">
          <span class="priority-label ${p}">${p}</span>
          ${byPriority[p].map(t => renderTaskRow(t)).join("")}
        </div>`).join("");

    return `
      <div class="client-card" data-client-id="${esc(client.id)}" draggable="true">
        <div class="client-header">
          <span class="client-drag-handle" title="Drag to reorder">⣿</span>
          <span class="client-name">${esc(client.name)}</span>
          <span class="client-task-count">${pending.length} pending</span>
          <span class="client-chevron">▾</span>
        </div>
        <div class="client-body">${groups}</div>
      </div>`;
  }

  function renderTaskRow(task) {
    const checked = task.status === "completed";
    return `
      <div class="task-item priority-${esc(task.priority)} status-${esc(task.status)}"
           data-task-id="${esc(task.id)}" data-client-id="${esc(task.clientId)}">
        <div class="task-row">
          <div class="task-checkbox ${checked ? "checked" : ""}"
               data-action="toggle" title="Mark complete"></div>
          <div class="task-title-wrap">
            <div class="task-title">${esc(task.title)}</div>
            <div class="task-meta">
              <span class="badge ${esc(task.priority)}">${esc(task.priority)}</span>
              ${task.assignee ? `<span class="task-assignee">👤 ${esc(task.assignee)}</span>` : ""}
              ${task.emailThreadId ? `<span class="badge" style="color:var(--text-muted);background:var(--surface-2)">📧 email</span>` : ""}
            </div>
          </div>
          <div class="task-actions">
            <button class="btn-icon" data-action="edit" title="Edit task">✎</button>
            <span class="task-expand-icon">▶</span>
          </div>
        </div>
        <div class="task-body">
          ${renderTaskBody(task)}
        </div>
      </div>`;
  }

  function renderTaskBody(task) {
    const actionables = (task.actionables || [])
      .map(a => `<div class="task-actionable">${esc(a)}</div>`).join("");

    const msgs = (task.emailMessages || [])
      .map((m, i) => `
        <div class="thread-msg" data-msg-idx="${i}">
          <div class="thread-msg-header">
            <span class="thread-msg-from">${esc(m.from || "Unknown")}</span>
            <span class="thread-msg-date">${esc(m.date || "")}</span>
          </div>
          <div class="thread-msg-body">${esc((m.body || "").substring(0, 2000))}</div>
        </div>`).join("");

    return `
      ${task.emailSummary ? `
        <div>
          <div class="task-section-label">Email Thread Summary</div>
          <div class="task-summary">${esc(task.emailSummary)}</div>
        </div>` : ""}
      ${actionables ? `
        <div>
          <div class="task-section-label">Actionables</div>
          <div class="task-actionables">${actionables}</div>
        </div>` : ""}
      ${task.responsiblePerson ? `
        <div>
          <div class="task-section-label">Responsible</div>
          <div class="task-responsible">👤 ${esc(task.responsiblePerson)}</div>
        </div>` : ""}
      <div class="task-edit-row">
        <label>Priority:</label>
        <select data-action="set-priority">
          <option value="urgent" ${task.priority==="urgent"?"selected":""}>Urgent</option>
          <option value="medium" ${task.priority==="medium"?"selected":""}>Medium</option>
          <option value="low"    ${task.priority==="low"   ?"selected":""}>Low</option>
        </select>
        <label>Assign:</label>
        <select data-action="set-assignee">
          <option value="">Unassigned</option>
          ${(state.db?.employees||[]).map(e =>
            `<option value="${esc(e)}" ${task.assignee===e?"selected":""}>${esc(e)}</option>`).join("")}
          <option value="__new__">+ New…</option>
        </select>
        <label>Updated:</label>
        <span class="text-muted">${fmtDate(task.updatedAt)}</span>
      </div>
      ${msgs ? `
        <div>
          <div class="task-section-label">Email Thread (${(task.emailMessages||[]).length} messages)</div>
          <button class="thread-toggle-btn" data-action="toggle-thread">
            ▶ Show messages
          </button>
          <div class="thread-messages hidden">${msgs}</div>
        </div>` : ""}`;
  }

  /* ── Completed section ───────────────────────────────────── */
  function renderCompleted() {
    const list  = document.getElementById("completed-list");
    const count = document.getElementById("completed-count");
    const all   = Object.values(state.db?.clients || {}).flatMap(c =>
      c.tasks.filter(t => t.status === "completed" && taskMatchesFilters(t)));
    count.textContent = all.length;
    list.innerHTML = all.length === 0
      ? "<p style='padding:.75rem;color:var(--text-dim);font-size:.85rem'>No completed tasks.</p>"
      : all.map(t => renderTaskRow(t)).join("");
    list.querySelectorAll(".task-item").forEach(attachTaskItemEvents);
  }

  /* ── Attach events to DOM nodes ──────────────────────────── */
  function attachClientCardEvents(card) {
    card.querySelector(".client-header").addEventListener("click", e => {
      if (e.target.closest("[data-action]")) return;
      card.classList.toggle("collapsed");
    });
  }

  function attachTaskItemEvents(item) {
    const id       = item.dataset.taskId;
    const clientId = item.dataset.clientId;

    // Row click → expand/collapse body
    item.querySelector(".task-row").addEventListener("click", e => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "toggle") { toggleTaskComplete(id, clientId); return; }
      if (action === "edit")   { openEditTask(id, clientId); return; }
      item.classList.toggle("expanded");
    });

    // Priority select
    const priorityEl = item.querySelector("[data-action='set-priority']");
    if (priorityEl) {
      priorityEl.addEventListener("change", e => {
        e.stopPropagation();
        setTaskPriority(id, clientId, e.target.value);
      });
    }

    // Assignee select
    const assigneeEl = item.querySelector("[data-action='set-assignee']");
    if (assigneeEl) {
      assigneeEl.addEventListener("change", e => {
        e.stopPropagation();
        const val = e.target.value;
        if (val === "__new__") {
          const name = prompt("New employee name:");
          if (name && name.trim()) {
            addEmployee(name.trim());
            setTaskAssignee(id, clientId, name.trim());
          } else { e.target.value = ""; }
        } else {
          setTaskAssignee(id, clientId, val || null);
        }
      });
    }

    // Thread toggle button
    const threadBtn = item.querySelector("[data-action='toggle-thread']");
    if (threadBtn) {
      threadBtn.addEventListener("click", e => {
        e.stopPropagation();
        const msgs = item.querySelector(".thread-messages");
        const open = msgs.classList.toggle("hidden");
        threadBtn.textContent = open ? "▶ Show messages" : "▼ Hide messages";
      });
    }

    // Individual thread message headers
    item.querySelectorAll(".thread-msg-header").forEach(hdr => {
      hdr.addEventListener("click", e => {
        e.stopPropagation();
        hdr.parentElement.classList.toggle("open");
      });
    });
  }

  function attachDragDrop() {
    const cards = document.querySelectorAll(".client-card");
    let dragged = null;
    cards.forEach(card => {
      card.addEventListener("dragstart", () => {
        dragged = card;
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        dragged = null;
      });
      card.addEventListener("dragover", e => {
        e.preventDefault();
        if (dragged && dragged !== card) card.classList.add("drag-over");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", e => {
        e.preventDefault();
        card.classList.remove("drag-over");
        if (!dragged || dragged === card) return;
        const section = document.getElementById("clients-section");
        const nodes   = [...section.querySelectorAll(".client-card")];
        const fromIdx = nodes.indexOf(dragged);
        const toIdx   = nodes.indexOf(card);
        if (fromIdx < toIdx) card.after(dragged); else card.before(dragged);
        // Persist new order
        const newOrder = [...section.querySelectorAll(".client-card")].map(c => c.dataset.clientId);
        newOrder.forEach((cid, i) => { if (state.db.clients[cid]) state.db.clients[cid].order = i; });
        state.clientOrder = newOrder;
        persist("chore: reorder clients");
      });
    });
  }

  /* ── Task operations ─────────────────────────────────────── */
  function findTask(taskId, clientId) {
    const client = state.db.clients[clientId];
    if (!client) return null;
    return client.tasks.find(t => t.id === taskId) || null;
  }

  function toggleTaskComplete(taskId, clientId) {
    const task = findTask(taskId, clientId);
    if (!task) return;
    if (task.status === "pending") {
      task.status      = "completed";
      task.completedAt = isoNow();
      toast("Task marked complete ✅", "success");
    } else {
      task.status      = "pending";
      task.completedAt = null;
      toast("Task moved back to pending", "info");
    }
    task.updatedAt = isoNow();
    persist("chore: toggle task " + taskId);
    render();
  }

  function setTaskPriority(taskId, clientId, priority) {
    const task = findTask(taskId, clientId);
    if (!task) return;
    task.priority  = priority;
    task.updatedAt = isoNow();
    persist("chore: set priority on task " + taskId);
    render();
  }

  function setTaskAssignee(taskId, clientId, name) {
    const task = findTask(taskId, clientId);
    if (!task) return;
    task.assignee  = name;
    task.updatedAt = isoNow();
    persist("chore: assign task " + taskId);
    render();
  }

  function addEmployee(name) {
    if (!state.db.employees.includes(name)) {
      state.db.employees.push(name);
    }
  }

  /* ── Add / Edit Task modal ───────────────────────────────── */
  function openAddTask() {
    document.getElementById("form-modal-title").textContent = "Add Task";
    document.getElementById("form-task-id").value = "";
    document.getElementById("form-title").value       = "";
    document.getElementById("form-description").value  = "";
    document.getElementById("form-priority").value     = "medium";
    document.getElementById("form-client").value       = "";
    document.getElementById("form-client-new").value   = "";
    document.getElementById("form-client-new").classList.add("hidden");
    document.getElementById("form-assignee").value     = "";
    document.getElementById("form-assignee-new").value = "";
    document.getElementById("form-assignee-new").classList.add("hidden");
    renderFilterDropdowns();
    openModal("form-modal");
  }

  function openEditTask(taskId, clientId) {
    const task = findTask(taskId, clientId);
    if (!task) return;
    document.getElementById("form-modal-title").textContent = "Edit Task";
    document.getElementById("form-task-id").value           = taskId;
    document.getElementById("form-title").value             = task.title;
    document.getElementById("form-description").value       = task.description || "";
    document.getElementById("form-priority").value          = task.priority;
    document.getElementById("form-client").value            = clientId;
    document.getElementById("form-client-new").classList.add("hidden");
    document.getElementById("form-assignee").value          = task.assignee || "";
    document.getElementById("form-assignee-new").classList.add("hidden");
    renderFilterDropdowns();
    // Ensure the selects have the right value after re-render
    setTimeout(() => {
      document.getElementById("form-client").value   = clientId;
      document.getElementById("form-assignee").value = task.assignee || "";
    }, 0);
    openModal("form-modal");
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const taskId      = document.getElementById("form-task-id").value.trim();
    const title       = document.getElementById("form-title").value.trim();
    const description = document.getElementById("form-description").value.trim();
    const priority    = document.getElementById("form-priority").value;

    let clientId  = document.getElementById("form-client").value;
    let newClient = document.getElementById("form-client-new").value.trim();
    let assignee  = document.getElementById("form-assignee").value;
    let newAssign = document.getElementById("form-assignee-new").value.trim();

    if (!title) { toast("Title is required", "error"); return; }

    // Handle new client
    if (clientId === "__new__" || (clientId === "" && newClient)) {
      const name = newClient || prompt("New client name:");
      if (!name || !name.trim()) { toast("Client name required", "error"); return; }
      const id = genId();
      state.db.clients[id] = { id, name: name.trim(), order: Object.keys(state.db.clients).length, tasks: [] };
      state.clientOrder.push(id);
      clientId = id;
    }
    if (!clientId) { toast("Please select or enter a client", "error"); return; }

    // Handle new assignee
    if (assignee === "__new__" || (assignee === "" && newAssign)) {
      const name = newAssign || prompt("New employee name:");
      if (name && name.trim()) { addEmployee(name.trim()); assignee = name.trim(); }
      else assignee = null;
    }
    if (!assignee) assignee = null;

    const now = isoNow();

    if (taskId) {
      // Edit existing
      const task = findTask(taskId, state.db.clients[clientId]
        ? clientId
        : Object.values(state.db.clients).find(c => c.tasks.find(t => t.id === taskId))?.id);
      if (task) {
        task.title       = title;
        task.description = description;
        task.priority    = priority;
        task.assignee    = assignee;
        task.updatedAt   = now;
      }
    } else {
      // Create new
      const newTask = {
        id: genId(),
        clientId,
        title, description, priority,
        status:    "pending",
        assignee,
        createdAt: now, updatedAt: now, completedAt: null,
        emailThreadId: null, emailThreadSubject: "", emailParticipants: [],
        emailSummary: "", actionables: [], responsiblePerson: "", emailMessages: [],
      };
      state.db.clients[clientId].tasks.push(newTask);
    }

    closeModal("form-modal");
    persist(taskId ? "chore: update task" : "chore: add task");
    render();
    toast(taskId ? "Task updated ✓" : "Task added ✓", "success");
  }

  /* ── Modals ───────────────────────────────────────────────── */
  function openModal(id)  { document.getElementById(id).classList.remove("hidden"); }
  function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

  function openSettings() {
    const token = localStorage.getItem(CONFIG.LS_GITHUB_TOKEN) || "";
    document.getElementById("settings-token").value = token ? "•".repeat(16) : "";
    document.getElementById("settings-last-sync").textContent =
      state.db?.lastEmailCheck ? fmtDate(state.db.lastEmailCheck) : "Never";
    openModal("settings-modal");
  }

  /* ── Init ───────────────────────────────────────────────────── */
  function init() {
    // Token setup overlay
    const hasToken   = !!localStorage.getItem(CONFIG.LS_GITHUB_TOKEN);
    const isOffline  = localStorage.getItem(CONFIG.LS_OFFLINE) === "true";

    if (!hasToken && !isOffline) {
      const setupOverlay   = document.getElementById("setup-overlay");
      const authOverlay    = document.getElementById("auth-overlay");
      setupOverlay.classList.remove("hidden");
      authOverlay.classList.add("hidden");

      document.getElementById("setup-continue-btn").addEventListener("click", () => {
        const token = document.getElementById("setup-token").value.trim();
        if (!token) { alert("Please enter your GitHub PAT."); return; }
        localStorage.setItem(CONFIG.LS_GITHUB_TOKEN, token);
        setupOverlay.classList.add("hidden");
        startAuth();
      });

      document.getElementById("setup-offline-btn").addEventListener("click", e => {
        e.preventDefault();
        localStorage.setItem(CONFIG.LS_OFFLINE, "true");
        setupOverlay.classList.add("hidden");
        startAuth();
      });
      return;
    }
    startAuth();
  }

  function startAuth() {
    window._authUI = new AuthUI(onAuthenticated);
    window._authUI.start();
  }

  function onAuthenticated() {
    document.getElementById("app").classList.remove("hidden");
    loadData();
    // Auto-refresh
    setInterval(loadData, CONFIG.REFRESH_MS);
  }

  /* ── Wire up static UI events ────────────────────────────── */
  function wireStaticEvents() {
    // Search
    document.getElementById("search-input").addEventListener("input", e => {
      state.filters.search = e.target.value;
      render();
    });

    // Filter selects
    ["filter-priority","filter-status","filter-assignee","filter-client"].forEach(id => {
      document.getElementById(id).addEventListener("change", e => {
        state.filters[id.replace("filter-","").replace("-","_")] = e.target.value;
        render();
      });
    });
    // Fix filter key mapping
    document.getElementById("filter-priority").addEventListener("change", e => {
      state.filters.priority = e.target.value; render();
    });
    document.getElementById("filter-status").addEventListener("change", e => {
      state.filters.status   = e.target.value; render();
    });
    document.getElementById("filter-assignee").addEventListener("change", e => {
      state.filters.assignee = e.target.value; render();
    });
    document.getElementById("filter-client").addEventListener("change", e => {
      state.filters.client   = e.target.value; render();
    });

    // Add task
    document.getElementById("add-task-btn").addEventListener("click", openAddTask);

    // Refresh
    document.getElementById("refresh-btn").addEventListener("click", loadData);

    // Settings
    document.getElementById("settings-btn").addEventListener("click", openSettings);

    // Form submit
    document.getElementById("task-form").addEventListener("submit", handleFormSubmit);

    // Form client / assignee new-item reveal
    document.getElementById("form-client").addEventListener("change", e => {
      const newField = document.getElementById("form-client-new");
      newField.classList.toggle("hidden", e.target.value !== "__new__");
    });
    document.getElementById("form-assignee").addEventListener("change", e => {
      const newField = document.getElementById("form-assignee-new");
      newField.classList.toggle("hidden", e.target.value !== "__new__");
    });

    // Completed toggle
    document.getElementById("completed-toggle").addEventListener("click", () => {
      const sec  = document.querySelector(".completed-section");
      const list = document.getElementById("completed-list");
      sec.classList.toggle("open");
      list.classList.toggle("collapsed");
    });

    // Settings save token
    document.getElementById("settings-token-save").addEventListener("click", () => {
      const val = document.getElementById("settings-token").value.trim();
      if (val && !val.includes("•")) {
        localStorage.setItem(CONFIG.LS_GITHUB_TOKEN, val);
        localStorage.removeItem(CONFIG.LS_OFFLINE);
        toast("Token saved — reloading…", "success");
        setTimeout(() => location.reload(), 1000);
      }
    });

    // Settings reset pattern
    document.getElementById("reset-pattern-btn").addEventListener("click", () => {
      closeModal("settings-modal");
      window._authUI.resetPattern();
    });
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    wireStaticEvents();
    init();
  });

  // Expose helpers needed by inline onclick attributes in modals
  return { closeModal, openModal };

})();
