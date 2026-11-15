import { renderHome } from './ui/home.js';
import { renderMeal } from './ui/meal.js';
import { renderProgress } from './ui/progress.js';
import { renderSettings } from './ui/settings.js';
import { openSheet, ICON } from './ui/components.js';
import { requestPersist } from './db.js';
import { todayKey, uid, fileToDataUrl, toast } from './util.js';

export const state = {
  day: todayKey(),     // day selected on home
  draft: null,         // meal being created/edited
  progressMode: 'week',
  progressAnchor: null,
};

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

const routes = [
  [/^#?\/?$/, 'home', () => renderHome(view)],
  [/^#\/progress$/, 'progress', () => renderProgress(view)],
  [/^#\/settings$/, 'settings', () => renderSettings(view)],
  [/^#\/meal\/(.+)$/, null, (m) => renderMeal(view, m[1])],
];

export async function route() {
  const h = location.hash || '#/';
  for (const [re, tab, fn] of routes) {
    const m = h.match(re);
    if (!m) continue;
    tabs.classList.toggle('hidden', !tab);
    view.classList.toggle('full', !tab);
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    document.querySelector('.fab')?.remove();
    window.scrollTo(0, 0);
    await fn(m);
    return;
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

// ---------- new meal entry points ----------
export function newMeal(photo = null) {
  const now = new Date();
  // log onto the selected day, keeping the current time of day
  const [y, mo, d] = state.day.split('-').map(Number);
  const ts = new Date(y, mo - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).getTime();
  state.draft = { id: uid(), ts, day: state.day, name: '', photo, items: [], servings: 1, chat: [], isNew: true, analyzing: !!photo };
  location.hash = '#/meal/new';
}

export function openAddSheet() {
  openSheet(`
    <div class="actions">
      <button class="action" data-a="camera">${ICON.camera}Scan food</button>
      <button class="action" data-a="library">${ICON.image}Photo library</button>
      <button class="action" data-a="text">${ICON.pencil}Describe it</button>
    </div>`, (sheet, close) => {
    sheet.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      close();
      if (a === 'camera') document.getElementById('file-camera').click();
      if (a === 'library') document.getElementById('file-library').click();
      if (a === 'text') newMeal(null);
    });
  });
}

for (const id of ['file-camera', 'file-library']) {
  const input = document.getElementById(id);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file, 1280, 0.85);
      newMeal(dataUrl);
    } catch (e) {
      console.error(e);
      toast("Couldn't read that photo");
    }
  });
}

// ---------- boot ----------
requestPersist();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();
