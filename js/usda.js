// USDA FoodData Central lookup (free key from fdc.nal.usda.gov/api-key-signup).
// Returns nutrition per 100 g. Results are cached on the phone so each food is
// only looked up once.

const API = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const CACHE_KEY = 'plate.usdaCache';
const GENERIC = ['Survey (FNDDS)', 'SR Legacy', 'Foundation'];

function cache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } }
function remember(q, v) {
  const c = cache();
  c[q] = v;
  const keys = Object.keys(c);
  if (keys.length > 800) delete c[keys[0]];
  localStorage.setItem(CACHE_KEY, JSON.stringify(c));
}

function nutrient(food, numbers) {
  for (const num of numbers) {
    const n = food.foodNutrients?.find((x) => x.nutrientNumber === num);
    if (n && n.value != null) return Number(n.value);
  }
  return null;
}

function toResult(food) {
  const k = nutrient(food, ['208', '957', '958']);
  if (k == null) return null;
  const serving = food.servingSize && /^(g|grm|gram)/i.test(food.servingSizeUnit || '') ? Number(food.servingSize) : null;
  return {
    fdcId: food.fdcId,
    desc: food.description + (food.brandName || food.brandOwner ? ` (${food.brandName || food.brandOwner})` : ''),
    dataType: food.dataType,
    per100: { k, p: nutrient(food, ['203']) ?? 0, c: nutrient(food, ['205']) ?? 0, f: nutrient(food, ['204']) ?? 0 },
    serving,
  };
}

async function search(query, key, dataType) {
  const res = await fetch(`${API}?api_key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, pageSize: 5, dataType }),
  });
  if (res.status === 403) throw new Error('USDA key was rejected');
  if (res.status === 429) throw new Error('USDA rate limit reached, try again in an hour');
  if (!res.ok) throw new Error(`USDA error ${res.status}`);
  const data = await res.json();
  const odd = /\b(mix|powder|dry|dehydrated|concentrate|baby food|infant)\b/i;
  for (const f of data.foods || []) {
    if (odd.test(f.description || '') && !odd.test(query)) continue; // "gulab jamun" ≠ "gulab jamun mix"
    const r = toResult(f);
    if (r) return r;
  }
  return null;
}

/** Look up a food by name in generic foods, or in branded products if `branded`. */
export async function lookupUSDA(name, key, { branded = false } = {}) {
  const q = String(name || '').trim().toLowerCase();
  if (!q || !key) return null;
  const ck = (branded ? 'b:' : '') + q;
  const c = cache();
  if (ck in c) return c[ck];
  const r = await search(q, key, branded ? ['Branded'] : GENERIC);
  remember(ck, r);
  return r;
}

/** Quick check that a key works. */
export async function testUSDA(key) {
  const r = await search('apple raw', key, GENERIC);
  return !!r;
}
