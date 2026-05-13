import { openDB } from 'idb';
import { SEED_FOODS } from './data/foods.js';
import { SEED_EXERCISES } from './data/exercises.js';

const DB_NAME = 'fitcoach';
const DB_VERSION = 1;

let _db;

export async function getDB() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('weight_log')) {
        const s = db.createObjectStore('weight_log', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('food_log')) {
        const s = db.createObjectStore('food_log', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('water_log')) {
        const s = db.createObjectStore('water_log', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('exercise_log')) {
        const s = db.createObjectStore('exercise_log', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('daily_summary')) {
        db.createObjectStore('daily_summary', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('chat_history')) {
        const s = db.createObjectStore('chat_history', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('food_database')) {
        const s = db.createObjectStore('food_database', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name');
        s.createIndex('category', 'category');
      }
      if (!db.objectStoreNames.contains('exercise_database')) {
        const s = db.createObjectStore('exercise_database', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('weekly_review')) {
        db.createObjectStore('weekly_review', { keyPath: 'week_start' });
      }
      if (!db.objectStoreNames.contains('app_meta')) {
        db.createObjectStore('app_meta', { keyPath: 'key' });
      }
    }
  });
  await seedIfEmpty(_db);
  return _db;
}

async function seedIfEmpty(db) {
  const fdCount = await db.count('food_database');
  if (fdCount === 0) {
    const tx = db.transaction('food_database', 'readwrite');
    for (const f of SEED_FOODS) await tx.store.add(f);
    await tx.done;
  }
  const edCount = await db.count('exercise_database');
  if (edCount === 0) {
    const tx = db.transaction('exercise_database', 'readwrite');
    for (const e of SEED_EXERCISES) await tx.store.add(e);
    await tx.done;
  }
}

// ---------- Profile ----------
export async function getProfile() {
  const db = await getDB();
  return db.get('profile', 1);
}
export async function saveProfile(p) {
  const db = await getDB();
  p.id = 1;
  return db.put('profile', p);
}

// ---------- Weight ----------
export async function logWeight({ date, weight_kg, body_fat_pct, visceral_fat_rating, notes }) {
  const db = await getDB();
  const profile = await getProfile();
  const h = profile.height_cm / 100;
  const bmi = +(weight_kg / (h * h)).toFixed(1);
  return db.put('weight_log', { date, weight_kg, bmi, body_fat_pct, visceral_fat_rating, notes });
}
export async function getWeight(date) {
  const db = await getDB();
  return db.get('weight_log', date);
}
export async function getAllWeights() {
  const db = await getDB();
  const rows = await db.getAll('weight_log');
  return rows.sort((a,b) => a.date.localeCompare(b.date));
}
export async function getRecentWeights(days = 30) {
  const all = await getAllWeights();
  return all.slice(-days);
}
export async function deleteWeight(date) {
  const db = await getDB();
  return db.delete('weight_log', date);
}

// ---------- Food log ----------
export async function logFood(entry) {
  const db = await getDB();
  return db.add('food_log', entry);
}
export async function getFoodLog(date) {
  const db = await getDB();
  return db.getAllFromIndex('food_log', 'date', date);
}
export async function deleteFoodLog(id) {
  const db = await getDB();
  return db.delete('food_log', id);
}
export async function getRecentFoodLog(days = 7) {
  const db = await getDB();
  const all = await db.getAll('food_log');
  const cutoff = isoDateOffset(-days);
  return all.filter(r => r.date >= cutoff);
}

// ---------- Water ----------
export async function logWater(entry) {
  const db = await getDB();
  return db.add('water_log', entry);
}
export async function getWaterLog(date) {
  const db = await getDB();
  return db.getAllFromIndex('water_log', 'date', date);
}
export async function deleteWaterLog(id) {
  const db = await getDB();
  return db.delete('water_log', id);
}

// ---------- Exercise ----------
export async function logExercise(entry) {
  const db = await getDB();
  return db.add('exercise_log', entry);
}
export async function getExerciseLog(date) {
  const db = await getDB();
  return db.getAllFromIndex('exercise_log', 'date', date);
}
export async function deleteExerciseLog(id) {
  const db = await getDB();
  return db.delete('exercise_log', id);
}

// ---------- Food database ----------
export async function searchFoods(query, limit = 30) {
  const db = await getDB();
  const all = await db.getAll('food_database');
  if (!query) return all.slice(0, limit);
  const q = query.toLowerCase();
  return all.filter(f => f.name.toLowerCase().includes(q)).slice(0, limit);
}
export async function getAllFoods() {
  const db = await getDB();
  return db.getAll('food_database');
}
export async function addCustomFood(food) {
  const db = await getDB();
  food.source = food.source || 'custom';
  return db.add('food_database', food);
}

// ---------- Exercise database ----------
export async function getAllExercises() {
  const db = await getDB();
  return db.getAll('exercise_database');
}
export async function searchExercises(query, limit = 30) {
  const db = await getDB();
  const all = await db.getAll('exercise_database');
  if (!query) return all.slice(0, limit);
  const q = query.toLowerCase();
  return all.filter(e => e.name.toLowerCase().includes(q)).slice(0, limit);
}

// ---------- Chat ----------
export async function saveChatMessage(msg) {
  const db = await getDB();
  return db.add('chat_history', msg);
}
export async function getChatHistory(limit = 50) {
  const db = await getDB();
  const all = await db.getAll('chat_history');
  return all.slice(-limit);
}
export async function clearChatHistory() {
  const db = await getDB();
  return db.clear('chat_history');
}

// ---------- Meta ----------
export async function setMeta(key, value) {
  const db = await getDB();
  return db.put('app_meta', { key, value });
}
export async function getMeta(key) {
  const db = await getDB();
  const r = await db.get('app_meta', key);
  return r ? r.value : null;
}

// ---------- Export / Import ----------
export async function exportAllData() {
  const db = await getDB();
  const stores = ['profile','weight_log','food_log','water_log','exercise_log','daily_summary','chat_history','food_database','exercise_database','weekly_review','app_meta'];
  const out = { version: 1, exported_at: new Date().toISOString() };
  for (const s of stores) out[s] = await db.getAll(s);
  return out;
}
export async function importAllData(data, mode = 'replace') {
  const db = await getDB();
  const stores = ['profile','weight_log','food_log','water_log','exercise_log','daily_summary','chat_history','food_database','exercise_database','weekly_review','app_meta'];
  for (const s of stores) {
    if (!data[s]) continue;
    const tx = db.transaction(s, 'readwrite');
    if (mode === 'replace') await tx.store.clear();
    for (const row of data[s]) {
      try { await tx.store.put(row); } catch (e) { /* skip dup */ }
    }
    await tx.done;
  }
}
export async function clearAllData() {
  const db = await getDB();
  const stores = ['profile','weight_log','food_log','water_log','exercise_log','daily_summary','chat_history','food_database','exercise_database','weekly_review','app_meta'];
  for (const s of stores) {
    const tx = db.transaction(s, 'readwrite');
    await tx.store.clear();
    await tx.done;
  }
}

// ---------- utils ----------
function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
