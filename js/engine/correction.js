import * as DB from '../db.js';
import { todayISO } from '../utils.js';
import { kcalPerMin } from './workout.js';

/**
 * Build 3 corrective actions when the user is over budget.
 */
export async function buildCorrections({ overshoot, weightKg, todayFood }) {
  const exercises = await DB.getAllExercises();
  const walking = exercises.find(e => e.name === 'Brisk walking');
  const corrections = [];

  // A. Add brisk walk to burn the overshoot
  if (walking) {
    const kpm = kcalPerMin(walking.met_value, weightKg);
    const dur = Math.max(10, Math.ceil(overshoot / kpm / 5) * 5);
    corrections.push({
      kind: 'walk',
      title: `Add a ${dur}-min brisk walk`,
      detail: `Burns ~${Math.round(kpm * dur)} kcal at your current weight.`,
      apply: async () => {
        await DB.logExercise({
          date: todayISO(),
          time: nowHHMM(),
          exercise_name: 'Brisk walking',
          sets: 0, reps: 0,
          duration_min: dur,
          kcal_burned: Math.round(kpm * dur),
          intensity: 'moderate'
        });
      }
    });
  }

  // B. Suggest skipping a typical evening snack
  const skip = findLikelyEveningSnack(todayFood);
  if (skip) {
    corrections.push({
      kind: 'skip',
      title: `Skip your evening snack`,
      detail: `Save ~${skip.kcal} kcal by skipping ${skip.name} today.`,
      apply: null  // user-driven
    });
  }

  // C. Lighter dinner swap
  const heaviest = findHeaviestMain(todayFood);
  if (heaviest) {
    corrections.push({
      kind: 'swap',
      title: `Lighter dinner: swap ${heaviest.item_name}`,
      detail: `Try 2 phulkas + 1 katori dal + salad (~${Math.max(0, heaviest.kcal - 150)} kcal saved).`,
      apply: null
    });
  } else {
    corrections.push({
      kind: 'lighter',
      title: 'Have a light dinner',
      detail: '2 phulkas + 1 katori dal + cucumber salad (~270 kcal). Skip rice/paratha tonight.',
      apply: null
    });
  }

  return corrections;
}

function findLikelyEveningSnack(todayFood) {
  const tea = todayFood.find(f => /chai|tea|coffee/i.test(f.item_name) && f.kcal > 40);
  if (tea) return { name: tea.item_name, kcal: tea.kcal };
  return { name: 'an evening snack', kcal: 120 };
}

function findHeaviestMain(todayFood) {
  const mains = todayFood.filter(f => f.kcal >= 200);
  mains.sort((a,b) => b.kcal - a.kcal);
  return mains[0] || null;
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
