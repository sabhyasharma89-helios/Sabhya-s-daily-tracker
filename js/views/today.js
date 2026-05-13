import { el, fmtKcal, fmtKg, prettyDate, todayISO, toast, modal, closeModal, clamp } from '../utils.js';
import { todaySnapshot, getCtx, refresh } from '../state.js';
import { suggestNextMeal } from '../engine/meals.js';
import { prescribeWorkoutForToday } from '../engine/workout.js';
import { buildCorrections } from '../engine/correction.js';
import * as DB from '../db.js';
import { openLogModal } from './log.js';

export async function renderToday(root) {
  root.innerHTML = '';
  const ctx = getCtx();
  const snap = await todaySnapshot();
  const profile = ctx.profile;
  const weight = ctx.current_weight_kg;

  document.getElementById('topbar-sub').textContent = prettyDate(todayISO());

  // Ring chart
  const targetDeficit = snap.target_deficit;
  const achieved = Math.max(0, snap.net_deficit);
  const ratio = clamp(achieved / targetDeficit, 0, 1);
  const ringColor = snap.status === 'good' ? 'good' : snap.status === 'warn' ? 'warn' : 'bad';

  const R = 90;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - ratio);

  const ringSVG = `
    <svg viewBox="0 0 220 220" class="ring-svg">
      <circle class="ring-bg" cx="110" cy="110" r="${R}"></circle>
      <circle class="ring-fg ${ringColor}" cx="110" cy="110" r="${R}"
        stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        transform="rotate(-90 110 110)"></circle>
      <text class="ring-center ring-big" x="110" y="106">${fmtKcal(Math.round(snap.net_deficit))}</text>
      <text class="ring-center ring-small" x="110" y="130">deficit / ${fmtKcal(targetDeficit)} target</text>
    </svg>
  `;

  const remaining = snap.kcal_remaining_for_target;
  const remLabel = remaining >= 0 ? `${fmtKcal(remaining)} kcal left` : `${fmtKcal(-remaining)} kcal over`;
  const remColor = remaining >= 0 ? 'green' : remaining > -150 ? 'yellow' : 'red';

  const ringCard = el('div', { class: 'card' }, []);
  ringCard.innerHTML = `
    <div class="ring-wrap">${ringSVG}</div>
    <div class="card-row" style="margin-top:8px;">
      <div class="text-sm muted">Eaten</div>
      <div class="bold">${fmtKcal(snap.kcal_in)} <span class="muted">/ ${fmtKcal(snap.kcal_target)}</span></div>
    </div>
    <div class="card-row mt-1">
      <div class="text-sm muted">Burned (exercise)</div>
      <div class="bold">${fmtKcal(snap.kcal_burned)}</div>
    </div>
    <div class="card-row mt-1">
      <div class="text-sm muted">Status</div>
      <div class="bold ${remColor}">${remLabel}</div>
    </div>
  `;
  root.appendChild(ringCard);

  // KPI strip
  const kpi = el('div', { class: 'card' });
  kpi.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Weight</div><div class="kpi-val">${fmtKg(weight)} kg</div></div>
      <div class="kpi"><div class="kpi-label">BMI</div><div class="kpi-val">${bmi(weight, profile.height_cm)}</div></div>
      <div class="kpi"><div class="kpi-label">Target</div><div class="kpi-val">${profile.target_weight_kg} kg</div></div>
    </div>
  `;
  root.appendChild(kpi);

  // Macros
  const macrosCard = el('div', { class: 'card' });
  const t = ctx.targets;
  macrosCard.innerHTML = `
    <div class="card-title">Macros</div>
    <div class="macro-row">
      ${macroRow('Protein', snap.protein_g, t.daily_protein_target_g, 'protein', 'g')}
      ${macroRow('Carbs', snap.carbs_g, Math.round(snap.kcal_target * 0.45 / 4), 'carbs', 'g')}
      ${macroRow('Fat', snap.fat_g, Math.round(snap.kcal_target * 0.30 / 9), 'fat', 'g')}
    </div>
  `;
  root.appendChild(macrosCard);

  // Water
  const waterCard = el('div', { class: 'card' });
  waterCard.appendChild(el('div', { class: 'card-row' }, [
    el('div', { class: 'card-title', style: 'margin:0' }, 'Water'),
    el('div', { class: 'text-sm muted' }, `${snap.water_ml} / ${t.daily_water_target_ml} ml`)
  ]));
  const glassMl = 250;
  const target_glasses = Math.ceil(t.daily_water_target_ml / glassMl);
  const filled = Math.floor(snap.water_ml / glassMl);
  const waterRow = el('div', { class: 'water-row' });
  for (let i = 0; i < target_glasses; i++) {
    const cup = el('button', {
      class: 'water-cup' + (i < filled ? ' filled' : ''),
      'aria-label': `Glass ${i+1}`,
      onClick: async () => {
        if (i < filled) {
          // tap a filled glass to remove last entry
          const w = await DB.getWaterLog(todayISO());
          if (w.length) { await DB.deleteWaterLog(w[w.length-1].id); refresh(); renderToday(root); }
        } else {
          await DB.logWater({ date: todayISO(), time: nowHHMM(), volume_ml: glassMl });
          await refresh();
          renderToday(root);
        }
      }
    });
    waterRow.appendChild(cup);
  }
  waterCard.appendChild(waterRow);
  root.appendChild(waterCard);

  // Next meal suggestion
  const sugCard = el('div', { class: 'card' });
  sugCard.innerHTML = `<div class="card-title">Next meal suggestion</div>`;
  const sug = await suggestNextMeal({
    kcalRemaining: snap.kcal_remaining_for_target,
    proteinSoFar: snap.protein_g,
    proteinTarget: t.daily_protein_target_g,
    now: new Date()
  });
  if (sug.singles.length === 0 || snap.kcal_remaining_for_target < -150) {
    sugCard.appendChild(el('div', { class: 'text-sm muted' }, 'You\'re over today — see corrections below.'));
  } else {
    sugCard.appendChild(el('div', { class: 'text-sm muted mb-1' }, `${slotLabel(sug.slot)} · target ~${sug.kcalBudget} kcal`));
    for (const f of sug.singles) {
      const row = el('div', { class: 'food-result' }, [
        el('div', {}, [
          el('div', { class: 'bold text-sm' }, f.name),
          el('div', { class: 'food-result-meta' },
            `${f.default_serving_qty} ${f.default_serving_unit} · ${f.protein_g}gP / ${f.carbs_g}gC / ${f.fat_g}gF`)
        ]),
        el('div', { class: 'row' }, [
          el('div', { class: 'food-result-kcal' }, `${f.kcal_per_serving} kcal`),
          el('button', { class: 'btn btn-sm btn-primary', onClick: async () => {
            await DB.logFood({
              date: todayISO(),
              time: nowHHMM(),
              meal_slot: sug.slot,
              item_name: f.name,
              serving_qty: f.default_serving_qty,
              serving_unit: f.default_serving_unit,
              kcal: f.kcal_per_serving,
              protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fiber_g: f.fiber_g,
              source: 'ai'
            });
            toast('Logged');
            await refresh();
            renderToday(root);
          }}, 'Log')
        ])
      ]);
      sugCard.appendChild(row);
    }
    if (sug.combo) {
      sugCard.appendChild(el('div', { class: 'divider' }));
      sugCard.appendChild(el('div', { class: 'text-sm muted mb-1' }, 'Or a combo plate:'));
      const names = sug.combo.items.map(i => i.name).join(' + ');
      sugCard.appendChild(el('div', { class: 'text-sm' }, names));
      sugCard.appendChild(el('div', { class: 'food-result-meta mt-1' }, `~${sug.combo.estimated_kcal} kcal · ~${sug.combo.estimated_protein_g}g protein · ${sug.combo.portion_note}`));
    }
  }
  root.appendChild(sugCard);

  // Over-budget corrections
  if (snap.kcal_remaining_for_target < -150) {
    const corrCard = el('div', { class: 'card' });
    corrCard.appendChild(el('div', { class: 'card-title' }, 'Course correction'));
    corrCard.appendChild(el('div', { class: 'text-sm mb-2' },
      `You're ${fmtKcal(-snap.kcal_remaining_for_target)} kcal over today. Pick one:`));
    const corrs = await buildCorrections({
      overshoot: -snap.kcal_remaining_for_target,
      weightKg: weight,
      todayFood: snap.food
    });
    for (const c of corrs) {
      const row = el('div', { class: 'food-result' }, [
        el('div', {}, [
          el('div', { class: 'bold text-sm' }, c.title),
          el('div', { class: 'food-result-meta' }, c.detail)
        ]),
        c.apply
          ? el('button', { class: 'btn btn-sm btn-primary', onClick: async () => {
              await c.apply();
              toast('Added');
              await refresh();
              renderToday(root);
            }}, 'Do it')
          : el('div', { class: 'text-xs muted' }, 'plan only')
      ]);
      corrCard.appendChild(row);
    }
    root.appendChild(corrCard);
  }

  // Today's workout
  const wkCard = el('div', { class: 'card' });
  wkCard.appendChild(el('div', { class: 'card-row' }, [
    el('div', { class: 'card-title', style: 'margin:0' }, "Today's workout"),
    el('div', { class: 'text-xs muted' },
      `${fmtKcal(snap.kcal_burned)} / ${t.daily_exercise_burn_target_kcal} kcal`)
  ]));
  const workout = await prescribeWorkoutForToday({ profile, weightKg: weight, currentBurn: snap.kcal_burned });
  wkCard.appendChild(el('div', { class: 'text-xs muted mb-1' }, workout.phase_label));
  for (const item of workout.plan) {
    const ex = item.exercise;
    const sub = item.duration_min
      ? `${item.duration_min} min · ${item.est_kcal} kcal`
      : `${item.sets}×${item.reps} · ${item.est_kcal} kcal`;
    const row = el('div', { class: 'food-result' }, [
      el('div', {}, [
        el('div', { class: 'bold text-sm' }, ex.name),
        el('div', { class: 'food-result-meta' }, sub)
      ]),
      el('button', { class: 'btn btn-sm', onClick: async () => {
        await DB.logExercise({
          date: todayISO(),
          time: nowHHMM(),
          exercise_name: ex.name,
          sets: item.sets || 0,
          reps: item.reps || 0,
          duration_min: item.duration_min || 0,
          kcal_burned: item.est_kcal,
          intensity: ex.intensity
        });
        toast('Done!');
        await refresh();
        renderToday(root);
      }}, 'Done')
    ]);
    wkCard.appendChild(row);
  }
  root.appendChild(wkCard);

  // Log weight CTA if not logged today
  const weightLogged = await DB.getWeight(todayISO());
  if (!weightLogged || weightLogged.date !== todayISO()) {
    const cta = el('div', { class: 'card', style: 'text-align:center' }, [
      el('div', { class: 'text-sm muted mb-1' }, "You haven't logged today's weight"),
      el('button', { class: 'btn btn-primary', onClick: () => openWeightModal(root) }, 'Log weight')
    ]);
    root.appendChild(cta);
  }

  // FAB
  removeFAB();
  const fab = el('button', { class: 'fab', id: 'fab-add',
    onClick: () => openLogModal(() => renderToday(root)) }, '+');
  document.getElementById('app').appendChild(fab);
}

function macroRow(name, current, target, cls, unit) {
  const pct = Math.min(100, Math.round((current / Math.max(1,target)) * 100));
  return `
    <div class="macro">
      <div class="macro-name">${name}</div>
      <div class="macro-bar"><span class="${cls}" style="width:${pct}%"></span></div>
      <div class="macro-val">${Math.round(current)}${unit} / ${Math.round(target)}${unit}</div>
    </div>
  `;
}

function bmi(w, h_cm) {
  const h = h_cm / 100;
  return (w / (h*h)).toFixed(1);
}

function slotLabel(s) {
  return { breakfast: 'Breakfast', mid_morning: 'Mid-morning', lunch: 'Lunch',
           evening_snack: 'Evening snack', dinner: 'Dinner', other: 'Snack' }[s] || s;
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function removeFAB() {
  const f = document.getElementById('fab-add');
  if (f) f.remove();
}

export function openWeightModal(rootForRefresh) {
  const inputW = el('input', { type: 'number', step: '0.1', min: '50', max: '200',
    placeholder: 'e.g. 98.4', inputmode: 'decimal' });
  const inputBF = el('input', { type: 'number', step: '0.1', min: '5', max: '60',
    placeholder: 'optional (%)', inputmode: 'decimal' });
  const inputNotes = el('input', { type: 'text', placeholder: 'optional' });

  const body = el('div', {}, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-title' }, 'Log weight'),
      el('button', { class: 'modal-close', onClick: closeModal }, '×')
    ]),
    el('div', { class: 'form-row' }, [
      el('label', { class: 'form-label' }, 'Weight (kg)'),
      inputW
    ]),
    el('div', { class: 'form-row' }, [
      el('label', { class: 'form-label' }, 'Body fat %'),
      inputBF
    ]),
    el('div', { class: 'form-row' }, [
      el('label', { class: 'form-label' }, 'Notes'),
      inputNotes
    ]),
    el('button', { class: 'btn btn-primary btn-block', onClick: async () => {
      const w = parseFloat(inputW.value);
      if (!w || w < 50 || w > 200) { toast('Please enter a valid weight'); return; }
      const ctx = getCtx();
      const lastW = ctx.weights[ctx.weights.length - 1]?.weight_kg;
      if (lastW && Math.abs(w - lastW) > 3) {
        if (!confirm(`That's a ${Math.abs(w-lastW).toFixed(1)} kg swing from last entry — is it correct?`)) return;
      }
      const bf = parseFloat(inputBF.value) || undefined;
      await DB.logWeight({
        date: todayISO(),
        weight_kg: w,
        body_fat_pct: bf,
        notes: inputNotes.value || undefined
      });
      toast('Weight saved');
      closeModal();
      await refresh();
      if (rootForRefresh) renderToday(rootForRefresh);
    }}, 'Save')
  ]);
  modal(body);
}
