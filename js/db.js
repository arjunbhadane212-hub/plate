// On-device database (IndexedDB). Nothing leaves the phone.
// meals: { id, ts, day:'YYYY-MM-DD', name, photo, items[], servings, chat[], source }

const DB_NAME = 'plate';
const VERSION = 1;
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meals')) {
          const s = db.createObjectStore('meals', { keyPath: 'id' });
          s.createIndex('day', 'day');
        }
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(mode, name = 'meals') { return (await open()).transaction(name, mode).objectStore(name); }

export async function saveMeal(m) { return wrap((await store('readwrite')).put(m)); }
export async function getMeal(id) { return wrap((await store('readonly')).get(id)); }
export async function deleteMeal(id) {
  await wrap((await store('readwrite', 'photos')).delete(id));
  return wrap((await store('readwrite')).delete(id));
}
// full-size photos live in their own store so lists/stats stay light
export async function savePhoto(id, data) { return wrap((await store('readwrite', 'photos')).put({ id, data })); }
export async function getPhoto(id) { return (await wrap((await store('readonly', 'photos')).get(id)))?.data || null; }
export async function mealsByDay(day) {
  const list = await wrap((await store('readonly')).index('day').getAll(day));
  return list.sort((a, b) => a.ts - b.ts);
}
export async function mealsInRange(startDay, endDay) {
  return wrap((await store('readonly')).index('day').getAll(IDBKeyRange.bound(startDay, endDay)));
}
/** Set of all day keys that have at least one meal (cheap: keys only). */
export async function loggedDays() {
  const idx = (await store('readonly')).index('day');
  return new Promise((res, rej) => {
    const days = new Set();
    const r = idx.openKeyCursor(null, 'nextunique');
    r.onsuccess = () => { const c = r.result; if (c) { days.add(c.key); c.continue(); } else res(days); };
    r.onerror = () => rej(r.error);
  });
}
export async function allMeals() { return wrap((await store('readonly')).getAll()); }
export async function clearMeals() {
  await wrap((await store('readwrite', 'photos')).clear());
  return wrap((await store('readwrite')).clear());
}
export async function putMany(list) {
  const s = await store('readwrite');
  await Promise.all(list.map((m) => wrap(s.put(m))));
}

// ---------- settings (small, so localStorage) ----------
const SKEY = 'plate.settings';
export const DEFAULT_SETTINGS = {
  goals: { k: 2000, p: 150, c: 200, f: 65 },
  profile: { sex: 'male', age: 25, height: 175, weight: 75, activity: 1.55, goal: 'maintain', units: 'metric' },
  ai: { geminiKey: '', usdaKey: '', model: '', context: '' },
};
export function getSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...s, goals: { ...DEFAULT_SETTINGS.goals, ...s.goals }, profile: { ...DEFAULT_SETTINGS.profile, ...s.profile }, ai: { ...DEFAULT_SETTINGS.ai, ...s.ai } };
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}
export function saveSettings(s) { localStorage.setItem(SKEY, JSON.stringify(s)); }

/** Ask the browser not to evict our data. */
export async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
