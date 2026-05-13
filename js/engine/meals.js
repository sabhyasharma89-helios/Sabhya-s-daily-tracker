import * as DB from '../db.js';
import { inferMealSlot, todayISO, isoOffset } from '../utils.js';

const SLOT_FRACTIONS = {
  breakfast: 0.25,
  mid_morning: 0.10,
  lunch: 0.30,
  evening_snack: 0.10,
  dinner: 0.25,
  other: 0.10
};

const SLOT_PREFERRED_CATEGORIES = {
  breakfast: ['indian_main','dairy','grain','beverage','fruit','nuts'],
  mid_morning: ['fruit','nuts','beverage','indian_snack','dairy'],
  lunch: ['indian_main','dal','vegetable','dairy','grain'],
  evening_snack: ['nuts','fruit','beverage','indian_snack','dairy'],
  dinner: ['indian_main','dal','vegetable','dairy'],
  other: ['beverage','fruit','nuts','dairy']
};

const SLOT_PREFERRED_NAMES = {
  breakfast: /(idli|dosa|upma|poha|chilla|oats|muesli|daliya|paratha|paneer|greek yogurt|sprouts|paneer bhurji|toast|chai|coffee)/i,
  mid_morning: /(fruit|banana|apple|orange|chai|coffee|nuts|almond|walnut|makhana|chana|sprouts|buttermilk|coconut|guava)/i,
  lunch: /(roti|rice|dal|sabzi|paneer|rajma|chole|khichdi|curd|salad|sambhar|quinoa)/i,
  evening_snack: /(chana|makhana|fruit|chai|coffee|nuts|sprouts|cucumber|buttermilk|chaas|guava)/i,
  dinner: /(roti|sabzi|dal|paneer|curd|salad|khichdi|quinoa|vegetable|soup|tofu)/i,
  other: /./
};

function caseScore(food, slot, kcalBudget, proteinDeficit, recentNames) {
  let score = 0;

  // 1. Calorie proximity (closer to budget = better)
  const kcalDist = Math.abs(food.kcal_per_serving - kcalBudget);
  score -= kcalDist * 0.05;
  // strong penalty if it blows past 1.5x budget
  if (food.kcal_per_serving > kcalBudget * 1.5 && kcalBudget > 50) score -= 30;

  // 2. Protein contribution if deficit
  if (proteinDeficit > 5) {
    score += (food.protein_g || 0) * 1.2;
  } else {
    score += (food.protein_g || 0) * 0.3;
  }

  // 3. Fiber for satiety
  score += (food.fiber_g || 0) * 0.5;

  // 4. Slot category match
  if (SLOT_PREFERRED_CATEGORIES[slot]?.includes(food.category)) score += 8;

  // 5. Slot name match
  if (SLOT_PREFERRED_NAMES[slot]?.test(food.name)) score += 6;

  // 6. Tags
  const tags = food.tags || [];
  if (tags.includes('high_protein')) score += 3;
  if (tags.includes('high_fiber')) score += 2;
  if (tags.includes('low_gi')) score += 2;
  if (tags.includes('low_kcal') && kcalBudget < 200) score += 4;
  if (tags.includes('indulgent')) score -= 5;
  if (tags.includes('starter')) score += 1;

  // 7. Novelty — penalize if eaten in last 3 days
  if (recentNames.has(food.name.toLowerCase())) score -= 10;

  return score;
}

/**
 * Suggest 3 next-meal options + 1 plate combo
 */
export async function suggestNextMeal({ kcalRemaining, proteinSoFar, proteinTarget, now = new Date() }) {
  const slot = inferMealSlot(now);
  const frac = SLOT_FRACTIONS[slot] ?? 0.15;
  const dailyMaxRemaining = Math.max(kcalRemaining, 0);
  const kcalBudget = Math.max(80, Math.round(Math.min(dailyMaxRemaining, dailyMaxRemaining * 0.6 + 100)));
  const proteinDeficit = Math.max(0, proteinTarget - proteinSoFar);

  // recent items (last 3 days)
  const recentLog = await DB.getRecentFoodLog(3);
  const recentNames = new Set(recentLog.map(r => r.item_name.toLowerCase()));

  const foods = await DB.getAllFoods();
  const scored = foods.map(f => ({ f, score: caseScore(f, slot, kcalBudget, proteinDeficit, recentNames) }));
  scored.sort((a,b) => b.score - a.score);

  const singles = scored.slice(0, 3).map(s => s.f);

  // combo: try to build a 2-3 item plate close to kcalBudget*1.3
  const comboBudget = Math.max(250, Math.round(kcalBudget * 1.5));
  const combo = buildCombo(foods, slot, comboBudget, proteinDeficit, recentNames);

  return { slot, kcalBudget, singles, combo };
}

function buildCombo(foods, slot, budget, proteinDeficit, recentNames) {
  if (slot === 'lunch' || slot === 'dinner') {
    const carb = pickByCategory(foods, ['indian_main'], slot, recentNames, /(roti|phulka|rice|khichdi)/i);
    const protein = pickByCategory(foods, ['dal','indian_main'], slot, recentNames, /(dal|rajma|chole|paneer|tofu|sprouts|chickpea|lobia)/i);
    const veg = pickByCategory(foods, ['vegetable'], slot, recentNames);
    const items = [carb, protein, veg].filter(Boolean);
    return composeCombo(items, budget);
  }
  if (slot === 'breakfast') {
    const main = pickByCategory(foods, ['indian_main'], slot, recentNames, /(oats|idli|dosa|upma|poha|chilla|paratha|paneer|toast|muesli)/i);
    const protein = pickByCategory(foods, ['dairy','dal'], slot, recentNames, /(greek|paneer|sprouts|milk)/i);
    return composeCombo([main, protein].filter(Boolean), budget);
  }
  if (slot === 'evening_snack' || slot === 'mid_morning') {
    const a = pickByCategory(foods, ['nuts','indian_snack'], slot, recentNames, /(chana|makhana|nuts|almond)/i);
    const b = pickByCategory(foods, ['fruit','beverage'], slot, recentNames);
    return composeCombo([a, b].filter(Boolean), budget);
  }
  return null;
}

function pickByCategory(foods, cats, slot, recentNames, nameRegex) {
  const candidates = foods.filter(f => cats.includes(f.category) && (!nameRegex || nameRegex.test(f.name)));
  candidates.sort((a,b) => {
    let sa = 0, sb = 0;
    if (recentNames.has(a.name.toLowerCase())) sa -= 10;
    if (recentNames.has(b.name.toLowerCase())) sb -= 10;
    if ((a.tags||[]).includes('indulgent')) sa -= 5;
    if ((b.tags||[]).includes('indulgent')) sb -= 5;
    sa += (a.protein_g||0);
    sb += (b.protein_g||0);
    return sb - sa;
  });
  return candidates[0];
}

function composeCombo(items, budget) {
  if (!items.length) return null;
  const totalKcal = items.reduce((s,i) => s + i.kcal_per_serving, 0);
  const totalP = items.reduce((s,i) => s + (i.protein_g||0), 0);
  const ratio = Math.min(1.4, Math.max(0.6, budget / totalKcal));
  return {
    items,
    estimated_kcal: Math.round(totalKcal * ratio),
    estimated_protein_g: Math.round(totalP * ratio),
    portion_note: ratio < 0.9 ? 'eat slightly smaller portions' : ratio > 1.15 ? 'normal-to-generous portions' : 'normal portions'
  };
}

/**
 * Quick swap suggestion when over budget.
 */
export async function suggestSwap(currentItem, targetSaveKcal) {
  const foods = await DB.getAllFoods();
  const sameCategory = foods.filter(f =>
    f.category === currentItem.category &&
    f.name !== currentItem.name &&
    f.kcal_per_serving <= currentItem.kcal_per_serving - Math.min(50, targetSaveKcal * 0.7)
  );
  sameCategory.sort((a,b) => (b.protein_g||0) - (a.protein_g||0));
  return sameCategory[0] || null;
}
