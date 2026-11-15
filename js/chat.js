// Local "Fix results" chat engine. Understands plain-English corrections:
//   "you missed the rice"            -> adds rice
//   "2 eggs and toast with butter"   -> adds 3 items
//   "remove the sauce" / "no cheese" -> removes
//   "that's quinoa not rice"         -> swaps food, keeps portion
//   "the rice was 200g" / "3 eggs not 2" / "make the chicken 1.5 pieces" -> sets amount
//   "more rice" / "double the chicken" / "the fries portion is smaller" -> scales
//   "I only ate half" / "2 servings"  -> meal servings
//   "protein bar 210 kcal"            -> custom food with your calories
//   "undo"                            -> reverts last change
// Everything is deterministic and grounded in the food database.

import { findFood, parsePhrase, itemFromParsed, itemFromFood, niceName, itemTotals, mealTotals, norm, amountLabel, FOOD_BY_ID } from './nutrition.js';
import { FOODS } from './foods.js';
import { fmt } from './util.js';

const PROTECT = FOODS.flatMap((f) => [f.n, ...f.a]).map((s) => s.toLowerCase()).filter((s) => / (and|with|n) /.test(s));

function splitList(text) {
  let t = ' ' + text.toLowerCase() + ' ';
  for (const p of PROTECT) t = t.split(' ' + p + ' ').join(' ' + p.replace(/ /g, '_') + ' ');
  const parts = t.split(/(,|;|\n|\+|&|\bplus\b|\band\b|\bwith\b|\bas well as\b|\balong with\b)/);
  const out = [];
  let withCtx = false;
  for (const part of parts) {
    const sep = part.trim();
    if (/^(,|;|\+|&|plus|and|with|as well as|along with)$/.test(sep) || part === '\n') {
      withCtx = sep === 'with' || sep === 'along with';
      continue;
    }
    const seg = part.replace(/_/g, ' ').trim();
    if (seg) out.push({ seg, withCtx });
    if (seg) withCtx = false;
  }
  return out;
}

function matchItem(meal, phrase) {
  const p = phrase.trim();
  if (!p) return null;
  if (/^(it|that|this|them|those|everything)$/.test(p) && meal.items.length === 1) return meal.items[0];
  const f = findFood(p);
  if (f) {
    const hit = meal.items.find((it) => it.foodId === f.id);
    if (hit) return hit;
  }
  const toks = new Set(norm(p).split(' ').filter((w) => w.length > 2));
  let best = null, bestScore = 0;
  for (const it of meal.items) {
    const names = norm(it.name + ' ' + (it.foodId ? FOOD_BY_ID[it.foodId]?.n || '' : '')).split(' ');
    const score = names.filter((w) => toks.has(w)).length;
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return best;
}

const kc = (it) => fmt(itemTotals(it).k);
const hasQty = (s) => /(\d|½|¼|¾|\b(a|an|one|two|three|four|five|six|half|quarter|dozen|couple)\b)/.test(s);

function strip(text) {
  return text.trim()
    .replace(/[!?.]+$/g, '')
    .replace(/^(no|nope|nah|actually|hey|hi|ok|okay|so|um|well|wait|oh|oops|hmm)\s*[,!.:-]\s*/i, '')
    .replace(/^(hey|hi|yo|ok|okay|so|um|well|wait|oh|hmm)\s+/i, '')
    .replace(/\s*(,\s*)?(please|pls|thanks|thank you|thx)$/i, '')
    .trim();
}

/**
 * Apply a chat message to a meal (mutates a copy).
 * @returns {{ meal, reply, changed, undo? }}
 */
export function applyMessage(mealIn, rawText) {
  const meal = structuredClone(mealIn);
  const changes = [];
  const unknown = [];
  const t = strip(rawText);
  const low = t.toLowerCase();
  const unknownParsed = [];
  const done = (reply) => ({ meal, reply, changed: changes.length > 0, unknown: unknownParsed });

  if (!low) return done(help());
  if (/^(undo|revert|go back|undo that)$/.test(low)) return { meal: mealIn, reply: '', changed: false, undo: true };
  if (/^(clear|start over|reset|remove (everything|all)|delete (everything|all))$/.test(low)) {
    meal.items = []; meal.servings = 1;
    changes.push('Cleared everything');
    return done('Cleared. Tell me what was on the plate.');
  }
  if (/^(help|what can (i|you) (say|do)|how does this work)$/.test(low)) return done(help());
  if (/\?$/.test(rawText.trim()) && /(calorie|kcal|total|how much|how many|protein|carb|fat)/.test(low)) return done(summary(meal, true));

  // ---------- servings for the whole meal ----------
  const servWords = { half: 0.5, 'a half': 0.5, 'a third': 1 / 3, third: 1 / 3, 'a quarter': 0.25, quarter: 0.25, 'three quarters': 0.75, most: 0.75, all: 1, everything: 1 };
  let m = low.match(/^(?:i\s+)?(?:only\s+)?(?:ate|had|finished|eaten|got through)\s+(?:about\s+|only\s+|like\s+|maybe\s+)?(half|a half|a third|third|a quarter|quarter|three quarters|most|all|everything|\d+\s*%)(?:\s+of)?(?:\s+(?:it|that|this|the\s+(?:plate|meal|bowl|dish|portion|thing|food)))?$/);
  if (m) {
    const k = m[1].replace(/\s+/g, ' ');
    const v = k.endsWith('%') ? parseFloat(k) / 100 : servWords[k];
    meal.servings = Math.round(v * 100) / 100;
    changes.push(`Servings set to ${meal.servings}`);
    return done(`Got it — counting ${meal.servings} of the plate. ${summary(meal)}`);
  }
  m = low.match(/^(?:it\s+was\s+|i\s+(?:had|ate)\s+|make\s+it\s+)?(\d+(?:\.\d+)?|one|two|three|four|double|triple)\s+(?:servings?|portions?|plates?|helpings?|bowls?|times\s+that)$/);
  if (m) {
    const v = { one: 1, two: 2, three: 3, four: 4, double: 2, triple: 3 }[m[1]] ?? parseFloat(m[1]);
    meal.servings = v;
    changes.push(`Servings set to ${v}`);
    return done(`Counting ${v} servings. ${summary(meal)}`);
  }
  m = low.match(/^(?:it\s+was\s+)?(?:shared|split)\s+(?:it\s+)?(?:with|between)\s+(\d+|one|two|three|four)(?:\s+(?:other\s+)?(?:people|person|friends?))?$/);
  if (m) {
    const n = { one: 1, two: 2, three: 3, four: 4 }[m[1]] ?? parseInt(m[1]);
    const people = /between/.test(low) ? n : n + 1;
    meal.servings = Math.round((1 / people) * 100) / 100;
    changes.push(`Servings set to ${meal.servings}`);
    return done(`Split ${people} ways — your share is ${meal.servings} of the plate. ${summary(meal)}`);
  }

  // ---------- swaps ("that's quinoa not rice") ----------
  const swapRes = [
    [/^(?:it'?s|its|that'?s|thats|this is|this was|it was|those are|these are|that was)\s+(?:not|n'?t)\s+(?:a\s+|an\s+)?(.+?)\s*[,;.]?\s+(?:it'?s|its|it is|it was|that'?s|but|they'?re|those are|it'?s actually)\s+(?:a\s+|an\s+|actually\s+)?(.+)$/, 1, 2],
    [/^(?:not|no)\s+(?:a\s+|an\s+)?(.+?)\s*[,;.]?\s+(?:it'?s|its|it is|but|that'?s)\s+(?:a\s+|an\s+|actually\s+)?(.+)$/, 1, 2],
    [/^(?:replace|swap|change|switch)\s+(?:the\s+)?(.+?)\s+(?:with|for|to|into)\s+(.+)$/, 1, 2],
    [/^(.+?)\s+instead\s+of\s+(?:the\s+)?(.+)$/, 2, 1],
    [/^(?:it'?s|its|that'?s|thats|this is|it was|that was|those are|they'?re)\s+(?:actually\s+)?(?:a\s+|an\s+)?(.+?)\s*[,;]?\s+(?:not|n'?t)\s+(?:a\s+|an\s+|the\s+)?(.+)$/, 2, 1],
    [/^(?:the\s+)?(.+?)\s+(?:is|was|are|were)\s+(?:actually|really)\s+(?:a\s+|an\s+)?(.+)$/, 1, 2],
  ];
  for (const [re, fi, ti] of swapRes) {
    m = low.match(re);
    if (!m) continue;
    const from = m[fi].trim(), to = m[ti].trim();
    const r = swapOrSet(meal, from, to, changes);
    if (r) return done(r);
  }

  // ---------- removals ----------
  m = low.match(/^(?:remove|delete|take\s+(?:out|off|away)|drop|get\s+rid\s+of|no|there\s*(?:'s|s|is|was|are|were)?\s+no|there\s+(?:wasn'?t|isn'?t|aren'?t|weren'?t)(?:\s+any)?|i\s+did(?:n'?t|\s+not)\s+(?:have|eat)(?:\s+the)?|without|minus|skip|exclude|lose)\s+(?:the\s+|any\s+|my\s+)?(.+)$/)
    || low.match(/^(?:the\s+)?(.+?)\s+(?:wasn'?t|isn'?t|aren'?t|weren'?t|is\s+not|was\s+not|are\s+not)\s+(?:there|on\s+(?:the|my)\s+plate|in\s+(?:it|there)|part\s+of\s+(?:it|the\s+meal)|mine|real)$/);
  if (m) {
    const targets = splitList(m[1]).map((x) => x.seg);
    const removed = [];
    for (const tg of targets) {
      const it = matchItem(meal, tg);
      if (it) { meal.items = meal.items.filter((x) => x !== it); removed.push(it.name); }
    }
    if (removed.length) {
      changes.push('Removed ' + removed.join(', '));
      return done(`Removed ${removed.join(', ')}. ${summary(meal)}`);
    }
    return done(`I couldn't find "${m[1]}" in this meal. ${listItems(meal)}`);
  }

  // ---------- scaling ----------
  m = low.match(/^(?:make\s+)?(double|triple|halve|half|quarter)\s+(?:the\s+|of\s+the\s+|my\s+)(.+)$/)
    || low.match(/^(?:make\s+)?(double|triple|halve)\s+(.+)$/);
  if (m) {
    const it = matchItem(meal, m[2]);
    if (it) return done(scale(meal, it, { double: 2, triple: 3, halve: 0.5, half: 0.5, quarter: 0.25 }[m[1]], changes));
  }
  m = low.match(/^(?:there\s+(?:is|was|were|are|'s)\s+|i\s+had\s+)?(a\s+(?:bit|little|lot)\s+|way\s+|much\s+|slightly\s+|a\s+tad\s+)?(more|less|fewer|extra)\s+(?:of\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+than\s+(?:that|this|you\s+(?:think|said|have)))?$/);
  if (m) {
    const it = matchItem(meal, m[3]);
    if (it && !hasQty(m[3])) {
      const amt = (m[1] || '').trim();
      const big = /lot|way|much/.test(amt), small = /bit|little|slightly|tad/.test(amt);
      const up = m[2] === 'more' || m[2] === 'extra';
      const f = up ? (big ? 1.6 : small ? 1.15 : 1.3) : (big ? 0.5 : small ? 0.85 : 0.7);
      return done(scale(meal, it, f, changes));
    }
  }
  m = low.match(/^(?:make\s+)?(?:the\s+)?(.+?)\s+(?:portion\s+|serving\s+|amount\s+)?(?:is|was|looks|should\s+be|were|are)?\s*(way\s+|much\s+|a\s+bit\s+|a\s+little\s+|slightly\s+)?(bigger|larger|more|smaller|less|too\s+small|too\s+big|too\s+much|too\s+little|too\s+high|too\s+low|double|half|twice\s+as\s+big|twice\s+that)$/);
  if (m) {
    const it = matchItem(meal, m[1]);
    if (it) {
      const big = /way|much/.test(m[2] || ''), small = /bit|little|slightly/.test(m[2] || '');
      const w = m[3].replace(/\s+/g, ' ');
      let f;
      if (/double|twice/.test(w)) f = 2;
      else if (w === 'half') f = 0.5;
      else if (/bigger|larger|more|too small|too little|too low/.test(w)) f = big ? 1.6 : small ? 1.15 : 1.3;
      else f = big ? 0.5 : small ? 0.85 : 0.7;
      return done(scale(meal, it, f, changes));
    }
  }

  // ---------- set amounts ----------
  m = low.match(/^(?:make|set|change|put)\s+(?:the\s+)?(.+?)\s+(?:to\s+|at\s+)?((?:\d|½|¼|¾|half|a\s|an\s|one|two|three|four|five).*)$/);
  if (m) { const r = setAmount(meal, m[1], m[2], changes); if (r) return done(r); }
  m = low.match(/^(?:the\s+)?(.+?)\s+(?:was|is|were|are|should\s+be|=|weighed|weighs|weighing)\s+(?:about\s+|around\s+|more\s+like\s+|like\s+|only\s+|actually\s+|roughly\s+|approx(?:imately)?\s+|closer\s+to\s+|just\s+)*(.+)$/);
  if (m && hasQty(m[2])) { const r = setAmount(meal, m[1], m[2], changes); if (r) return done(r); }
  m = low.match(/^(?:i\s+)?(?:had|ate|it\s+was|there\s+(?:was|were)|it'?s|its)?\s*(.+?)\s*,?\s+not\s+(.+)$/);
  if (m && hasQty(m[1])) {
    const p = parsePhrase(m[1]);
    const it = p.food ? meal.items.find((x) => x.foodId === p.food.id) : matchItem(meal, m[2]);
    if (it) { const r = setAmount(meal, it, m[1], changes); if (r) return done(r); }
  }
  m = low.match(/^(?:only|just|actually|really)\s+(.+)$/);
  if (m && hasQty(m[1])) {
    const p = parsePhrase(m[1]);
    const it = p.food && meal.items.find((x) => x.foodId === p.food.id);
    if (it) { const r = setAmount(meal, it, m[1], changes); if (r) return done(r); }
  }

  // ---------- add (default) ----------
  const addText = low
    .replace(/^(?:you\s+(?:missed|forgot|didn'?t\s+(?:see|include|add|count|get|catch))|i\s+(?:also\s+)?(?:had|ate|drank|got)|also\s+(?:had|add)?|add(?:\s+in)?|plus|and|there(?:'s|s|\s+is|\s+was|\s+were|\s+are)(?:\s+also)?|forgot|missing|don'?t\s+forget|include|it\s+(?:also\s+)?(?:has|had)|on\s+the\s+side|with)\s+/, '')
    .replace(/^(?:also|too)\s+/, '')
    .replace(/^(?:the|a\s+side\s+of|some)\s+/, '')
    .replace(/\s+(?:too|as\s+well|also|on\s+the\s+side)$/, '');
  for (const { seg, withCtx } of splitList(addText)) {
    const p = parsePhrase(seg, { withContext: withCtx });
    if (p.unknown) { if (p.name) { unknown.push(p.name); unknownParsed.push(p); } continue; }
    const existing = p.food && meal.items.find((x) => x.foodId === p.food.id);
    if (existing && /\b(more|another|extra|additional)\b/.test(seg)) {
      const before = existing.grams;
      existing.grams = Math.round(existing.grams + p.grams);
      changes.push(`${existing.name}: ${before} g → ${existing.grams} g`);
      continue;
    }
    const it = itemFromParsed(p);
    meal.items.push(it);
    changes.push(`Added ${it.name} (${amountLabel(it)}) — ${kc(it)} kcal`);
  }
  let reply = '';
  if (changes.length) reply += changes.join('\n') + '\n' + summary(meal);
  if (unknown.length) {
    reply += (reply ? '\n\n' : '') + `I don't have "${unknown.join('", "')}" in my food list yet. Tell me the calories and I'll add it — e.g. "${unknown[0]} 250 kcal".`;
  }
  if (!reply) reply = `Sorry, I didn't catch that. ${help(true)}`;
  return done(reply);
}

function swapOrSet(meal, from, to, changes) {
  let it = matchItem(meal, from);
  const p = parsePhrase(to);
  if (!it) {
    // "it's 3 eggs not 2": `from` is just a number
    if (p.food) it = meal.items.find((x) => x.foodId === p.food.id) || null;
    if (!it) return null;
  }
  if (p.unknown && !p.name) {
    return setAmount(meal, it, to, changes);
  }
  if (p.unknown) {
    return `I don't know "${p.name}" yet. Tell me its calories, like "${p.name} 300 kcal", and I'll swap it in.`;
  }
  if (p.food && p.food.id === it.foodId) {
    if (p.explicitQty) return setAmount(meal, it, to, changes);
    // same database food, just a more specific name ("mutton biryani")
    if (p.name && p.name.toLowerCase() !== it.name.toLowerCase()) {
      const before = it.name;
      it.name = p.name;
      changes.push(`${before} → ${it.name}`);
      return `Renamed ${before} to ${it.name}. ${summary(meal)}`;
    }
    return `${it.name} is already in there (${amountLabel(it)}). ${summary(meal)}`;
  }
  const idx = meal.items.indexOf(it);
  const grams = p.explicitQty ? p.grams : it.grams;
  const neu = p.kcalOverride != null ? itemFromParsed({ ...p, grams }) : itemFromFood(p.food, grams, { name: niceName(p) });
  meal.items[idx] = neu;
  changes.push(`${it.name} → ${neu.name}`);
  return `Swapped ${it.name} for ${neu.name} (${amountLabel(neu)}) — ${kc(neu)} kcal. ${summary(meal)}`;
}

function setAmount(meal, itemOrPhrase, qtyPhrase, changes) {
  const it = typeof itemOrPhrase === 'string' ? matchItem(meal, itemOrPhrase) : itemOrPhrase;
  if (!it) return null;
  const food = it.foodId ? FOOD_BY_ID[it.foodId] : null;
  // explicit calories: "the sauce was 120 kcal"
  const kcalM = qtyPhrase.match(/(\d+(?:\.\d+)?)\s*(kcal|calories|calorie|cals|cal)\b/);
  if (kcalM) {
    const target = parseFloat(kcalM[1]);
    const cur = itemTotals(it).k || 1;
    const r = target / cur;
    it.per100 = { k: it.per100.k * r, p: it.per100.p * r, c: it.per100.c * r, f: it.per100.f * r };
    it.source = 'user';
    changes.push(`${it.name} set to ${fmt(target)} kcal`);
    return `${it.name} is now ${fmt(target)} kcal. ${summary(meal)}`;
  }
  let grams;
  if (food) {
    const p = parsePhrase(`${qtyPhrase} ${food.a[0] || food.n}`);
    if (!p.food || !p.explicitQty) return null;
    grams = p.grams;
  } else {
    const gm = qtyPhrase.match(/(\d+(?:\.\d+)?)\s*(g|grams?|oz|ml)\b/);
    if (!gm) return null;
    grams = parseFloat(gm[1]) * (gm[2] === 'oz' ? 28.35 : 1);
  }
  const before = amountLabel(it);
  it.grams = Math.max(1, Math.round(grams));
  changes.push(`${it.name}: ${before} → ${amountLabel(it)}`);
  return `Updated ${it.name}: ${before} → ${amountLabel(it)} (${kc(it)} kcal). ${summary(meal)}`;
}

function scale(meal, it, f, changes) {
  const before = amountLabel(it);
  it.grams = Math.max(1, Math.round(it.grams * f));
  changes.push(`${it.name}: ${before} → ${amountLabel(it)}`);
  return `Adjusted ${it.name}: ${before} → ${amountLabel(it)} (${kc(it)} kcal). ${summary(meal)}`;
}

function listItems(meal) {
  if (!meal.items.length) return 'The meal is empty right now.';
  return 'Items: ' + meal.items.map((i) => i.name).join(', ') + '.';
}

export function summary(meal, detailed = false) {
  const t = mealTotals(meal);
  const head = `Total: ${fmt(t.k)} kcal · P ${fmt(t.p)}g · C ${fmt(t.c)}g · F ${fmt(t.f)}g`;
  if (!detailed) return head;
  const lines = meal.items.map((i) => `• ${i.name} (${amountLabel(i)}) — ${kc(i)} kcal`);
  return [head, ...lines].join('\n');
}

export function help(short = false) {
  const ex = 'Try: "2 eggs and toast with butter", "you missed the rice", "remove the sauce", "that\'s quinoa not rice", "the chicken was 200g", "more rice", "I only ate half", "protein bar 210 kcal", or "undo".';
  return short ? ex : `Tell me what's on the plate or what to fix. ${ex}`;
}
