import * as DB from '../db.js';
import { getCtx } from '../state.js';
import { todaySnapshot } from '../state.js';
import { suggestNextMeal } from '../engine/meals.js';
import { prescribeWorkoutForToday } from '../engine/workout.js';
import { buildCorrections } from '../engine/correction.js';
import { isoOffset, todayISO } from '../utils.js';

const SYMPTOM_RX = /\b(pain|hurt|sore|dizzy|dizziness|fatigue|tired (always|all the time)|palpitation|chest|short of breath|breathless|thyroid|fatty liver|diabetes|sugar (high|low)|blood pressure|bp|cholesterol|asthma|migraine|nausea|vomit|fever|injury|knee|back ache)\b/i;

const MED_DISCLAIMER = "This sounds like something to discuss with your doctor. I'll keep tracking the diet and exercise side — please don't substitute this app for medical advice.";

export async function answer(userMessage) {
  const msg = userMessage.toLowerCase();
  if (SYMPTOM_RX.test(msg)) return MED_DISCLAIMER;

  const ctx = getCtx();
  const snap = await todaySnapshot();

  if (/(what should i eat|eat now|hungry|snack|next meal)/.test(msg)) {
    return await answerNextMeal(snap, ctx);
  }
  if (/(cheated|over (target|budget)|too much|ate too|went off)/.test(msg)) {
    return await answerCheated(snap, ctx);
  }
  if (/(plan (tomorrow|next day)|meal plan)/.test(msg)) {
    return await answerPlanTomorrow(snap, ctx);
  }
  if (/(not losing|plateau|stuck|weight loss slow|no progress)/.test(msg)) {
    return answerPlateau(snap, ctx);
  }
  if (/(workout|exercise|train)/.test(msg)) {
    return await answerWorkout(snap, ctx);
  }
  if (/(protein|enough protein)/.test(msg)) {
    return answerProtein(snap, ctx);
  }
  if (/(water|hydrat)/.test(msg)) {
    return answerWater(snap, ctx);
  }
  if (/(weight|kg|bmi|losing)/.test(msg)) {
    return await answerWeight(ctx);
  }
  return await answerDefault(snap, ctx);
}

async function answerNextMeal(snap, ctx) {
  const sug = await suggestNextMeal({
    kcalRemaining: snap.kcal_remaining_for_target,
    proteinSoFar: snap.protein_g,
    proteinTarget: ctx.targets.daily_protein_target_g,
    now: new Date()
  });
  if (snap.kcal_remaining_for_target < -150) {
    return `You're already ${Math.round(-snap.kcal_remaining_for_target)} kcal over today. Hold off on food — focus on water and a walk. Tomorrow we reset.`;
  }
  const lines = [`You have ${Math.max(0,Math.round(snap.kcal_remaining_for_target))} kcal left for today. Here are 3 options for ${slotLabel(sug.slot)} (~${sug.kcalBudget} kcal):`];
  for (const f of sug.singles) {
    lines.push(`• ${f.name} — ${f.kcal_per_serving} kcal, ${Math.round(f.protein_g)}g protein (${f.default_serving_qty} ${f.default_serving_unit})`);
  }
  if (sug.combo) {
    lines.push(`\nPlate combo: ${sug.combo.items.map(i => i.name).join(' + ')} — ~${sug.combo.estimated_kcal} kcal, ~${sug.combo.estimated_protein_g}g protein. ${sug.combo.portion_note}.`);
  }
  return lines.join('\n');
}

async function answerCheated(snap, ctx) {
  const overshoot = Math.max(0, -snap.kcal_remaining_for_target);
  if (overshoot === 0) {
    return `You're still on track — ${Math.round(snap.kcal_remaining_for_target)} kcal under target. No correction needed.`;
  }
  const corrs = await buildCorrections({
    overshoot,
    weightKg: ctx.current_weight_kg,
    todayFood: snap.food
  });
  const lines = [`You're ${Math.round(overshoot)} kcal over today. Pick one:`];
  for (const c of corrs) lines.push(`• ${c.title} — ${c.detail}`);
  lines.push(`\nAnd: drink 500 ml of water now. Tomorrow we reset clean — don't try to "make up" by starving.`);
  return lines.join('\n');
}

async function answerPlanTomorrow(snap, ctx) {
  const target = ctx.targets.daily_calorie_target_kcal;
  const proteinTarget = ctx.targets.daily_protein_target_g;
  // a roughly balanced 5-meal plan
  return [
    `Tomorrow's plan — target ${target} kcal, ~${proteinTarget}g protein:`,
    ``,
    `• Breakfast (~400 kcal): 40g oats + 200ml toned milk + 1 banana + 10 almonds. ~18g protein.`,
    `• Mid-morning (~150 kcal): 1 katori sprouts salad. ~9g protein.`,
    `• Lunch (~550 kcal): 2 rotis + 1 katori dal + 1 katori paneer/vegetable sabzi + curd. ~25g protein.`,
    `• Evening (~200 kcal): 1 cup tea (no sugar, low-fat milk) + 30g roasted chana. ~7g protein.`,
    `• Dinner (~540 kcal): 2 phulkas + 1 katori dal + palak paneer (small katori) + cucumber salad. ~20g protein.`,
    ``,
    `Hydration: 12 glasses (3 L). Walk 30 min after lunch or dinner.`
  ].join('\n');
}

function answerPlateau(snap, ctx) {
  const ws = ctx.weights || [];
  if (ws.length < 14) {
    return `Not enough data yet to call a plateau — log weight daily for 2 weeks first.`;
  }
  const recent = ws.slice(-14);
  const avgNow = recent.slice(-7).reduce((s,w) => s + w.weight_kg, 0) / 7;
  const avgPrev = recent.slice(0,7).reduce((s,w) => s + w.weight_kg, 0) / 7;
  const change = avgPrev - avgNow;
  if (change > 0.3) {
    return `You're not plateaued — 7-day avg dropped ${change.toFixed(2)} kg. Keep going.`;
  }
  return [
    `If weight hasn't moved in 14 days, check these (in order):`,
    `1. Water — are you actually hitting 3L daily? Not 2.`,
    `2. Hidden calories — ghee on roti, oil in sabzi, sugar in chai. Easy to under-log by 200–300 kcal.`,
    `3. Sleep — under 7 hrs spikes cortisol and stalls fat loss.`,
    `4. Cardio volume — has it slipped? Add a 30-min evening walk.`,
    `5. Weigh-in consistency — same time, post-bathroom, before food. Daily fluctuation is normal.`,
    ``,
    `If all above are clean and weight stays flat for 3+ weeks, talk to your doctor about thyroid/insulin labs.`
  ].join('\n');
}

async function answerWorkout(snap, ctx) {
  const wk = await prescribeWorkoutForToday({
    profile: ctx.profile,
    weightKg: ctx.current_weight_kg,
    currentBurn: snap.kcal_burned
  });
  const lines = [`Phase: ${wk.phase_label}. Target burn ${wk.burn_target_kcal} kcal.`, ``];
  for (const item of wk.plan) {
    const ex = item.exercise;
    const det = item.duration_min ? `${item.duration_min} min` : `${item.sets}×${item.reps}`;
    lines.push(`• ${ex.name} — ${det} (~${item.est_kcal} kcal)`);
  }
  lines.push(``, `Estimated total: ~${wk.estimated_total_kcal} kcal.`);
  return lines.join('\n');
}

function answerProtein(snap, ctx) {
  const target = ctx.targets.daily_protein_target_g;
  const remaining = Math.max(0, target - snap.protein_g);
  if (remaining < 5) {
    return `You're at ${Math.round(snap.protein_g)}g protein — target hit (${target}g). Good.`;
  }
  return [
    `You've had ${Math.round(snap.protein_g)}g / ${target}g protein. Need ${Math.round(remaining)}g more.`,
    ``,
    `Quick high-protein options:`,
    `• 150g Greek yogurt — 15g`,
    `• 1 katori sprouts — 9g`,
    `• 50g paneer — 9g`,
    `• 200ml skim milk — 7g`,
    `• 30g roasted chana — 6g`,
    `• 1 scoop whey if you keep some — 24g`
  ].join('\n');
}

function answerWater(snap, ctx) {
  const target = ctx.targets.daily_water_target_ml;
  const remaining = Math.max(0, target - snap.water_ml);
  if (remaining < 250) return `You've had ${snap.water_ml} / ${target} ml. Nearly there.`;
  const glasses = Math.ceil(remaining / 250);
  return `You're at ${snap.water_ml} / ${target} ml. Drink ${glasses} more glass${glasses>1?'es':''} (250ml each). Keep a bottle visible on your desk.`;
}

async function answerWeight(ctx) {
  const ws = ctx.weights || [];
  if (!ws.length) return `No weight data yet. Log today's weight from the Today tab.`;
  const latest = ws[ws.length - 1];
  const startW = ctx.profile.starting_weight_kg;
  const dropped = startW - latest.weight_kg;
  const togo = latest.weight_kg - ctx.profile.target_weight_kg;
  return [
    `Current: ${latest.weight_kg.toFixed(1)} kg (BMI ${latest.bmi}).`,
    `Lost so far: ${dropped.toFixed(1)} kg.`,
    `To target (${ctx.profile.target_weight_kg} kg): ${togo.toFixed(1)} kg.`,
    ``,
    `At a 0.73 kg/week pace, that's ${Math.ceil(togo / 0.73)} weeks away.`
  ].join('\n');
}

async function answerDefault(snap, ctx) {
  return [
    `Quick snapshot:`,
    `• Eaten ${Math.round(snap.kcal_in)} / ${snap.kcal_target} kcal`,
    `• Burned ${Math.round(snap.kcal_burned)} / ${ctx.targets.daily_exercise_burn_target_kcal} kcal`,
    `• Protein ${Math.round(snap.protein_g)} / ${ctx.targets.daily_protein_target_g} g`,
    `• Water ${snap.water_ml} / ${ctx.targets.daily_water_target_ml} ml`,
    `• Net deficit ${Math.round(snap.net_deficit)} kcal`,
    ``,
    `Ask me: "what should I eat now", "I cheated", "plan tomorrow's meals", "why am I not losing weight", or "workout today".`
  ].join('\n');
}

function slotLabel(s) {
  return { breakfast: 'breakfast', mid_morning: 'mid-morning', lunch: 'lunch',
           evening_snack: 'an evening snack', dinner: 'dinner', other: 'a snack' }[s] || s;
}
