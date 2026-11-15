// Gemini client (free key from aistudio.google.com → Get API key).
// The model is only asked WHAT is on the plate and HOW MANY GRAMS; calories are
// then looked up in the food databases (see ai.js).

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const PHOTO_PROMPT = `You are a precise food analyst for a calorie tracking app.
Identify every distinct food and drink visible in the photo, including cooking oil, butter, sauces, dressings, toppings and sides.
For each item estimate the edible weight in grams. Use visual scale cues: a dinner plate is ~26 cm, a side plate ~20 cm, a fork ~19 cm, a spoon ~15 cm, a can ~12 cm tall, a hand ~18 cm. Account for depth/height of piles, not just area.
Name foods specifically but plainly so they can be searched in a nutrition database (e.g. "white rice, cooked", "chicken tikka masala", "naan", "fried egg", "caesar salad with dressing").
Also give your own kcal/protein/carbs/fat estimate for each item at that weight (used only as a fallback).
If there is no food in the photo, return an empty items list and explain in "note".`;

const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    grams: { type: 'NUMBER' },
    kcal: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    confidence: { type: 'NUMBER' },
  },
  required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
};
const PHOTO_SCHEMA = {
  type: 'OBJECT',
  properties: { meal_name: { type: 'STRING' }, items: { type: 'ARRAY', items: ITEM_SCHEMA }, note: { type: 'STRING' } },
  required: ['meal_name', 'items'],
};
const REVISE_SCHEMA = {
  type: 'OBJECT',
  properties: { reply: { type: 'STRING' }, servings: { type: 'NUMBER' }, items: { type: 'ARRAY', items: ITEM_SCHEMA } },
  required: ['reply', 'servings', 'items'],
};

function friendlyError(status, msg) {
  if (status === 400 && /api key/i.test(msg)) return 'Gemini key is not valid';
  if (status === 403) return 'Gemini key was rejected (check it in AI Studio)';
  if (status === 404) return 'Gemini model not found — tap "Save & test" in Settings again';
  if (status === 429) return 'Gemini free limit reached for now — try again later';
  return `Gemini error ${status}${msg ? ': ' + msg.slice(0, 120) : ''}`;
}

async function call(model, key, body) {
  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, data?.error?.message || ''));
  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text) throw new Error('Gemini returned an empty answer');
  try { return JSON.parse(text); } catch { throw new Error('Gemini returned an unreadable answer'); }
}

const imagePart = (dataUrl) => {
  const [head, b64] = dataUrl.split(',');
  return { inline_data: { mime_type: head.match(/data:(.*?);/)?.[1] || 'image/jpeg', data: b64 } };
};

/** Pick the newest stable Flash model this key can use. */
export async function pickModel(key) {
  const res = await fetch(`${BASE}/models?pageSize=200&key=${encodeURIComponent(key)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, data?.error?.message || ''));
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  if (names.includes('gemini-flash-latest')) return 'gemini-flash-latest';
  const flash = names.filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(lite|image|tts|audio|live|embedding|thinking|8b)/.test(n));
  const stable = flash.filter((n) => !/(preview|exp)/.test(n));
  const pool = stable.length ? stable : flash;
  const ver = (n) => parseFloat(n.match(/gemini-([\d.]+)/)?.[1] || '0');
  pool.sort((a, b) => ver(b) - ver(a) || a.length - b.length);
  if (!pool.length) throw new Error('No Gemini Flash model available for this key');
  return pool[0];
}

/** Photo → { meal_name, items:[{name, grams, kcal, protein, carbs, fat}], note } */
export async function analyzePhotoGemini(dataUrl, key, model) {
  return call(model, key, {
    contents: [{ role: 'user', parts: [imagePart(dataUrl), { text: PHOTO_PROMPT }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: PHOTO_SCHEMA },
  });
}

/** Chat correction → { reply, servings, items } (the full updated list). */
export async function reviseGemini(meal, message, key, model) {
  const current = meal.items.map((i) => ({ name: i.name, grams: Math.round(i.grams) }));
  const prompt = `${meal.photo ? 'The photo shows the meal. ' : ''}Current items on the plate (JSON): ${JSON.stringify(current)}
Servings eaten (fraction of the whole plate): ${meal.servings || 1}
The user says: "${message}"

Apply the user's correction. Return the COMPLETE updated items list. Keep the exact same "name" for items that did not change so they keep their nutrition data. Add, remove, rename or change grams only as the user asks (and fix anything clearly implied). Set "servings" if the user says they ate only part of it or shared it, otherwise keep ${meal.servings || 1}.
In "reply", tell the user in one or two short friendly sentences what you changed. If the message is a question, answer it in "reply" and leave items unchanged.`;
  const parts = meal.photo ? [imagePart(meal.photo), { text: prompt }] : [{ text: prompt }];
  return call(model, key, {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: REVISE_SCHEMA },
  });
}
