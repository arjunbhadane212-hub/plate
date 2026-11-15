// Photo analysis + chat, combining three sources (most trustworthy first):
//
//  1. Gemini looks at the photo and says WHAT is on the plate and HOW MANY GRAMS.
//  2. Calories/macros for each item come from a real database, not the model:
//       USDA FoodData Central (if a key is set)  →  built-in food table  →
//       the model's own estimate only as a last resort (tagged "AI EST.").
//  3. Chat corrections: simple ones are handled instantly on the phone by the
//     local engine; anything it doesn't understand goes to Gemini; unknown
//     foods are looked up in USDA.
//
// Keys live only in this phone's Settings (localStorage). They are never in
// the code, which is public.

import { getSettings } from './db.js';
import { findFoodExact, itemFromFood, customItem, cleanName } from './nutrition.js';
import { applyMessage, summary } from './chat.js';
import { lookupUSDA } from './usda.js';
import { analyzePhotoGemini, reviseGemini } from './gemini.js';
import { uid } from './util.js';

const cfg = () => getSettings().ai;

/** Turn model items into meal items with database nutrition wherever possible. */
export async function ground(aiItems, usdaKey) {
  return Promise.all(aiItems.map(async (a) => {
    const grams = Math.max(1, Math.round(Number(a.grams) || 100));
    const name = cleanName(a.name || 'Food');
    const aiPer100 = (Number(a.kcal) || 0) / grams * 100;
    const near = (u, lo, hi) => u && (aiPer100 < 25 || (u.per100.k > aiPer100 * lo && u.per100.k < aiPer100 * hi));
    const fromUSDA = (u) => ({ id: uid(), foodId: null, name, grams, per100: u.per100, unit: null, source: 'usda', match: u.desc });
    // 1. USDA generic foods (rejects obviously wrong matches, e.g. "butter" → "butter beans")
    if (usdaKey) {
      try { const u = await lookupUSDA(a.name, usdaKey); if (near(u, 1 / 3, 3)) return fromUSDA(u); }
      catch (e) { console.warn('USDA lookup failed', e); }
    }
    // 2. built-in table
    const food = findFoodExact(a.name || '');
    if (food) return itemFromFood(food, grams, { name, source: 'ai+db' });
    // 2b. USDA branded products (stricter sanity check)
    if (usdaKey) {
      try { const u = await lookupUSDA(a.name, usdaKey, { branded: true }); if (near(u, 0.6, 1.6)) return fromUSDA(u); }
      catch (e) { console.warn('USDA lookup failed', e); }
    }
    // 3. model estimate
    const per = (v) => (Number(v) || 0) / grams * 100;
    return customItem(name, grams, { k: per(a.kcal), p: per(a.protein), c: per(a.carbs), f: per(a.fat) }, 'ai');
  }));
}

export const ai = {
  get connected() { const c = cfg(); return !!(c.geminiKey && c.model); },
  get usda() { return !!cfg().usdaKey; },
  get label() { const c = cfg(); return this.connected ? `Gemini (${c.model})` : 'Not connected'; },

  /** Returns { name, items, note } or null when no photo AI is set up. */
  async analyzePhoto(dataUrl) {
    const c = cfg();
    if (!c.geminiKey || !c.model) return null;
    const r = await analyzePhotoGemini(dataUrl, c.geminiKey, c.model);
    const items = await ground((r.items || []).filter((i) => i && i.name && Number(i.grams) > 0), c.usdaKey);
    return { name: r.meal_name, items, note: r.note };
  },

  /** Returns { meal, reply, changed, undo? } */
  async revise(meal, message) {
    const local = applyMessage(meal, message);
    if (local.undo) return local;
    const unknown = local.unknown || [];
    if (local.changed && !unknown.length) return local;
    const c = cfg();

    // Gemini handles anything the local engine couldn't
    if (c.geminiKey && c.model) {
      const r = await reviseGemini(meal, message, c.geminiKey, c.model);
      const byName = new Map(meal.items.map((i) => [i.name.toLowerCase(), i]));
      const fresh = [], slots = [];
      for (const a of r.items || []) {
        if (!a?.name || !(Number(a.grams) > 0)) continue;
        const ex = byName.get(a.name.toLowerCase());
        if (ex) slots.push({ ...ex, grams: Math.max(1, Math.round(a.grams)) });
        else { slots.push(null); fresh.push(a); }
      }
      const grounded = await ground(fresh, c.usdaKey);
      let gi = 0;
      const items = slots.map((s) => s || grounded[gi++]);
      const out = { ...structuredClone(meal), items, servings: Number(r.servings) > 0 ? Number(r.servings) : meal.servings };
      const changed = JSON.stringify([meal.items.map((i) => [i.name, i.grams]), meal.servings]) !== JSON.stringify([items.map((i) => [i.name, i.grams]), out.servings]);
      return { meal: out, reply: `${r.reply || 'Done.'}\n${summary(out)}`, changed };
    }

    // No Gemini: look unknown foods up in USDA
    if (c.usdaKey && unknown.length) {
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
          added.push(`Added ${it.name} (${grams} g, from USDA: ${r.desc}) — ${Math.round(r.per100.k * grams / 100)} kcal${u.grams || r.serving ? '' : '. I assumed 100 g each — tap it to adjust'}`);
        } catch (e) { missing.push(`${u.name} (${e.message})`); }
      }
      let reply = '';
      if (local.changed) reply += local.reply.split('\n\n')[0].replace(/\n?Total:.*$/s, '') + '\n';
      if (added.length) reply += added.join('\n') + '\n';
      if (missing.length) reply += `Couldn't find ${missing.join(', ')} in USDA. Tell me the calories, e.g. "${missing[0].split(' (')[0]} 250 kcal".\n`;
      return { meal: out, reply: reply + summary(out), changed: local.changed || added.length > 0 };
    }
    return local;
  },
};
