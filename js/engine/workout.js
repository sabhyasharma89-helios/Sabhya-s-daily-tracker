import * as DB from '../db.js';
import { daysBetween, todayISO } from '../utils.js';

export function kcalPerMin(metValue, weightKg) {
  return (metValue * weightKg * 3.5) / 200;
}

export function estimateExerciseKcal(ex, weightKg, durationMinOverride = null) {
  const dur = durationMinOverride ?? ex.default_duration_min ?? 0;
  if (dur > 0) return Math.round(kcalPerMin(ex.met_value, weightKg) * dur);

  // strength: estimate from sets * reps assuming 0.5s per rep + rest
  const sets = ex.default_sets || 0;
  const reps = ex.default_reps || 0;
  const estMin = Math.max(2, sets * (Math.max(reps, 1) * 0.5 + 30) / 60);
  return Math.round(kcalPerMin(ex.met_value, weightKg) * estMin);
}

/**
 * Programme phase based on days since start_date and current BMI.
 */
export function programPhase(daysIn, bmi) {
  if (daysIn < 14) return { phase: 1, label: 'Foundation (walking + mobility)' };
  if (daysIn < 28) return { phase: 2, label: 'Add 1 bodyweight circuit' };
  if (daysIn < 56) return { phase: 3, label: 'Two circuits + light cardio' };
  return { phase: 4, label: 'Mixed program' };
}

export async function prescribeWorkoutForToday({ profile, weightKg, currentBurn = 0 }) {
  const exercises = await DB.getAllExercises();
  const burnTarget = (profile.override_daily_exercise_burn_target ?? 300) - currentBurn;
  const remaining = Math.max(0, burnTarget);
  const daysIn = profile.start_date ? daysBetween(profile.start_date, todayISO()) : 0;
  const h = profile.height_cm / 100;
  const bmi = weightKg / (h * h);
  const { phase, label } = programPhase(daysIn, bmi);

  const safeOnly = bmi >= 30 || phase < 3;

  // Always lead with walking
  const walking = exercises.find(e => e.name === 'Brisk walking');
  const plan = [];
  let kcalSum = 0;

  if (walking && remaining > 0) {
    const dur = Math.min(45, Math.max(20, Math.round(remaining * 0.6 / kcalPerMin(walking.met_value, weightKg))));
    const k = Math.round(kcalPerMin(walking.met_value, weightKg) * dur);
    plan.push({ exercise: walking, duration_min: dur, sets: 0, reps: 0, est_kcal: k });
    kcalSum += k;
  }

  if (phase >= 2 && kcalSum < remaining) {
    const circuit = pickCircuit(exercises, phase, safeOnly);
    for (const ex of circuit) {
      const k = estimateExerciseKcal(ex, weightKg);
      plan.push({ exercise: ex, duration_min: ex.default_duration_min, sets: ex.default_sets, reps: ex.default_reps, est_kcal: k });
      kcalSum += k;
      if (kcalSum >= remaining * 1.05) break;
    }
  }

  // Always end with a mobility piece
  const mobility = exercises.find(e => e.name === 'Sun salutations (Surya Namaskar)') ||
                   exercises.find(e => e.type === 'flexibility');
  if (mobility && phase >= 1) {
    const dur = 5;
    const k = Math.round(kcalPerMin(mobility.met_value, weightKg) * dur);
    plan.push({ exercise: mobility, duration_min: dur, sets: 0, reps: 0, est_kcal: k });
    kcalSum += k;
  }

  return {
    phase,
    phase_label: label,
    burn_target_kcal: profile.override_daily_exercise_burn_target ?? 300,
    burned_so_far_kcal: currentBurn,
    plan,
    estimated_total_kcal: kcalSum
  };
}

function pickCircuit(exercises, phase, safeOnly) {
  let pool = exercises.filter(e => e.type === 'strength');
  if (safeOnly) pool = pool.filter(e => e.joint_safe_for_high_bmi);

  // pick a balanced set: legs, glutes, core, chest, back
  const groups = ['legs','glutes','core','chest','back'];
  const picks = [];
  for (const g of groups) {
    const cand = pool.find(e => e.target_muscle_group === g && !picks.includes(e));
    if (cand) picks.push(cand);
    if (picks.length >= (phase >= 3 ? 6 : 4)) break;
  }
  return picks;
}
