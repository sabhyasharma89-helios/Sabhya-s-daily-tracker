import * as DB from './db.js';
import { getContext } from './profile.js';
import { todayISO } from './utils.js';

let _ctx;
let _listeners = new Set();

export async function ensureContext() {
  _ctx = await getContext();
  return _ctx;
}

export async function refresh() {
  _ctx = await getContext();
  for (const l of _listeners) try { l(_ctx); } catch (e) { console.error(e); }
  return _ctx;
}

export function getCtx() { return _ctx; }

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Compute today's snapshot: kcal in, burned, deficit, macros, water.
 */
export async function todaySnapshot() {
  const ctx = _ctx || await refresh();
  const date = todayISO();
  const [food, water, exercise] = await Promise.all([
    DB.getFoodLog(date),
    DB.getWaterLog(date),
    DB.getExerciseLog(date)
  ]);

  const kcal_in = food.reduce((s, f) => s + (f.kcal || 0), 0);
  const protein_g = food.reduce((s, f) => s + (f.protein_g || 0), 0);
  const carbs_g = food.reduce((s, f) => s + (f.carbs_g || 0), 0);
  const fat_g = food.reduce((s, f) => s + (f.fat_g || 0), 0);
  const fiber_g = food.reduce((s, f) => s + (f.fiber_g || 0), 0);

  const kcal_burned = exercise.reduce((s, e) => s + (e.kcal_burned || 0), 0);
  const water_ml = water.reduce((s, w) => s + (w.volume_ml || 0), 0);

  const t = ctx.targets;
  // True TDEE today = BMR * sedentary_factor + actual exercise burn
  const true_tdee = t.bmr_kcal * 1.2 + kcal_burned;
  const net_deficit = true_tdee - kcal_in;
  const kcal_target = t.daily_calorie_target_kcal;
  // kcal he can still eat to hit the 800-deficit target
  const kcal_remaining_for_target = (true_tdee - t.daily_net_deficit_target_kcal) - kcal_in;

  let status = 'good';
  if (kcal_remaining_for_target < -150) status = 'bad';
  else if (kcal_remaining_for_target < 0) status = 'warn';

  return {
    date,
    food, water, exercise,
    kcal_in, kcal_burned, water_ml,
    protein_g, carbs_g, fat_g, fiber_g,
    kcal_target,
    kcal_remaining_for_target,
    true_tdee_today: true_tdee,
    net_deficit,
    target_deficit: t.daily_net_deficit_target_kcal,
    status
  };
}
