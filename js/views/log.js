import { el, todayISO, toast, modal, closeModal, confirmDialog, SLOT_LABEL, inferMealSlot } from '../utils.js';
import { getCtx, refresh } from '../state.js';
import * as DB from '../db.js';
import { openWeightModal } from './today.js';
import { kcalPerMin, estimateExerciseKcal } from '../engine/workout.js';

let activeSubtab = 'food';

export async function renderLog(root) {
  root.innerHTML = '';
  document.getElementById('topbar-sub').textContent = 'Log';

  const subs = el('div', { class: 'subtabs' });
  for (const key of ['food','water','exercise','weight']) {
    const b = el('button', { class: 'subtab' + (activeSubtab === key ? ' active' : ''),
      onClick: () => { activeSubtab = key; renderLog(root); } }, capitalize(key));
    subs.appendChild(b);
  }
  root.appendChild(subs);

  const list = el('div');
  root.appendChild(list);

  if (activeSubtab === 'food') await renderFoodList(list, root);
  else if (activeSubtab === 'water') await renderWaterList(list, root);
  else if (activeSubtab === 'exercise') await renderExerciseList(list, root);
  else if (activeSubtab === 'weight') await renderWeightList(list, root);

  // FAB
  removeFAB();
  const fab = el('button', { class: 'fab', id: 'fab-add', onClick: () => {
    if (activeSubtab === 'food') openFoodPicker(() => renderLog(root));
    else if (activeSubtab === 'water') openWaterPicker(() => renderLog(root));
    else if (activeSubtab === 'exercise') openExercisePicker(() => renderLog(root));
    else if (activeSubtab === 'weight') openWeightModal(root);
  }}, '+');
  document.getElementById('app').appendChild(fab);
}

function removeFAB() {
  const f = document.getElementById('fab-add');
  if (f) f.remove();
}

async function renderFoodList(parent, root) {
  const date = todayISO();
  const items = await DB.getFoodLog(date);
  if (!items.length) {
    parent.appendChild(emptyState('No food logged today', 'Tap + to add'));
    return;
  }
  items.sort((a,b) => (a.time || '').localeCompare(b.time || ''));
  // Group by meal slot
  const grouped = {};
  for (const it of items) {
    grouped[it.meal_slot || 'other'] = grouped[it.meal_slot || 'other'] || [];
    grouped[it.meal_slot || 'other'].push(it);
  }
  const order = ['breakfast','mid_morning','lunch','evening_snack','dinner','other'];
  for (const slot of order) {
    if (!grouped[slot]) continue;
    parent.appendChild(el('div', { class: 'card-title', style: 'margin-top:14px' }, SLOT_LABEL[slot]));
    for (const it of grouped[slot]) {
      parent.appendChild(makeFoodRow(it, root));
    }
  }
}

function makeFoodRow(it, root) {
  return el('div', { class: 'list-item' }, [
    el('div', { class: 'list-item-main' }, [
      el('div', { class: 'list-item-title' }, it.item_name),
      el('div', { class: 'list-item-sub' },
        `${it.serving_qty} ${it.serving_unit} · ${it.kcal} kcal · ${Math.round(it.protein_g||0)}P/${Math.round(it.carbs_g||0)}C/${Math.round(it.fat_g||0)}F · ${it.time || ''}`)
    ]),
    el('button', { class: 'icon-btn', onClick: async () => {
      const ok = await confirmDialog(`Remove ${it.item_name}?`, { title: 'Delete entry', confirmText: 'Delete', danger: true });
      if (ok) { await DB.deleteFoodLog(it.id); await refresh(); renderLog(root); }
    }}, '×')
  ]);
}

async function renderWaterList(parent, root) {
  const items = await DB.getWaterLog(todayISO());
  if (!items.length) { parent.appendChild(emptyState('No water logged today', 'Tap + to add a glass')); return; }
  items.sort((a,b) => (a.time || '').localeCompare(b.time || ''));
  for (const it of items) {
    parent.appendChild(el('div', { class: 'list-item' }, [
      el('div', { class: 'list-item-main' }, [
        el('div', { class: 'list-item-title' }, `${it.volume_ml} ml`),
        el('div', { class: 'list-item-sub' }, it.time || '')
      ]),
      el('button', { class: 'icon-btn', onClick: async () => {
        await DB.deleteWaterLog(it.id); await refresh(); renderLog(root);
      }}, '×')
    ]));
  }
}

async function renderExerciseList(parent, root) {
  const items = await DB.getExerciseLog(todayISO());
  if (!items.length) { parent.appendChild(emptyState('No exercise today', 'Tap + to log a workout')); return; }
  items.sort((a,b) => (a.time || '').localeCompare(b.time || ''));
  for (const it of items) {
    const sub = it.duration_min
      ? `${it.duration_min} min · ${it.kcal_burned} kcal · ${it.time || ''}`
      : `${it.sets}×${it.reps} · ${it.kcal_burned} kcal · ${it.time || ''}`;
    parent.appendChild(el('div', { class: 'list-item' }, [
      el('div', { class: 'list-item-main' }, [
        el('div', { class: 'list-item-title' }, it.exercise_name),
        el('div', { class: 'list-item-sub' }, sub)
      ]),
      el('button', { class: 'icon-btn', onClick: async () => {
        await DB.deleteExerciseLog(it.id); await refresh(); renderLog(root);
      }}, '×')
    ]));
  }
}

async function renderWeightList(parent, root) {
  const all = await DB.getAllWeights();
  if (!all.length) { parent.appendChild(emptyState('No weight entries yet', 'Tap + to log today\'s weight')); return; }
  const sorted = [...all].reverse();
  for (const w of sorted) {
    parent.appendChild(el('div', { class: 'list-item' }, [
      el('div', { class: 'list-item-main' }, [
        el('div', { class: 'list-item-title' }, `${w.weight_kg.toFixed(1)} kg`),
        el('div', { class: 'list-item-sub' },
          `BMI ${w.bmi} · ${w.date}${w.body_fat_pct ? ` · BF ${w.body_fat_pct}%` : ''}${w.notes ? ` · ${w.notes}` : ''}`)
      ]),
      el('button', { class: 'icon-btn', onClick: async () => {
        const ok = await confirmDialog(`Remove ${w.date} entry?`, { title: 'Delete', confirmText: 'Delete', danger: true });
        if (ok) { await DB.deleteWeight(w.date); await refresh(); renderLog(root); }
      }}, '×')
    ]));
  }
}

// ---------- Food picker modal ----------

export function openLogModal(refreshCb) {
  // Master add modal: choose food/water/exercise
  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, 'What to log?'),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    el('div', { class: 'col' }, [
      el('button', { class: 'btn btn-block', onClick: () => { closeModal(); openFoodPicker(refreshCb); } }, 'Food'),
      el('button', { class: 'btn btn-block', onClick: () => { closeModal(); openWaterPicker(refreshCb); } }, 'Water'),
      el('button', { class: 'btn btn-block', onClick: () => { closeModal(); openExercisePicker(refreshCb); } }, 'Exercise'),
      el('button', { class: 'btn btn-block', onClick: () => { closeModal(); openWeightModal({}); refreshCb && setTimeout(refreshCb, 200); } }, 'Weight')
    ])
  ]);
  modal(body);
}

export function openFoodPicker(refreshCb) {
  const search = el('input', { class: 'search-input', type: 'text', placeholder: 'Search 150+ foods…', autofocus: true });
  const results = el('div');
  const customBtn = el('button', { class: 'btn btn-block mt-2', onClick: () => {
    closeModal(); openCustomFoodModal(refreshCb);
  }}, '+ Add custom food');

  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, 'Add food'),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    search,
    results,
    customBtn
  ]);

  let lastResults = [];
  async function update() {
    const q = search.value.trim();
    const foods = await DB.searchFoods(q, 40);
    lastResults = foods;
    results.innerHTML = '';
    if (!foods.length) {
      results.appendChild(el('div', { class: 'text-sm muted mt-2' }, 'No matches. Try a custom entry.'));
      return;
    }
    for (const f of foods.slice(0, 20)) {
      results.appendChild(el('div', { class: 'food-result', onClick: () => {
        closeModal();
        openServingModal(f, refreshCb);
      }}, [
        el('div', {}, [
          el('div', { class: 'bold text-sm' }, f.name),
          el('div', { class: 'food-result-meta' },
            `${f.default_serving_qty} ${f.default_serving_unit} · ${Math.round(f.protein_g)}P/${Math.round(f.carbs_g)}C/${Math.round(f.fat_g)}F`)
        ]),
        el('div', { class: 'food-result-kcal' }, `${f.kcal_per_serving} kcal`)
      ]));
    }
  }

  search.addEventListener('input', update);
  modal(body);
  update();
}

function openServingModal(food, refreshCb) {
  const slot = inferMealSlot();
  const slotSel = el('select');
  for (const [k, v] of Object.entries(SLOT_LABEL)) {
    const opt = el('option', { value: k }, v);
    if (k === slot) opt.selected = true;
    slotSel.appendChild(opt);
  }
  const qty = el('input', { type: 'number', step: '0.25', min: '0.25', value: String(food.default_serving_qty), inputmode: 'decimal' });

  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, food.name),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    el('div', { class: 'text-sm muted mb-2' }, `Default: ${food.default_serving_qty} ${food.default_serving_unit} = ${food.kcal_per_serving} kcal`),
    el('div', { class: 'form-row' }, [
      el('label', { class: 'form-label' }, 'Servings'),
      qty
    ]),
    el('div', { class: 'form-row' }, [
      el('label', { class: 'form-label' }, 'Meal'),
      slotSel
    ]),
    el('button', { class: 'btn btn-primary btn-block', onClick: async () => {
      const q = parseFloat(qty.value) || 1;
      await DB.logFood({
        date: todayISO(),
        time: nowHHMM(),
        meal_slot: slotSel.value,
        item_name: food.name,
        serving_qty: q * food.default_serving_qty,
        serving_unit: food.default_serving_unit,
        kcal: Math.round(food.kcal_per_serving * q),
        protein_g: +(food.protein_g * q).toFixed(1),
        carbs_g: +(food.carbs_g * q).toFixed(1),
        fat_g: +(food.fat_g * q).toFixed(1),
        fiber_g: +(food.fiber_g * q).toFixed(1),
        source: 'db'
      });
      closeModal();
      toast('Logged');
      await refresh();
      refreshCb && refreshCb();
    }}, 'Save')
  ]);
  modal(body);
}

function openCustomFoodModal(refreshCb) {
  const name = el('input', { type: 'text', placeholder: 'e.g. Mom\'s biryani' });
  const qty = el('input', { type: 'number', step: '0.25', value: '1', inputmode: 'decimal' });
  const unit = el('input', { type: 'text', placeholder: 'katori / piece / g', value: 'katori' });
  const kcal = el('input', { type: 'number', step: '5', inputmode: 'numeric', placeholder: 'kcal' });
  const protein = el('input', { type: 'number', step: '0.5', inputmode: 'decimal', placeholder: 'g', value: '0' });
  const carbs = el('input', { type: 'number', step: '0.5', inputmode: 'decimal', placeholder: 'g', value: '0' });
  const fat = el('input', { type: 'number', step: '0.5', inputmode: 'decimal', placeholder: 'g', value: '0' });
  const fiber = el('input', { type: 'number', step: '0.5', inputmode: 'decimal', placeholder: 'g', value: '0' });
  const slotSel = el('select');
  for (const [k, v] of Object.entries(SLOT_LABEL)) slotSel.appendChild(el('option', { value: k }, v));
  slotSel.value = inferMealSlot();
  const saveDB = el('input', { type: 'checkbox', id: 'saveDB' });
  saveDB.checked = true;

  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, 'Custom food'),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    el('div', { class: 'form-row' }, [el('label', { class: 'form-label' }, 'Name'), name]),
    el('div', { class: 'form-row row', style:'gap:8px;' }, [
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'Qty'), qty]),
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'Unit'), unit])
    ]),
    el('div', { class: 'form-row' }, [el('label', { class: 'form-label' }, 'kcal (per qty above)'), kcal]),
    el('div', { class: 'form-row row', style:'gap:8px;' }, [
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'P'), protein]),
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'C'), carbs]),
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'F'), fat]),
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'Fiber'), fiber])
    ]),
    el('div', { class: 'form-row' }, [el('label', { class: 'form-label' }, 'Meal'), slotSel]),
    el('label', { class: 'row text-sm', style: 'gap:8px;align-items:center;margin-bottom:12px;' }, [
      saveDB, el('span', {}, 'Save to my food database for next time')
    ]),
    el('button', { class: 'btn btn-primary btn-block', onClick: async () => {
      const n = name.value.trim();
      const k = parseFloat(kcal.value);
      if (!n || !k) { toast('Name and kcal required'); return; }
      const entry = {
        date: todayISO(),
        time: nowHHMM(),
        meal_slot: slotSel.value,
        item_name: n,
        serving_qty: parseFloat(qty.value) || 1,
        serving_unit: unit.value || 'serving',
        kcal: k,
        protein_g: parseFloat(protein.value) || 0,
        carbs_g: parseFloat(carbs.value) || 0,
        fat_g: parseFloat(fat.value) || 0,
        fiber_g: parseFloat(fiber.value) || 0,
        source: 'custom'
      };
      await DB.logFood(entry);
      if (saveDB.checked) {
        await DB.addCustomFood({
          name: n, category: 'misc',
          default_serving_qty: entry.serving_qty,
          default_serving_unit: entry.serving_unit,
          kcal_per_serving: k,
          protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g, fiber_g: entry.fiber_g,
          tags: [], source: 'custom'
        });
      }
      closeModal();
      toast('Logged');
      await refresh();
      refreshCb && refreshCb();
    }}, 'Save')
  ]);
  modal(body);
}

// ---------- Water picker ----------
function openWaterPicker(refreshCb) {
  const sizes = [200, 250, 500, 1000];
  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, 'Add water'),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    el('div', { class: 'col' }, sizes.map(s =>
      el('button', { class: 'btn btn-block', onClick: async () => {
        await DB.logWater({ date: todayISO(), time: nowHHMM(), volume_ml: s });
        closeModal(); toast(`+${s} ml`); await refresh(); refreshCb && refreshCb();
      }}, `${s} ml`)
    ))
  ]);
  modal(body);
}

// ---------- Exercise picker ----------
function openExercisePicker(refreshCb) {
  const search = el('input', { class: 'search-input', type: 'text', placeholder: 'Search exercises…' });
  const results = el('div');

  async function update() {
    const q = search.value.trim();
    const list = await DB.searchExercises(q, 50);
    results.innerHTML = '';
    for (const e of list) {
      results.appendChild(el('div', { class: 'food-result', onClick: () => {
        closeModal();
        openExerciseLogModal(e, refreshCb);
      }}, [
        el('div', {}, [
          el('div', { class: 'bold text-sm' }, e.name),
          el('div', { class: 'food-result-meta' },
            `${e.type} · ${e.intensity} · ${e.target_muscle_group}`)
        ]),
        el('div', { class: 'food-result-kcal' }, `MET ${e.met_value}`)
      ]));
    }
  }
  search.addEventListener('input', update);

  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, 'Log exercise'),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    search,
    results,
    el('button', { class: 'btn btn-block mt-2', onClick: () => {
      closeModal(); openCustomExerciseModal(refreshCb);
    }}, '+ Custom exercise')
  ]);
  modal(body);
  update();
}

function openExerciseLogModal(ex, refreshCb) {
  const ctx = getCtx();
  const weight = ctx.current_weight_kg;
  const dur = el('input', { type: 'number', step: '1', min: '1',
    value: String(ex.default_duration_min || ''), placeholder: 'min', inputmode: 'numeric' });
  const sets = el('input', { type: 'number', step: '1', min: '0',
    value: String(ex.default_sets || ''), inputmode: 'numeric' });
  const reps = el('input', { type: 'number', step: '1', min: '0',
    value: String(ex.default_reps || ''), inputmode: 'numeric' });

  const kcalEl = el('div', { class: 'text-sm muted' });
  function updateKcal() {
    const d = parseFloat(dur.value) || 0;
    const s = parseInt(sets.value) || 0;
    const r = parseInt(reps.value) || 0;
    const est = estimateExerciseKcal({ ...ex, default_duration_min: d, default_sets: s, default_reps: r }, weight, d || null);
    kcalEl.textContent = `Estimated burn: ~${est} kcal at your weight`;
    kcalEl.dataset.kcal = est;
  }
  dur.addEventListener('input', updateKcal);
  sets.addEventListener('input', updateKcal);
  reps.addEventListener('input', updateKcal);
  updateKcal();

  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, ex.name),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    el('div', { class: 'text-sm muted mb-2' }, ex.instructions || ''),
    el('div', { class: 'form-row row', style:'gap:8px;' }, [
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'Duration (min)'), dur]),
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'Sets'), sets]),
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'Reps'), reps])
    ]),
    kcalEl,
    el('button', { class: 'btn btn-primary btn-block mt-2', onClick: async () => {
      const d = parseFloat(dur.value) || 0;
      const s = parseInt(sets.value) || 0;
      const r = parseInt(reps.value) || 0;
      const est = parseInt(kcalEl.dataset.kcal) || 0;
      await DB.logExercise({
        date: todayISO(),
        time: nowHHMM(),
        exercise_name: ex.name,
        sets: s, reps: r,
        duration_min: d,
        kcal_burned: est,
        intensity: ex.intensity
      });
      closeModal();
      toast('Logged');
      await refresh();
      refreshCb && refreshCb();
    }}, 'Save')
  ]);
  modal(body);
}

function openCustomExerciseModal(refreshCb) {
  const name = el('input', { type: 'text', placeholder: 'Exercise name' });
  const dur = el('input', { type: 'number', value: '20', inputmode: 'numeric' });
  const kcal = el('input', { type: 'number', value: '100', inputmode: 'numeric' });
  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, 'Custom exercise'),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    el('div', { class: 'form-row' }, [el('label', { class: 'form-label' }, 'Name'), name]),
    el('div', { class: 'form-row row', style:'gap:8px;' }, [
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'Duration (min)'), dur]),
      el('div', { style:'flex:1' }, [el('label', { class: 'form-label' }, 'kcal burned'), kcal])
    ]),
    el('button', { class: 'btn btn-primary btn-block', onClick: async () => {
      if (!name.value) { toast('Name required'); return; }
      await DB.logExercise({
        date: todayISO(),
        time: nowHHMM(),
        exercise_name: name.value,
        sets: 0, reps: 0,
        duration_min: parseFloat(dur.value) || 0,
        kcal_burned: parseFloat(kcal.value) || 0,
        intensity: 'moderate'
      });
      closeModal(); toast('Logged'); await refresh(); refreshCb && refreshCb();
    }}, 'Save')
  ]);
  modal(body);
}

function emptyState(title, sub) {
  return el('div', { class: 'card', style: 'text-align:center;' }, [
    el('div', { class: 'bold mb-1' }, title),
    el('div', { class: 'text-sm muted' }, sub)
  ]);
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
