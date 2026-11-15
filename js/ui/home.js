import { state, openAddSheet, route } from '../app.js';
import { mealsInRange, getSettings, loggedDays } from '../db.js';
import { mealTotals, sumTotals } from '../nutrition.js';
import { dayKey, parseDay, addDays, todayKey, DOW1, fmt, fmtTime, prettyDay, esc } from '../util.js';
import { ICON, MACRO, ring } from './components.js';

export function streakFrom(days) {
  let d = new Date();
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

export async function renderHome(view) {
  const settings = getSettings();
  const g = settings.goals;
  const today = todayKey();
  const sel = parseDay(state.day);
  let end = addDays(sel, 3);
  if (dayKey(end) > today) end = parseDay(today);
  const start = addDays(end, -6);

  const [meals, days] = await Promise.all([mealsInRange(dayKey(start), dayKey(end)), loggedDays()]);
  if (!/^#?\/?$/.test(location.hash)) return; // user navigated away while loading
  const byDay = {};
  for (const m of meals) (byDay[m.day] ||= []).push(m);
  const dayMeals = (byDay[state.day] || []).sort((a, b) => a.ts - b.ts);
  // selected day may be outside the strip window (shouldn't, but be safe)
  const t = sumTotals(dayMeals.map(mealTotals));
  const left = g.k - t.k;
  const streak = streakFrom(days);

  let week = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const k = dayKey(d);
    const kc = sumTotals((byDay[k] || []).map(mealTotals)).k;
    const pct = kc / g.k;
    const has = (byDay[k] || []).length > 0;
    const color = pct > 1.08 ? 'var(--over)' : '#111';
    const r = has
      ? ring(pct, { size: 34, stroke: 2.6, color, track: '#E5E5EA' })
      : `<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="15.7" fill="none" stroke="#C7C7CC" stroke-width="1.6" stroke-dasharray="3 3"/></svg>`;
    week += `<button class="day ${k === state.day ? 'sel' : ''} ${k > today ? 'future' : ''}" data-day="${k}">
      <span class="dl">${DOW1[d.getDay()]}</span>
      <span class="dn">${r.replace('class="ring"', 'class="ring" style="position:absolute;inset:0"')}<span style="position:relative">${d.getDate()}</span></span>
    </button>`;
  }

  const macroCards = MACRO.map((m) => {
    const goal = g[m.key], eaten = t[m.key], rem = goal - eaten;
    return `<div class="macro">
      <div class="v">${fmt(Math.abs(rem))}g</div>
      <div class="l">${m.label} ${rem >= 0 ? 'left' : 'over'}</div>
      ${ring(eaten / goal, { size: 64, stroke: 6, color: m.color, inner: `<span style="color:${m.color}">${m.icon}</span>` })}
    </div>`;
  }).join('');

  const list = dayMeals.length
    ? dayMeals.slice().reverse().map((m) => {
        const mt = mealTotals(m);
        return `<a class="meal" href="#/meal/${m.id}">
          ${m.thumb ? `<img class="thumb" src="${m.thumb}" alt="">` : `<div class="thumb">${ICON.fork}</div>`}
          <div class="info">
            <div class="row1"><div class="name">${esc(m.name || 'Meal')}</div><div class="time">${fmtTime(m.ts)}</div></div>
            <div class="kcal">${ICON.flame}${fmt(mt.k)} calories</div>
            <div class="mm">
              <span><i class="dot p"></i>${fmt(mt.p)}g</span>
              <span><i class="dot c"></i>${fmt(mt.c)}g</span>
              <span><i class="dot f"></i>${fmt(mt.f)}g</span>
            </div>
          </div>
        </a>`;
      }).join('')
    : `<div class="card empty"><b>Nothing logged ${state.day === today ? 'yet today' : 'on this day'}</b>Tap + to snap a photo of your meal.</div>`;

  view.innerHTML = `
    <header class="top">
      <div class="brand"><span class="logo">${ICON.logo}</span>Plate</div>
      <div style="display:flex;gap:8px">
        <label class="pill" style="position:relative">${ICON.calendar}<input id="pick-day" type="date" max="${today}" value="${state.day}" style="position:absolute;inset:0;opacity:0;width:100%"></label>
        <div class="pill"><span style="color:var(--over)">${ICON.flame}</span>${streak}</div>
      </div>
    </header>
    <div class="week">${week}</div>

    <div class="card cal-card">
      <div>
        <div class="big">${fmt(Math.abs(left))}</div>
        <div class="big-sub">Calories ${left >= 0 ? 'left' : 'over'}</div>
        <div class="big-sub" style="font-size:13px;margin-top:10px"><b>${fmt(t.k)}</b> eaten · goal ${fmt(g.k)}</div>
      </div>
      ${ring(t.k / g.k, { size: 112, stroke: 10, color: left < 0 ? 'var(--over)' : '#111', inner: ICON.flame })}
    </div>
    <div class="macros">${macroCards}</div>

    <div class="h2">${prettyDay(state.day)}<small>${dayMeals.length} meal${dayMeals.length === 1 ? '' : 's'}</small></div>
    ${list}
  `;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.setAttribute('aria-label', 'Add food');
  fab.innerHTML = ICON.plus;
  fab.onclick = openAddSheet;
  document.body.appendChild(fab);

  view.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => { state.day = b.dataset.day; route(); }));
  view.querySelector('#pick-day').addEventListener('change', (e) => { if (e.target.value) { state.day = e.target.value; route(); } });
}
