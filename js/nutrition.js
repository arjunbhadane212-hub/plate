// Food matching, quantity parsing, and nutrition math.
import { FOODS, FOOD_BY_ID } from './foods.js';
import { uid } from './util.js';

// ---------- text normalisation ----------
function sing(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}
export function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9%.\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(sing)
    .join(' ');
}

const STOP = new Set(['of', 'the', 'a', 'an', 'some', 'my', 'with', 'and', 'on', 'in', 'side', 'piece', 'bit', 'little', 'big', 'small', 'large', 'medium', 'cup', 'bowl', 'plate', 'slice', 'serving', 'portion', 'homemade', 'fresh', 'cooked', 'plain']);

// longest alias first so "chicken curry" beats "chicken"
const INDEX = FOODS.flatMap((f) => [f.n, ...(f.a || [])].map((a) => ({ f, key: norm(a) })))
  .filter((e) => e.key)
  .sort((x, y) => y.key.length - x.key.length);

/** Find the best database food mentioned in `text`. Returns food or null. */
export function findFood(text) {
  const t = ' ' + norm(text) + ' ';
  for (const e of INDEX) if (t.includes(' ' + e.key + ' ')) return e.f;
  // fuzzy fallback: token overlap
  const toks = new Set(norm(text).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
  if (!toks.size) return null;
  let best = null, bestScore = 0;
  for (const e of INDEX) {
    const kt = e.key.split(' ');
    const hit = kt.filter((w) => toks.has(w)).length;
    const score = hit / kt.length;
    if (hit && score > bestScore) { best = e.f; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

/** Search for the settings/manual picker. */
export function searchFoods(q, limit = 8) {
  const t = norm(q);
  if (!t) return [];
  const seen = new Set(), out = [];
  for (const e of [...INDEX].sort((a, b) => a.key.length - b.key.length)) {
    if (e.key.includes(t) && !seen.has(e.f.id)) { seen.add(e.f.id); out.push(e.f); }
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- quantities ----------
const NUMWORDS = { a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, few: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, half: 0.5, quarter: 0.25, another: 1 };
const UNIT_ALIASES = {
  g: 'g', gr: 'g', gram: 'g', grams: 'g', gm: 'g', gms: 'g', kg: 'kg', kilo: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml', l: 'l', liter: 'l', litre: 'l',
  cup: 'cup', cups: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', bowl: 'bowl', bowls: 'bowl',
  plate: 'plate', plates: 'plate', glass: 'glass', glasses: 'glass', can: 'can', cans: 'can',
  bottle: 'bottle', bottles: 'bottle', scoop: 'scoop', scoops: 'scoop', handful: 'handful', handfuls: 'handful',
  serving: 'serving', servings: 'serving', portion: 'serving', portions: 'serving', helping: 'serving', helpings: 'serving',
  bar: 'bar', bars: 'bar', square: 'square', squares: 'square', mug: 'mug', mugs: 'mug', shot: 'shot', shots: 'shot',
  pint: 'pint', pints: 'pint', pack: 'pack', packet: 'pack', packs: 'pack', bag: 'bag', bags: 'bag', roll: 'roll', rolls: 'roll',
  leaf: 'leaf', leaves: 'leaf', pat: 'pat', pats: 'pat', link: 'link', links: 'link', cube: 'cube', cubes: 'cube',
};
const MASS = { g: 1, kg: 1000, oz: 28.35, lb: 453.6, ml: 1, l: 1000 };
const GENERIC_UNIT = { cup: 240, tbsp: 15, tsp: 5, bowl: 250, plate: 350, glass: 250, can: 355, bottle: 500, mug: 300, handful: 28, slice: 30, scoop: 30, shot: 44, pint: 568, bag: 30, square: 10, pat: 5, cube: 4 };
const SIZE = { 'extra large': 1.6, tiny: 0.5, small: 0.7, little: 0.7, medium: 1, regular: 1, normal: 1, large: 1.3, big: 1.3, huge: 1.7, 'extra large': 1.6, xl: 1.6, giant: 1.8 };

const UNICODE_FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseNumber(tok) {
  if (tok == null) return null;
  if (UNICODE_FRAC[tok] != null) return UNICODE_FRAC[tok];
  if (/^\d+\/\d+$/.test(tok)) { const [a, b] = tok.split('/').map(Number); return b ? a / b : null; }
  if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
  if (NUMWORDS[tok] != null) return NUMWORDS[tok];
  return null;
}

/**
 * Parse one phrase like "2 slices of pizza", "150g chicken", "a large banana",
 * "chicken 200 g", "half a cup of rice", "protein bar 210 kcal".
 * Returns { food, name, grams, kcalOverride, explicitQty, unitLabel, count } or null.
 */
export function parsePhrase(raw, { withContext = false } = {}) {
  let s = ' ' + raw.toLowerCase().replace(/[½¼¾⅓⅔]/g, (m) => ' ' + m + ' ').replace(/(\d)\s*(?=[a-z])/g, '$1 ') + ' ';
  s = s.replace(/\s+/g, ' ');

  // explicit calories: "250 kcal", "300 calories"
  let kcalOverride = null;
  s = s.replace(/(\d+(?:\.\d+)?)\s*(kcal|kcals|calories|calorie|cals|cal)\b/, (_, n) => { kcalOverride = parseFloat(n); return ' '; });

  // size words
  let sizeMul = 1;
  for (const [w, m] of Object.entries(SIZE)) {
    const re = new RegExp(`\\b${w}\\b`);
    if (re.test(s)) { sizeMul = m; s = s.replace(re, ' '); break; }
  }

  // quantity + unit anywhere: "1 1/2 cups", "200 g", "half a", "2"
  let qty = null, unit = null;
  const toks = s.trim().split(' ');
  for (let i = 0; i < toks.length; i++) {
    let n = parseNumber(toks[i]);
    if (n == null) continue;
    let j = i + 1;
    // mixed number "1 1/2"
    const n2 = parseNumber(toks[j]);
    if (n2 != null && n2 < 1 && /\//.test(toks[j] || '') ) { n += n2; j++; }
    // "half a cup" / "half an apple"
    if ((toks[i] === 'half' || toks[i] === 'quarter') && (toks[j] === 'a' || toks[j] === 'an' || toks[j] === 'of')) j++;
    if (toks[j] === 'of') j++;
    const u = UNIT_ALIASES[toks[j]];
    if (u) { unit = u; j++; if (toks[j] === 'of') j++; }
    // skip words like "a" that are actually articles when another number follows ("a 200g steak")
    if ((toks[i] === 'a' || toks[i] === 'an') && !u && parseNumber(toks[i + 1]) != null && toks[i + 1] !== 'a') continue;
    qty = n;
    toks.splice(i, j - i);
    break;
  }
  const rest = toks.join(' ').trim();
  const food = findFood(rest);
  const name = cleanName(rest);
  if (!food && !kcalOverride) return { food: null, name, unknown: true };

  // resolve grams
  let grams, unitLabel = null, explicitQty = qty != null || unit != null;
  const q = qty ?? 1;
  if (unit && MASS[unit]) {
    grams = q * MASS[unit];
  } else if (unit === 'serving') {
    grams = q * (food ? food.s : 100);
  } else if (unit) {
    const ug = food?.u?.[unit] ?? GENERIC_UNIT[unit] ?? (food ? food.s : 100);
    grams = q * ug;
    unitLabel = unit;
  } else if (food) {
    if (food.u?.piece && qty != null && Number.isInteger(qty)) {
      grams = q * food.u.piece;
      unitLabel = 'piece';
    } else if (withContext && qty == null && food.ws) {
      grams = food.ws;
    } else {
      grams = q * food.s;
    }
  } else {
    grams = 100;
  }
  grams = Math.round(grams * sizeMul);
  return { food, name, grams, kcalOverride, explicitQty, unitLabel, count: unitLabel ? q : null };
}

function cleanName(s) {
  const w = s.replace(/\b(of|the|some|my|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return w ? w[0].toUpperCase() + w.slice(1) : '';
}

// ---------- items ----------
/** Create a meal item from a DB food. */
export function itemFromFood(food, grams, extra = {}) {
  return {
    id: uid(),
    foodId: food.id,
    name: extra.name || food.n,
    grams: Math.max(1, Math.round(grams)),
    per100: { k: food.k, p: food.p, c: food.c, f: food.f },
    unit: pickUnit(food),
    source: extra.source || 'db',
  };
}
/** Create an item from free values (AI estimate or user-stated kcal). */
export function customItem(name, grams, per100, source = 'custom') {
  return { id: uid(), foodId: null, name, grams: Math.max(1, Math.round(grams)), per100, unit: null, source };
}

function pickUnit(food) {
  // prefer a natural counting unit for display
  for (const u of ['slice', 'bar', 'piece', 'scoop', 'can', 'tbsp', 'tsp', 'cup']) {
    if (food.u?.[u]) {
      // only use cup/tbsp when the default serving is expressed that way
      if ((u === 'cup' || u === 'tbsp' || u === 'tsp') && !String(food.sl).includes(u)) continue;
      return { name: u, grams: food.u[u] };
    }
  }
  return null;
}

/** Build an item from a parsed phrase. */
/** Use the user's own wording ("grilled chicken breast") when it's short and clean. */
export function niceName(p) {
  if (!p.food || !p.name) return p.food?.n;
  const words = p.name.split(' ');
  if (words.length > 4 || /\d/.test(p.name)) return p.food.n;
  return p.name;
}

export function itemFromParsed(p) {
  if (p.food) {
    const it = itemFromFood(p.food, p.grams, { name: niceName(p) });
    if (p.kcalOverride != null) {
      const ratio = p.kcalOverride / Math.max(1, (p.food.k * p.grams) / 100);
      it.per100 = scaleMacros(it.per100, ratio);
      it.source = 'user';
    }
    return it;
  }
  // unknown food but user stated calories: store as 1 serving of 100 "g"
  const grams = p.grams || 100;
  const k = (p.kcalOverride / grams) * 100;
  return customItem(p.name || 'Food', grams, { k, p: 0, c: 0, f: 0 }, 'user');
}

function scaleMacros(per100, r) {
  return { k: per100.k * r, p: per100.p * r, c: per100.c * r, f: per100.f * r };
}

export function itemTotals(it) {
  const m = it.grams / 100;
  return { k: it.per100.k * m, p: it.per100.p * m, c: it.per100.c * m, f: it.per100.f * m };
}

export function mealTotals(meal) {
  const t = { k: 0, p: 0, c: 0, f: 0 };
  for (const it of meal.items || []) {
    const x = itemTotals(it);
    t.k += x.k; t.p += x.p; t.c += x.c; t.f += x.f;
  }
  const s = meal.servings || 1;
  return { k: t.k * s, p: t.p * s, c: t.c * s, f: t.f * s };
}

export function sumTotals(list) {
  return list.reduce((a, t) => ({ k: a.k + t.k, p: a.p + t.p, c: a.c + t.c, f: a.f + t.f }), { k: 0, p: 0, c: 0, f: 0 });
}

export function amountLabel(it) {
  const g = Math.round(it.grams);
  if (it.unit) {
    const n = it.grams / it.unit.grams;
    const r = Math.round(n * 4) / 4;
    if (Math.abs(n - r) < 0.04 && r > 0) {
      const u = r <= 1 ? it.unit.name : plural(it.unit.name);
      return `${fmtQty(r)} ${u} · ${g} g`;
    }
  }
  return `${g} g`;
}
function plural(u) { return { piece: 'pieces', slice: 'slices', scoop: 'scoops', bar: 'bars', can: 'cans', tbsp: 'tbsp', tsp: 'tsp', cup: 'cups' }[u] || u + 's'; }
function fmtQty(n) {
  const whole = Math.floor(n), frac = n - whole;
  const f = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[Math.round(frac * 4) / 4] || '';
  return whole ? `${whole}${f}` : f || '0';
}

/** Step size for the +/- buttons on an item. */
export function itemStep(it) {
  if (it.unit) return it.unit.grams * (it.unit.grams >= 40 ? 0.5 : 1);
  if (it.grams >= 200) return 25;
  if (it.grams >= 60) return 10;
  return 5;
}

/**
 * Grounding: take items an AI model saw in a photo ({name, grams, kcal?, protein?, carbs?, fat?})
 * and prefer database nutrition whenever we recognise the food. The model's own
 * numbers are only used for foods we don't know. This is the main guard against
 * models making up calorie numbers.
 */
export function groundItems(aiItems) {
  return aiItems.map((a) => {
    const food = findFood(a.name || '');
    const grams = Number(a.grams) || (food ? food.s : 100);
    if (food) return itemFromFood(food, grams, { name: a.name ? cleanName(a.name) : food.n, source: 'ai+db' });
    const per = (v) => (Number(v) || 0) / grams * 100;
    return customItem(cleanName(a.name || 'Food'), grams, { k: per(a.kcal), p: per(a.protein), c: per(a.carbs), f: per(a.fat) }, 'ai');
  });
}

export { FOOD_BY_ID };
