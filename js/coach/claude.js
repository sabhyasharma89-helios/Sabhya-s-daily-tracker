import { getCtx, todaySnapshot } from '../state.js';
import * as DB from '../db.js';
import { isoOffset, todayISO } from '../utils.js';

const SYMPTOM_RX = /\b(pain|hurt|sore|dizzy|fatigue|palpitation|chest|breathless|thyroid|fatty liver|diabetes|sugar (high|low)|blood pressure|bp|cholesterol|asthma|migraine|nausea|vomit|fever|injury|knee)\b/i;
const MED_DISCLAIMER = "This sounds like something to discuss with your doctor. I'll keep tracking the diet and exercise side — please don't substitute this app for medical advice.";

const SYSTEM_TEMPLATE = (vars) => `You are FitCoach, a personal vegetarian dietitian and home-workout trainer for ${vars.name}, a ${vars.age}-year-old Indian ${vars.sex}, ${vars.height_ft_in}, currently ${vars.current_weight} kg, targeting ${vars.target_weight} kg by ${vars.target_date}.

He is pure vegetarian, no eggs. Indian home cuisine. Sedentary lifestyle (CA practice + entrepreneur). No gym, no equipment, occasional outdoor walks in Gurgaon.

Today's data:
- Weight: ${vars.current_weight} kg | BMI: ${vars.bmi} | Target: ${vars.target_weight} kg
- Calories: ${vars.kcal_in} in / ${vars.kcal_burned} burned / target ${vars.kcal_target} / remaining ${vars.kcal_remaining}
- Macros so far: ${vars.protein_g}g protein, ${vars.carbs_g}g carbs, ${vars.fat_g}g fat
- Water: ${vars.water_ml} ml of ${vars.water_target} ml
- Meals so far: ${vars.meal_list || 'none yet'}
- Exercise so far: ${vars.exercise_list || 'none yet'}

Last 7 days summary: ${vars.weekly_summary || 'no recent data'}

Be direct, output-first, no fluff. Use grams and kcal precisely. Suggest Indian vegetarian foods he actually eats (no eggs/meat/fish). If he reports a slip-up, give a concrete corrective action, not a lecture. If he asks medical questions, recommend he consult his doctor — do not give medical advice. Keep replies under 200 words unless he asks for a full plan.`;

async function buildSystemPrompt() {
  const ctx = getCtx();
  const snap = await todaySnapshot();
  const profile = ctx.profile;

  // Height in ft/in for prompt
  const totalIn = ctx.profile.height_cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - ft * 12);

  // Last 7 days summary
  const weights = ctx.weights || [];
  const last7 = weights.slice(-7);
  let weekly = '';
  if (last7.length >= 2) {
    const start = last7[0].weight_kg;
    const end = last7[last7.length-1].weight_kg;
    weekly = `${last7.length} weigh-ins, ${(end-start).toFixed(2)} kg change.`;
  }

  return SYSTEM_TEMPLATE({
    name: profile.name,
    age: profile.age_years,
    sex: profile.sex,
    height_ft_in: `${ft}'${inches}"`,
    current_weight: ctx.current_weight_kg.toFixed(1),
    target_weight: profile.target_weight_kg,
    target_date: profile.target_date,
    bmi: (ctx.current_weight_kg / Math.pow(profile.height_cm/100, 2)).toFixed(1),
    kcal_in: Math.round(snap.kcal_in),
    kcal_burned: Math.round(snap.kcal_burned),
    kcal_target: snap.kcal_target,
    kcal_remaining: Math.round(snap.kcal_remaining_for_target),
    protein_g: Math.round(snap.protein_g),
    carbs_g: Math.round(snap.carbs_g),
    fat_g: Math.round(snap.fat_g),
    water_ml: snap.water_ml,
    water_target: ctx.targets.daily_water_target_ml,
    meal_list: snap.food.map(f => `${f.item_name} (${f.kcal}kcal)`).join('; '),
    exercise_list: snap.exercise.map(e => `${e.exercise_name} (${e.kcal_burned}kcal)`).join('; '),
    weekly_summary: weekly
  });
}

export async function askClaude(apiKey, model, userMessage, history) {
  if (SYMPTOM_RX.test(userMessage)) {
    return MED_DISCLAIMER;
  }

  const system = await buildSystemPrompt();
  const messages = [];
  // Include up to last 10 exchanges for continuity
  const recent = history.slice(-10);
  for (const m of recent) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const body = {
    model: model || 'claude-sonnet-4-5',
    max_tokens: 800,
    temperature: 0.4,
    system,
    messages
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  return text || '(no response)';
}
