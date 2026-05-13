import * as DB from './db.js';
import { todayISO, isoOffset } from './utils.js';

export const DEFAULT_PROFILE = {
  id: 1,
  name: 'Sabhya',
  sex: 'male',
  age_years: 37,
  height_cm: 182.88,
  starting_weight_kg: 99,
  target_weight_kg: 80,
  target_date: null,           // computed at first launch
  start_date: null,
  activity_level: 'sedentary',
  diet_type: 'pure_vegetarian_no_eggs',
  dietary_notes: 'no eggs, no meat, no fish; dairy OK; Indian cuisine preferred',
  equipment_access: 'none',
  preferred_workout_location: 'home_or_outdoor_walk',
  timezone: 'Asia/Kolkata',
  units: { weight: 'kg', height: 'cm', volume: 'ml', energy: 'kcal' },
  // Override flags — when set, computed targets are ignored
  override_daily_calorie_target: null,
  override_daily_exercise_burn_target: null,
  override_daily_water_target_ml: null,
  override_daily_protein_target_g: null,
  override_daily_deficit_kcal: null,
  notifications: {
    weight_reminder_time: '07:30',
    water_interval_min: 90,
    meal_reminders: true
  },
  anthropic_api_key: null,
  ai_model: 'claude-sonnet-4-5'
};

export function activityFactor(level) {
  return { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[level] || 1.2;
}

export function mifflinBMR({ sex, weight_kg, height_cm, age_years }) {
  if (sex === 'male') {
    return 10 * weight_kg + 6.25 * height_cm - 5 * age_years + 5;
  }
  return 10 * weight_kg + 6.25 * height_cm - 5 * age_years - 161;
}

/**
 * Compute targets for a given weight. Uses overrides from profile when present.
 */
export function computeTargets(profile, weight_kg) {
  const bmr = mifflinBMR({
    sex: profile.sex,
    weight_kg,
    height_cm: profile.height_cm,
    age_years: profile.age_years
  });
  const tdee = bmr * activityFactor(profile.activity_level);

  const deficit = profile.override_daily_deficit_kcal ?? 800;
  const diet_deficit = 500;
  const exercise_target = profile.override_daily_exercise_burn_target ?? 300;

  const calorie_target = profile.override_daily_calorie_target
    ?? Math.round(tdee - diet_deficit);

  // Safety floor: never let target go below BMR (≈1950 for him)
  const calorie_target_safe = Math.max(calorie_target, Math.round(bmr));

  const protein_target = profile.override_daily_protein_target_g
    ?? Math.max(100, Math.round(1.6 * weight_kg));

  const water_target = profile.override_daily_water_target_ml
    ?? Math.round(weight_kg * 30); // ~30 ml per kg

  return {
    bmr_kcal: Math.round(bmr),
    tdee_kcal: Math.round(tdee),
    daily_calorie_target_kcal: calorie_target_safe,
    daily_exercise_burn_target_kcal: exercise_target,
    daily_water_target_ml: water_target,
    daily_protein_target_g: protein_target,
    daily_net_deficit_target_kcal: deficit
  };
}

/**
 * Get profile, current weight, and computed targets.
 */
export async function getContext() {
  let profile = await DB.getProfile();
  if (!profile) {
    profile = { ...DEFAULT_PROFILE };
    profile.start_date = todayISO();
    profile.target_date = isoOffset(180); // 6 months
    await DB.saveProfile(profile);
    // also seed initial weight
    await DB.logWeight({ date: todayISO(), weight_kg: profile.starting_weight_kg, notes: 'Initial weight' });
  }
  const weights = await DB.getAllWeights();
  const current_weight_kg = weights.length
    ? weights[weights.length - 1].weight_kg
    : profile.starting_weight_kg;
  const targets = computeTargets(profile, current_weight_kg);
  return { profile, current_weight_kg, weights, targets };
}

/**
 * Recompute target weight trajectory.
 * Returns linear-projected target weight for today.
 */
export function projectedWeightForDate(profile, dateISO) {
  if (!profile.start_date || !profile.target_date) return null;
  const start = new Date(profile.start_date + 'T00:00:00').getTime();
  const end = new Date(profile.target_date + 'T00:00:00').getTime();
  const at = new Date(dateISO + 'T00:00:00').getTime();
  if (end <= start) return profile.target_weight_kg;
  const pct = Math.max(0, Math.min(1, (at - start) / (end - start)));
  return profile.starting_weight_kg + (profile.target_weight_kg - profile.starting_weight_kg) * pct;
}

/**
 * Recalibrate the BMR baseline weight if last 7-day average has moved by >0.5 kg.
 * Called weekly.
 */
export async function maybeRecalibrate() {
  const { profile, weights } = await getContext();
  if (weights.length < 7) return;
  const last7 = weights.slice(-7);
  const avg = last7.reduce((s,w) => s + w.weight_kg, 0) / last7.length;
  const last_recalib = profile.last_recalibration_weight_kg ?? profile.starting_weight_kg;
  if (Math.abs(avg - last_recalib) >= 0.5) {
    profile.last_recalibration_weight_kg = +avg.toFixed(2);
    profile.last_recalibration_date = todayISO();
    await DB.saveProfile(profile);
  }
}
