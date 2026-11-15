// Gemini client (free key from aistudio.google.com → Get API key).
// Gemini identifies foods, portions and (for mixed dishes) ingredients; the
// calories are then looked up in food databases (see ai.js).

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const PART_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, grams: { type: 'NUMBER' },
    kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, carbs: { type: 'NUMBER' }, fat: { type: 'NUMBER' },
  },
  required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
};
const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: { ...PART_SCHEMA.properties, ingredients: { type: 'ARRAY', items: PART_SCHEMA } },
  required: PART_SCHEMA.required,
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

const RULES = `Rules for the items list:
- One item per DISH as a person would name it ("Chicken sabzi", "Dal tadka", "Roti", "Caesar salad"). Never split a dish into separate items.
- For mixed or home-cooked dishes (curries, sabzi, dal, stir-fries, rice dishes, salads, sandwiches, wraps, bowls) fill "ingredients" with each component and its grams, INCLUDING cooking oil/ghee/butter (estimate it if not stated — home-cooked Indian curries typically use 1–2 tsp oil per serving). The ingredient grams must add up to the dish "grams".
- Simple foods (a roti, an egg, rice, fruit, a drink) have no ingredients.
- Use plain, searchable ingredient names ("chicken thigh, cooked", "potato, boiled", "green peas", "onion", "vegetable oil", "ghee").
- kcal/protein/carbs/fat are your own estimates at that weight (they are only a fallback; the app looks up real values).`;

const photoPrompt = (context) => `You are a precise food analyst for a calorie tracking app.${context ? `\nAbout this user's food: ${context}` : ''}
Identify every distinct food and drink in the photo, including sauces, chutneys, dressings and sides.
Estimate edible weight in grams using scale cues: dinner plate ~26 cm, side plate/katori ~20/10 cm, fork ~19 cm, spoon ~15 cm, roti ~15–18 cm across, hand ~18 cm. Consider pile height, not just area.
${RULES}
"meal_name" is a short name for the whole meal. If there is no food, return an empty items list and say so in "note".`;

let noThinkCfg = false; // set if this model rejects thinkingConfig

function thinkingFor(model) {
  if (noThinkCfg) return null;
  if (/2\.5/.test(model)) return { thinkingBudget: 0 }; // 2.5 Flash: turn thinking off → much faster
  if (/gemini-3|latest/.test(model)) return { thinkingLevel: 'low' };
  return null;
}

function friendlyError(status, msg) {
  if (status === 400 && /api key/i.test(msg)) return 'Gemini key is not valid';
  if (status === 403) return 'Gemini key was rejected (check it in AI Studio)';
  if (status === 404) return 'Gemini model not found — tap "Save & test" in Settings again';
  if (status === 429) return 'Gemini free limit reached for now — try again in a bit';
  if (status >= 500) return 'Gemini is busy right now — try again';
  return `Gemini error ${status}${msg ? ': ' + msg.slice(0, 120) : ''}`;
}

async function call(model, key, body) {
  const thinking = thinkingFor(model);
  const send = (b) => fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  });
  let res = await send(thinking ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: thinking } } : body);
  let data = await res.json().catch(() => ({}));
  if (thinking && res.status === 400 && /think/i.test(data?.error?.message || '')) {
    noThinkCfg = true; // this model doesn't accept that setting; retry plainly
    res = await send(body);
    data = await res.json().catch(() => ({}));
  }
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

/** Photo → { meal_name, items:[{name, grams, kcal, …, ingredients?}], note } */
export async function analyzePhotoGemini(dataUrl, key, model, context = '') {
  return call(model, key, {
    contents: [{ role: 'user', parts: [imagePart(dataUrl), { text: photoPrompt(context) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: PHOTO_SCHEMA },
  });
}

/**
 * Conversational correction. `current` is the plate as [{name, grams, ingredients?}],
 * `history` the recent chat as [{role:'me'|'bot', text}].
 * → { reply, servings, items } (the full updated list)
 */
export async function reviseGemini({ photo, current, servings, history, message, context }, key, model) {
  const convo = history.map((m) => `${m.role === 'me' ? 'User' : 'Assistant'}: ${m.text.replace(/\nTotal:.*$/s, '')}`).join('\n');
  const prompt = `You are the friendly food-logging assistant inside a calorie tracker. The user is reviewing a meal${photo ? ' (photo attached)' : ''} and talking to you to get it right.${context ? `\nAbout this user's food: ${context}` : ''}

Current plate (JSON): ${JSON.stringify(current)}
Servings eaten (fraction of the plate): ${servings}
${convo ? `\nConversation so far:\n${convo}\n` : ''}
User: ${message}

Understand what the user means in context and update the plate:
- "remove X" removes it; "X has A, B and C" sets that dish's ingredients; "3 small chicken pieces in the sabzi" changes the chicken INSIDE that dish, it is not a new item; "it's not X, it's Y" renames/replaces; portion words change grams; "I ate half" or "shared with 2 people" sets servings.
- If the user names a dish that isn't listed yet, add it (with ingredients if it's a mixed dish).
- Keep the exact same name for things that didn't change.
${RULES}
- If the user only asks a question, answer it and return the plate unchanged.
Return the COMPLETE updated items list and the servings. "reply" is a short, natural answer (1–2 sentences) saying what you changed or asking ONE quick question if something is genuinely unclear.`;
  const parts = photo ? [imagePart(photo), { text: prompt }] : [{ text: prompt }];
  return call(model, key, {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: REVISE_SCHEMA },
  });
}
