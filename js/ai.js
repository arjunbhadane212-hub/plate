// Photo analysis + chat.
//
//  1. Gemini looks at the photo and says WHAT is on the plate, HOW MANY GRAMS,
//     and for mixed dishes WHAT'S IN THEM (incl. oil/ghee).
//  2. Calories/macros for each food or ingredient come from a real database:
//       USDA generic foods → built-in table → USDA branded → the model's own
//       estimate only as a last resort (tagged "AI EST.").
//     A dish's calories are the sum of its ingredients.
//  3. The chat is a real conversation with Gemini (it sees the photo, the
//     current plate and recent messages). Without a Gemini key, or if Gemini
//     fails, the offline rule-based engine takes over.
//
// Keys live only in this phone's Settings (localStorage), never in the code.

import { getSettings } from './db.js';
import { findFoodExact, itemFromFood, customItem, itemFromParts, scaledParts, cleanName } from './nutrition.js';
import { applyMessage, summary } from './chat.js';
import { lookupUSDA } from './usda.js';
import { analyzePhotoGemini, reviseGemini } from './gemini.js';
import { uid, shrinkDataUrl } from './util.js';

const cfg = () => getSettings().ai;
// an item needs a name and a weight (a dish's weight can come from its ingredients)
const usable = (a) => a?.name && (Number(a.grams) > 0 || (a.ingredients || []).some((i) => Number(i.grams) > 0));

/** Nutrition for one food/ingredient: {name, grams, per100, source, match?} */
async function groundPart(a, usdaKey) {
  const grams = Math.max(1, Math.round(Number(a.grams) || 100));
  const name = cleanName(a.name || 'Food');
  const aiPer100 = (Number(a.kcal) || 0) / grams * 100;
  const near = (u, lo, hi) => u && (aiPer100 < 25 || (u.per100.k > aiPer100 * lo && u.per100.k < aiPer100 * hi));
  const fromUSDA = (u) => ({ name, grams, per100: u.per100, source: 'usda', match: u.desc });
  if (usdaKey) {
    try { const u = await lookupUSDA(a.name, usdaKey); if (near(u, 1 / 3, 3)) return fromUSDA(u); }
    catch (e) { console.warn('USDA lookup failed', e); }
  }
  const food = findFoodExact(a.name || '');
  if (food) return { name, grams, per100: { k: food.k, p: food.p, c: food.c, f: food.f }, source: 'db', foodId: food.id };
  if (usdaKey) {
    try { const u = await lookupUSDA(a.name, usdaKey, { branded: true }); if (near(u, 0.6, 1.6)) return fromUSDA(u); }
    catch (e) { console.warn('USDA lookup failed', e); }
  }
  const per = (v) => (Number(v) || 0) / grams * 100;
  return { name, grams, per100: { k: per(a.kcal), p: per(a.protein), c: per(a.carbs), f: per(a.fat) }, source: 'ai' };
}

/**
 * Model item → meal item. `ex` is the existing item with the same name (if any),
 * whose nutrition is reused so a correction doesn't re-lookup everything.
 */
async function groundItem(a, usdaKey, ex) {
  const name = cleanName(a.name || 'Food');
  const ings = (a.ingredients || []).filter(usable);
  if (ings.length) {
    const old = new Map((ex?.parts ? scaledParts(ex) : []).map((p) => [p.name.toLowerCase(), p]));
    const parts = await Promise.all(ings.map(async (i) => {
      const prev = old.get(cleanName(i.name).toLowerCase());
      return prev ? { ...prev, grams: Math.max(1, Math.round(i.grams)) } : groundPart(i, usdaKey);
    }));
    return itemFromParts(name, parts, { id: ex?.id });
  }
  if (ex) return { ...ex, grams: Math.max(1, Math.round(Number(a.grams) || ex.grams)) };
  const p = await groundPart(a, usdaKey);
  if (p.foodId) return itemFromFood(findFoodExact(a.name), p.grams, { name, source: 'ai+db' });
  return { ...customItem(name, p.grams, p.per100, p.source), match: p.match };
}

/** The plate as Gemini sees it. */
function describe(meal) {
  return meal.items.map((i) => {
    const o = { name: i.name, grams: Math.round(i.grams) };
    if (i.parts) o.ingredients = scaledParts(i).map((p) => ({ name: p.name, grams: Math.round(p.grams) }));
    return o;
  });
}

export const ai = {
  get connected() { const c = cfg(); return !!(c.geminiKey && c.model); },
  get usda() { return !!cfg().usdaKey; },
  get label() { const c = cfg(); return this.connected ? `Gemini (${c.model})` : 'Not connected'; },

  /** Returns { name, items, note } or null when no photo AI is set up. */
  async analyzePhoto(dataUrl, onStage = () => {}) {
    const c = cfg();
    if (!c.geminiKey || !c.model) return null;
    onStage('Identifying foods…');
    const small = await shrinkDataUrl(dataUrl, 768, 0.8); // smaller upload = faster answer
    const r = await analyzePhotoGemini(small, c.geminiKey, c.model, c.context);
    onStage('Looking up nutrition…');
    const items = await Promise.all((r.items || []).filter(usable).map((a) => groundItem(a, c.usdaKey)));
    return { name: r.meal_name, items, note: r.note };
  },

  /** Returns { meal, reply, changed, undo? } */
  async revise(meal, message) {
    if (/^\s*(undo|undo that|go back|revert)\s*[.!]?\s*$/i.test(message)) return { meal, reply: '', changed: false, undo: true };
    const c = cfg();

    if (c.geminiKey && c.model) {
      try {
        const photo = meal.photo ? await shrinkDataUrl(meal.photo, 640, 0.75) : null;
        const history = (meal.chat || []).slice(-11, -1); // last turns, without the message just sent
        const r = await reviseGemini({ photo, current: describe(meal), servings: meal.servings || 1, history, message, context: c.context }, c.geminiKey, c.model);
        const byName = new Map(meal.items.map((i) => [i.name.toLowerCase(), i]));
        const list = (r.items || []).filter(usable);
        const items = await Promise.all(list.map((a) => groundItem(a, c.usdaKey, byName.get(cleanName(a.name).toLowerCase()))));
        const out = { ...structuredClone(meal), items, servings: Number(r.servings) > 0 ? Number(r.servings) : meal.servings };
        const sig = (m) => JSON.stringify([describe(m), m.servings]);
        const changed = sig(meal) !== sig(out);
        return { meal: out, reply: changed ? `${r.reply || 'Done.'}\n${summary(out)}` : (r.reply || 'OK.'), changed };
      } catch (err) {
        const local = applyMessage(meal, message);
        return { ...local, reply: `(Gemini unavailable: ${err.message} — used offline mode)\n${local.reply}` };
      }
    }

    // Offline: rule-based engine, with USDA for foods it doesn't know
    const local = applyMessage(meal, message);
    const unknown = local.unknown || [];
    if (!c.usdaKey || !unknown.length) return local;
    const out = local.changed ? local.meal : structuredClone(meal);
    const added = [], missing = [];
    for (const u of unknown) {
      try {
        const r = (await lookupUSDA(u.name, c.usdaKey)) || (await lookupUSDA(u.name, c.usdaKey, { branded: true }));
        if (!r) { missing.push(u.name); continue; }
        const n = u.qty || 1;
        const grams = Math.round(u.grams || (r.serving ? r.serving * n : 100 * n));
        const it = { id: uid(), foodId: null, name: u.name, grams, per100: r.per100, unit: null, source: 'usda', match: r.desc };
        out.items.push(it);
        added.push(`Added ${it.name} (${grams} g, USDA: ${r.desc}) — ${Math.round(r.per100.k * grams / 100)} kcal`);
      } catch (e) { missing.push(`${u.name} (${e.message})`); }
    }
    let reply = '';
    if (local.changed) reply += local.reply.replace(/\n?Total:.*$/s, '') + '\n';
    if (added.length) reply += added.join('\n') + '\n';
    if (missing.length) reply += `Couldn't find ${missing.join(', ')}. Tell me the calories, e.g. "${missing[0].split(' (')[0]} 250 kcal".\n`;
    return { meal: out, reply: reply + summary(out), changed: local.changed || added.length > 0 };
  },
};
