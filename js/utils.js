// Date + format helpers

export function todayISO() {
  const d = new Date();
  return localDateISO(d);
}

export function localDateISO(d) {
  // YYYY-MM-DD in local timezone
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

export function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateISO(d);
}

export function prettyDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = todayISO();
  if (iso === today) return 'Today';
  const y = isoOffset(-1);
  if (iso === y) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function inferMealSlot(d = new Date()) {
  const h = d.getHours();
  if (h >= 6 && h < 10) return 'breakfast';
  if (h >= 10 && h < 12) return 'mid_morning';
  if (h >= 12 && h < 15) return 'lunch';
  if (h >= 15 && h < 18) return 'evening_snack';
  if (h >= 18 && h < 22) return 'dinner';
  return 'other';
}

export const SLOT_LABEL = {
  breakfast: 'Breakfast',
  mid_morning: 'Mid-morning',
  lunch: 'Lunch',
  evening_snack: 'Evening',
  dinner: 'Dinner',
  other: 'Other'
};

export function fmtKcal(n) {
  if (n == null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString();
}

export function fmtKg(n) {
  if (n == null || isNaN(n)) return '–';
  return (+n).toFixed(1);
}

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== false && v != null) {
      e.setAttribute(k, v);
    }
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      e.appendChild(document.createTextNode(String(c)));
    } else {
      e.appendChild(c);
    }
  }
  return e;
}

export function toast(msg, duration = 2200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const t = el('div', { class: 'toast' }, msg);
  root.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

let modalEl = null;
export function modal(content, onClose) {
  closeModal();
  const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => {
    if (e.target === backdrop) closeModal();
  }});
  const m = el('div', { class: 'modal' });
  m.appendChild(content);
  backdrop.appendChild(m);
  document.getElementById('modal-root').appendChild(backdrop);
  modalEl = backdrop;
  modalEl._onClose = onClose;
  return { close: closeModal };
}
export function closeModal() {
  if (modalEl) {
    const cb = modalEl._onClose;
    modalEl.remove();
    modalEl = null;
    if (cb) try { cb(); } catch {}
  }
}

export function confirmDialog(message, { title = 'Are you sure?', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = el('div', {}, [
      el('div', { class: 'modal-header' }, [
        el('div', { class: 'modal-title' }, title),
        el('button', { class: 'modal-close', onClick: () => { closeModal(); resolve(false); } }, '×')
      ]),
      el('div', { class: 'text-sm muted mb-2' }, message),
      el('div', { class: 'row mt-2' }, [
        el('button', { class: 'btn btn-block', onClick: () => { closeModal(); resolve(false); } }, 'Cancel'),
        el('button', { class: `btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}`,
          onClick: () => { closeModal(); resolve(true); } }, confirmText)
      ])
    ]);
    modal(body);
  });
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export function pickFile(accept = 'application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files && input.files[0] || null);
    input.click();
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

export function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
