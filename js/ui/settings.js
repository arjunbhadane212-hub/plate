import { route } from '../app.js';
import { getSettings, saveSettings, allMeals, putMany, clearMeals } from '../db.js';
import { toast, todayKey, esc } from '../util.js';
import { pickModel } from '../gemini.js';
import { testUSDA } from '../usda.js';
import { MACRO } from './components.js';

const ACTIVITY = [[1.2, 'Mostly sitting'], [1.375, 'Light (1–3 workouts/wk)'], [1.55, 'Moderate (3–5/wk)'], [1.725, 'Very active (6–7/wk)'], [1.9, 'Athlete / physical job']];
const GOALS = [['lose', 'Lose ~0.5 kg / 1 lb a week', -500], ['lose-slow', 'Lose slowly', -250], ['maintain', 'Maintain weight', 0], ['gain', 'Gain muscle', 300]];

export function calcGoals(pr) {
  const bmr = 10 * pr.weight + 6.25 * pr.height - 5 * pr.age + (pr.sex === 'male' ? 5 : -161);
  const adj = GOALS.find((g) => g[0] === pr.goal)?.[2] ?? 0;
  const k = Math.round((bmr * pr.activity + adj) / 10) * 10;
  const p = Math.round(pr.weight * (pr.goal.startsWith('lose') ? 2.0 : 1.8));
  const f = Math.round((k * 0.27) / 9);
  const c = Math.max(50, Math.round((k - p * 4 - f * 9) / 4));
  return { k, p, c, f };
}

function aiStatus(s, extra = {}) {
  const dot = (ok) => `<span class="dot" style="background:${ok ? 'var(--good)' : 'var(--faint)'}"></span>`;
  const g = extra.g ?? (s.ai.geminiKey && s.ai.model ? `Photo AI ready — ${esc(s.ai.model)}` : s.ai.geminiKey ? 'Gemini key saved, not tested' : 'Photo AI off — you describe meals in the chat');
  const u = extra.u ?? (s.ai.usdaKey ? 'USDA food database connected' : 'USDA off — using the built-in food table');
  return `<div class="status">${dot(extra.gOk ?? !!(s.ai.geminiKey && s.ai.model))}${g}</div>
    <div class="status" style="margin-top:10px">${dot(extra.uOk ?? !!s.ai.usdaKey)}${u}</div>`;
}

export function renderSettings(view) {
  const s = getSettings();
  const pr = s.profile;
  const imp = pr.units === 'imperial';
  const ftIn = { ft: Math.floor(pr.height / 30.48), in: Math.round((pr.height / 2.54) % 12) };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  view.innerHTML = `
    <div class="h1">Settings</div>

    <div class="h2">Daily goals</div>
    <div class="card" style="padding:4px 18px">
      <div class="field"><label>Calories</label><input type="number" inputmode="numeric" data-goal="k" value="${s.goals.k}"></div>
      ${MACRO.map((m) => `<div class="field"><label><i class="dot ${m.key}" style="margin-right:8px"></i>${m.label} (g)</label><input type="number" inputmode="numeric" data-goal="${m.key}" value="${s.goals[m.key]}"></div>`).join('')}
    </div>

    <div class="h2">Calculate my goals</div>
    <div class="card" style="padding:4px 18px">
      <div class="field"><label>Units</label><select id="units"><option value="metric" ${!imp ? 'selected' : ''}>Metric (kg, cm)</option><option value="imperial" ${imp ? 'selected' : ''}>Imperial (lb, ft)</option></select></div>
      <div class="field"><label>Sex</label><select data-p="sex"><option value="male" ${pr.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${pr.sex === 'female' ? 'selected' : ''}>Female</option></select></div>
      <div class="field"><label>Age</label><input type="number" inputmode="numeric" data-p="age" value="${pr.age}"></div>
      ${imp
        ? `<div class="field"><label>Height</label><span style="display:flex;gap:6px"><input style="width:70px" type="number" inputmode="numeric" id="ft" value="${ftIn.ft}" placeholder="ft"><input style="width:70px" type="number" inputmode="numeric" id="in" value="${ftIn.in}" placeholder="in"></span></div>
           <div class="field"><label>Weight (lb)</label><input type="number" inputmode="decimal" id="lb" value="${Math.round(pr.weight * 2.20462)}"></div>`
        : `<div class="field"><label>Height (cm)</label><input type="number" inputmode="numeric" data-p="height" value="${pr.height}"></div>
           <div class="field"><label>Weight (kg)</label><input type="number" inputmode="decimal" data-p="weight" value="${pr.weight}"></div>`}
      <div class="field"><label>Activity</label><select data-p="activity">${ACTIVITY.map(([v, l]) => `<option value="${v}" ${Number(pr.activity) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Goal</label><select data-p="goal">${GOALS.map(([v, l]) => `<option value="${v}" ${pr.goal === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="row-btns"><button class="btn black block" id="calc">Calculate &amp; apply</button></div>
    <p class="note">Uses the Mifflin-St Jeor equation. Protein ≈ ${pr.goal?.startsWith('lose') ? '2.0' : '1.8'} g per kg body weight, fat ≈ 27% of calories, carbs fill the rest.</p>

    <div class="h2">Photo AI</div>
    <div class="card" style="padding:4px 18px">
      <div class="field"><label>Gemini key<div class="sub">aistudio.google.com</div></label><input class="key" type="password" id="gkey" value="${esc(s.ai.geminiKey)}" placeholder="Paste key" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label>USDA key<div class="sub">fdc.nal.usda.gov</div></label><input class="key" type="password" id="ukey" value="${esc(s.ai.usdaKey)}" placeholder="Paste key" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    </div>
    <div class="row-btns"><button class="btn black block" id="ai-save">Save &amp; test</button></div>
    <div class="card" style="margin-top:12px" id="ai-status">${aiStatus(s)}</div>
    <p class="note">Keys are saved only on this phone. Photos you scan are sent to Google Gemini to identify the food; food names are sent to USDA to look up calories.</p>

    <div class="h2">Your data</div>
    <div class="card">
      <p class="note" style="margin:0 0 12px">Everything is stored only on this phone — no account, no cloud. ${standalone ? '' : '<b>Add this app to your Home Screen</b> so your phone keeps the data safe.'} Export a backup now and then.</p>
      <div class="row-btns">
        <button class="btn white block" id="export">Export backup</button>
        <label class="btn white block" style="position:relative">Import backup<input id="import" type="file" accept="application/json,.json" style="position:absolute;inset:0;opacity:0"></label>
        <button class="btn white block danger" id="wipe">Delete all data</button>
      </div>
    </div>
    <p class="note" style="text-align:center;margin:22px 0 0">Plate · personal calorie tracker</p>
  `;

  // goals
  view.querySelectorAll('[data-goal]').forEach((inp) => inp.addEventListener('change', () => {
    const v = Math.round(Number(inp.value));
    if (!(v > 0)) { inp.value = s.goals[inp.dataset.goal]; return; }
    s.goals[inp.dataset.goal] = v; saveSettings(s); toast('Goal saved');
  }));
  // profile
  const readProfile = () => {
    view.querySelectorAll('[data-p]').forEach((el) => {
      const k = el.dataset.p;
      pr[k] = ['sex', 'goal'].includes(k) ? el.value : Number(el.value);
    });
    if (imp) {
      pr.height = Math.round((Number(view.querySelector('#ft').value) * 12 + Number(view.querySelector('#in').value)) * 2.54);
      pr.weight = Math.round((Number(view.querySelector('#lb').value) / 2.20462) * 10) / 10;
    }
  };
  view.querySelector('#units').addEventListener('change', (e) => { readProfile(); pr.units = e.target.value; saveSettings(s); route(); });
  view.querySelector('#calc').addEventListener('click', () => {
    readProfile();
    if (!(pr.age > 0 && pr.height > 0 && pr.weight > 0)) { toast('Fill in age, height and weight'); return; }
    s.goals = calcGoals(pr);
    saveSettings(s);
    toast(`Daily goal set to ${s.goals.k.toLocaleString()} kcal`);
    route();
  });

  // AI keys
  view.querySelector('#ai-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const box = view.querySelector('#ai-status');
    s.ai.geminiKey = view.querySelector('#gkey').value.trim();
    s.ai.usdaKey = view.querySelector('#ukey').value.trim();
    s.ai.model = '';
    saveSettings(s);
    btn.disabled = true; btn.textContent = 'Testing…';
    const st = {};
    if (s.ai.geminiKey) {
      try { s.ai.model = await pickModel(s.ai.geminiKey); st.g = `Photo AI ready — ${esc(s.ai.model)}`; st.gOk = true; }
      catch (err) { st.g = `Gemini: ${esc(err.message)}`; st.gOk = false; }
    }
    if (s.ai.usdaKey) {
      try { const ok = await testUSDA(s.ai.usdaKey); st.u = ok ? 'USDA food database connected' : 'USDA answered but found nothing'; st.uOk = ok; }
      catch (err) { st.u = `USDA: ${esc(err.message)}`; st.uOk = false; }
    }
    saveSettings(s);
    box.innerHTML = aiStatus(s, st);
    btn.disabled = false; btn.textContent = 'Save & test';
    toast(st.gOk === false || st.uOk === false ? 'Check the key that failed' : 'Saved');
  });

  // backup
  view.querySelector('#export').addEventListener('click', async () => {
    const meals = await allMeals();
    const blob = new Blob([JSON.stringify({ app: 'plate', version: 1, exportedAt: new Date().toISOString(), settings: s, meals })], { type: 'application/json' });
    const name = `plate-backup-${todayKey()}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  view.querySelector('#import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'plate' || !Array.isArray(data.meals)) throw new Error('Not a Plate backup');
      await putMany(data.meals);
      if (data.settings?.goals) { s.goals = { ...s.goals, ...data.settings.goals }; saveSettings(s); }
      toast(`Imported ${data.meals.length} meals`);
      route();
    } catch (err) { toast(err.message || 'Import failed'); }
  });
  view.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('Delete ALL meals and photos from this phone? This cannot be undone.')) return;
    await clearMeals();
    toast('All data deleted');
    route();
  });
}
