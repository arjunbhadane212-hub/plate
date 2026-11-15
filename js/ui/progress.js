import { state, route } from '../app.js';
import { mealsInRange, getSettings, loggedDays } from '../db.js';
import { mealTotals, sumTotals, itemTotals } from '../nutrition.js';
import { dayKey, parseDay, addDays, todayKey, startOfWeek, daysInMonth, DOW1, DOW3, MON3, MONTHS, fmt, fmtTime, esc } from '../util.js';
import { ICON, MACRO } from './components.js';
import { streakFrom } from './home.js';

const MODES = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']];

function period(mode, anchor) {
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (mode === 'day') return { start: a, end: a, label: labelDay(a) };
  if (mode === 'week') {
    const s = startOfWeek(a), e = addDays(s, 6);
    return { start: s, end: e, label: `${MON3[s.getMonth()]} ${s.getDate()} – ${s.getMonth() === e.getMonth() ? '' : MON3[e.getMonth()] + ' '}${e.getDate()}${e.getFullYear() !== new Date().getFullYear() ? ', ' + e.getFullYear() : ''}` };
  }
  if (mode === 'month') {
    const s = new Date(a.getFullYear(), a.getMonth(), 1), e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start: s, end: e, label: `${MONTHS[s.getMonth()]} ${s.getFullYear()}` };
  }
  const s = new Date(a.getFullYear(), 0, 1), e = new Date(a.getFullYear(), 11, 31);
  return { start: s, end: e, label: String(s.getFullYear()) };
}
function labelDay(d) {
  const k = dayKey(d);
  if (k === todayKey()) return 'Today';
  return `${DOW3[d.getDay()]}, ${MON3[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`;
}
function shift(mode, d, n) {
  const x = new Date(d);
  if (mode === 'day') x.setDate(x.getDate() + n);
  if (mode === 'week') x.setDate(x.getDate() + 7 * n);
  if (mode === 'month') { x.setDate(1); x.setMonth(x.getMonth() + n); }
  if (mode === 'year') { x.setDate(1); x.setFullYear(x.getFullYear() + n); }
  return x;
}

/** Stacked macro bar chart. bars: [{label, t:{k,p,c,f}, faded}] */
function barChart(bars, goal, { showEvery = 1, unit = '' } = {}) {
  const W = 340, H = 190, L = 34, B = 22, T = 10;
  const max = Math.max(goal * 1.2, ...bars.map((b) => b.t.k)) || 1;
  const n = bars.length, slot = (W - L) / n, bw = Math.max(3, Math.min(26, slot * 0.62));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (const v of [0, max / 2, max]) {
    svg += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#EEEEF2"/>`;
    svg += `<text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)}</text>`;
  }
  bars.forEach((b, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    const k = b.t.k;
    if (k > 0) {
      const mk = b.t.p * 4 + b.t.c * 4 + b.t.f * 9 || 1;
      const segs = [['var(--protein)', (b.t.p * 4) / mk], ['var(--carbs)', (b.t.c * 4) / mk], ['var(--fat)', (b.t.f * 9) / mk]];
      let yy = y(0);
      const total = y(0) - y(k);
      segs.forEach(([col, share], si) => {
        const h = total * share;
        yy -= h;
        const r = si === 2 ? Math.min(4, bw / 2) : 0;
        svg += r
          ? `<path d="M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${yy + h} Z" fill="${col}"/>`
          : `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" fill="${col}"/>`;
      });
    } else {
      svg += `<rect x="${x}" y="${y(0) - 2}" width="${bw}" height="2" rx="1" fill="#E5E5EA"/>`;
    }
    if (i % showEvery === 0 || i === n - 1) svg += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" ${b.today ? 'style="fill:#111;font-weight:800"' : ''}>${b.label}</text>`;
  });
  svg += `<line x1="${L}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="#111" stroke-dasharray="4 4" stroke-width="1.2"/>`;
  svg += `<text x="${W}" y="${y(goal) - 5}" text-anchor="end" style="fill:#111">goal${unit}</text>`;
  return svg + '</svg>';
}

export async function renderProgress(view) {
  const settings = getSettings();
  const g = settings.goals;
  const mode = state.progressMode;
  const anchor = state.progressAnchor || new Date();
  const P = period(mode, anchor);
  const today = todayKey();
  const [meals, days] = await Promise.all([mealsInRange(dayKey(P.start), dayKey(P.end)), loggedDays()]);

  const byDay = {};
  for (const m of meals) (byDay[m.day] ||= []).push(m);
  const dayTot = (k) => sumTotals((byDay[k] || []).map(mealTotals));

  // elapsed days in the period (don't count the future)
  let elapsed = 0;
  for (let d = new Date(P.start); dayKey(d) <= dayKey(P.end) && dayKey(d) <= today; d = addDays(d, 1)) elapsed++;
  const logged = Object.keys(byDay).filter((k) => byDay[k].length);
  const total = sumTotals(meals.map(mealTotals));
  const avg = logged.length ? { k: total.k / logged.length, p: total.p / logged.length, c: total.c / logged.length, f: total.f / logged.length } : { k: 0, p: 0, c: 0, f: 0 };
  const onTarget = logged.filter((k) => { const v = dayTot(k).k; return v >= g.k * 0.9 && v <= g.k * 1.1; }).length;
  const under = logged.filter((k) => dayTot(k).k <= g.k).length;
  const diff = avg.k - g.k;

  // ---------- chart ----------
  let chart = '', chartTitle = '';
  if (mode === 'day') {
    const dm = (byDay[dayKey(P.start)] || []).sort((a, b) => a.ts - b.ts);
    chartTitle = 'Meals';
    chart = dm.length
      ? `<div class="bars">${dm.map((m) => { const t = mealTotals(m); return `<div class="row"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${fmtTime(m.ts)}</span><div class="track"><div class="fill" style="width:${Math.min(100, (t.k / g.k) * 100)}%;background:#111"></div></div><span>${fmt(t.k)} kcal</span></div><div class="muted" style="margin:-6px 0 4px 80px;font-size:12.5px">${esc(m.name)}</div>`; }).join('')}</div>`
      : `<div class="empty">No meals logged on this day.</div>`;
  } else if (mode === 'week' || mode === 'month') {
    const bars = [];
    for (let d = new Date(P.start); dayKey(d) <= dayKey(P.end); d = addDays(d, 1)) {
      const k = dayKey(d);
      bars.push({ label: mode === 'week' ? DOW1[d.getDay()] : String(d.getDate()), t: dayTot(k), today: k === today, key: k });
    }
    chartTitle = 'Calories per day';
    chart = barChart(bars, g.k, { showEvery: mode === 'month' ? 5 : 1 });
  } else {
    const bars = [];
    for (let mo = 0; mo < 12; mo++) {
      const s = dayKey(new Date(P.start.getFullYear(), mo, 1)), e = dayKey(new Date(P.start.getFullYear(), mo, daysInMonth(P.start.getFullYear(), mo)));
      const ks = logged.filter((k) => k >= s && k <= e);
      const t = sumTotals(ks.map(dayTot));
      const n = ks.length || 1;
      bars.push({ label: MON3[mo][0], t: { k: t.k / n, p: t.p / n, c: t.c / n, f: t.f / n }, today: new Date().getMonth() === mo && new Date().getFullYear() === P.start.getFullYear() });
    }
    chartTitle = 'Average calories per day, by month';
    chart = barChart(bars, g.k, { unit: '/day' });
  }

  // ---------- top foods ----------
  const foods = {};
  for (const m of meals) for (const it of m.items) {
    const key = it.name.toLowerCase();
    (foods[key] ||= { name: it.name, k: 0, n: 0 });
    foods[key].k += itemTotals(it).k * (m.servings || 1);
    foods[key].n++;
  }
  const top = Object.values(foods).sort((a, b) => b.k - a.k).slice(0, 5);

  const isDay = mode === 'day';
  const nextDisabled = dayKey(shift(mode, P.start, 1)) > today;

  view.innerHTML = `
    <div class="h1">Progress</div>
    <div class="seg">${MODES.map(([k, l]) => `<button data-mode="${k}" class="${k === mode ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="period">
      <button data-nav="-1" aria-label="Previous">${ICON.back}</button>
      <b>${P.label}</b>
      <button data-nav="1" aria-label="Next" ${nextDisabled ? 'disabled' : ''}>${ICON.next}</button>
    </div>

    <div class="card">
      <div class="muted" style="font-weight:650">${isDay ? 'Calories eaten' : 'Total calories'}</div>
      <div class="big" style="margin-top:6px">${fmt(total.k)}</div>
      <div class="big-sub" style="font-size:14px">${isDay
        ? (total.k ? `${total.k <= g.k ? fmt(g.k - total.k) + ' under' : fmt(total.k - g.k) + ' over'} your ${fmt(g.k)} goal` : 'Nothing logged')
        : `${logged.length} of ${elapsed} day${elapsed === 1 ? '' : 's'} logged`}</div>
      <div class="h2" style="margin:18px 0 0;font-size:15px">${chartTitle}</div>
      ${chart}
      ${isDay ? '' : `<div class="legend">${MACRO.map((m) => `<span><i class="dot ${m.key}"></i>${m.label}</span>`).join('')}</div>`}
    </div>

    ${isDay ? '' : `<div class="stats">
      <div class="stat"><div class="l">Daily average</div><div class="v">${fmt(avg.k)} <small>kcal</small></div></div>
      <div class="stat"><div class="l">Avg vs goal</div><div class="v" style="color:${!logged.length ? 'inherit' : diff > 0 ? 'var(--over)' : 'var(--good)'}">${logged.length ? (diff > 0 ? '+' : '−') + fmt(Math.abs(diff)) : '—'} <small>kcal/day</small></div></div>
      <div class="stat"><div class="l">On target (±10%)</div><div class="v">${onTarget} <small>/ ${logged.length} days</small></div></div>
      <div class="stat"><div class="l">Under goal</div><div class="v">${under} <small>/ ${logged.length} days</small></div></div>
      <div class="stat"><div class="l">Meals logged</div><div class="v">${meals.length}</div></div>
      <div class="stat"><div class="l">Current streak</div><div class="v">${streakFrom(days)} <small>days</small></div></div>
    </div>`}

    <div class="h2">${isDay ? 'Macros' : 'Average macros per day'}</div>
    <div class="card bars">
      ${MACRO.map((m) => { const v = isDay ? total[m.key] : avg[m.key]; return `<div class="row"><span>${m.label}</span><div class="track"><div class="fill" style="width:${Math.min(100, (v / g[m.key]) * 100)}%;background:${m.color}"></div></div><span>${fmt(v)} / ${fmt(g[m.key])}g</span></div>`; }).join('')}
    </div>

    ${top.length ? `<div class="h2">Top foods<small>by calories</small></div>
    <div class="card bars">${top.map((f) => `<div class="row" style="grid-template-columns:1fr auto"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.name)} <span class="muted">×${f.n}</span></span><span>${fmt(f.k)} kcal</span></div>`).join('')}</div>` : ''}
  `;

  view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.progressMode = b.dataset.mode; route(); }));
  view.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    state.progressAnchor = shift(mode, P.start, Number(b.dataset.nav));
    route();
  }));
}
