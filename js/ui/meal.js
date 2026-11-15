import { state } from '../app.js';
import { getMeal, saveMeal, deleteMeal, savePhoto, getPhoto } from '../db.js';
import { mealTotals, itemTotals, amountLabel, itemStep } from '../nutrition.js';
import { summary, help } from '../chat.js';
import { ai } from '../ai.js';
import { fmt, fmtTime, prettyDay, esc, toast, shrinkDataUrl } from '../util.js';
import { ICON, MACRO } from './components.js';

const SERVINGS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

export async function renderMeal(view, id) {
  let meal;
  if (id === 'new') {
    meal = state.draft;
    if (!meal) { location.hash = '#/'; return; }
  } else if (state.draft && state.draft.id === id) {
    meal = state.draft;
  } else {
    const saved = await getMeal(id);
    if (!saved) { toast('Meal not found'); location.hash = '#/'; return; }
    meal = structuredClone(saved);
    meal.chat ||= [];
    meal.photo = saved.thumb ? (await getPhoto(id)) || saved.thumb : null;
    state.draft = meal;
  }
  const original = JSON.stringify({ i: meal.items, s: meal.servings, n: meal.name });
  const hist = [];
  const openItems = new Set();
  let chatEl = null, scrimEl = null;

  view.innerHTML = `
    <div class="hero ${meal.photo ? '' : 'nophoto'}" ${meal.photo ? `style="background-image:url('${meal.photo}')"` : ''}>
      <div class="bar">
        <button class="iconbtn" id="back" aria-label="Back">${ICON.back}</button>
        ${meal.isNew ? '' : `<button class="iconbtn" id="del" aria-label="Delete" style="color:#E5484D">${ICON.trash}</button>`}
      </div>
    </div>
    <div class="panel" id="panel"></div>
    <div class="bottom"><div class="inner">
      <button class="btn white" id="fix">${ICON.spark}Fix results</button>
      <button class="btn black" id="done">${meal.isNew ? 'Log meal' : 'Done'}</button>
    </div></div>`;
  const panel = view.querySelector('#panel');

  const autoName = () => {
    if (meal.nameEdited) return meal.name;
    const n = meal.items.map((i) => i.name);
    if (!n.length) return '';
    if (n.length === 1) return n[0];
    if (n.length === 2) return `${n[0]} & ${n[1]}`;
    return `${n[0]}, ${n[1]} +${n.length - 2}`;
  };

  function paint() {
    meal.name = autoName();
    const t = mealTotals(meal);
    const s = meal.servings || 1;
    const items = meal.items.map((it) => {
      const k = itemTotals(it).k * s;
      const tag = it.source === 'user' ? '<span class="tag">YOUR KCAL</span>' : it.source === 'ai' ? '<span class="tag">AI EST.</span>' : it.source === 'usda' ? '<span class="tag">USDA</span>' : '';
      return `<div class="it ${openItems.has(it.id) ? 'open' : ''}" data-id="${it.id}">
        <div class="r" data-toggle>
          <div><div class="n">${esc(it.name)}${tag}</div><div class="a">${amountLabel(it)}</div>${it.match ? `<div class="m">${esc(it.match)}</div>` : ''}</div>
          <div class="k">${fmt(k)} kcal</div>
        </div>
        <div class="edit">
          <div class="grams">
            <div class="stepper"><button data-step="-1">−</button></div>
            <input type="number" inputmode="decimal" value="${Math.round(it.grams)}" data-grams aria-label="grams">
            <div class="stepper"><button data-step="1">+</button></div>
            <span class="muted" style="margin-left:4px">g</span>
          </div>
          <button class="del" data-remove>Remove</button>
        </div>
      </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="meta"><span>${prettyDay(meal.day)} · ${fmtTime(meal.ts)}</span><span>${ai.connected ? 'AI estimate' : ''}</span></div>
      <input class="title-in" id="name" placeholder="${meal.analyzing ? 'Analyzing…' : 'Name this meal'}" value="${esc(meal.name)}">
      <div class="servings"><span class="lbl">Servings</span>
        <div class="stepper"><button id="sv-">−</button><span class="val">${s}</span><button id="sv+">+</button></div>
      </div>
      ${meal.analyzing ? `<div class="card scan"><b>Analyzing your plate…</b><div class="shimmer" style="width:80%"></div><div class="shimmer" style="width:55%"></div><div class="shimmer" style="width:68%"></div></div>` : `
      <div class="card kcal-card"><div class="ico">${ICON.flame}</div><div><div class="lbl">Calories</div><div class="num">${fmt(t.k)}</div></div></div>
      <div class="mini3">${MACRO.map((m) => `<div class="mini"><div class="lbl"><span style="color:${m.color};width:14px;display:inline-block">${m.icon}</span>${m.label}</div><div class="num">${fmt(t[m.key])}g</div></div>`).join('')}</div>
      <div class="h2">Ingredients <button class="link" id="add-item">+ Add</button></div>
      <div class="items">${items || `<div class="card empty" style="padding:22px"><b>No items yet</b>Tap <b style="display:inline">Fix results</b> and tell me what's on the plate.</div>`}</div>
      <p class="note">Calories come from a built-in USDA-based food table. Tap any item to fine-tune its portion; use Fix results for anything else.</p>`}
    `;
    if (chatEl) chatEl.querySelector('.live').textContent = summary(meal);
  }

  // ---------- panel events ----------
  panel.addEventListener('click', (e) => {
    const itEl = e.target.closest('.it');
    if (e.target.closest('#sv-') || e.target.closest('#sv\\+')) {
      const cur = meal.servings || 1;
      const next = e.target.closest('#sv-')
        ? [...SERVINGS].reverse().find((v) => v < cur - 1e-9) ?? cur
        : SERVINGS.find((v) => v > cur + 1e-9) ?? cur;
      snapshot(); meal.servings = next; paint(); return;
    }
    if (e.target.closest('#add-item')) { openChat(); return; }
    if (!itEl) return;
    const it = meal.items.find((x) => x.id === itEl.dataset.id);
    if (e.target.closest('[data-toggle]')) {
      openItems.has(it.id) ? openItems.delete(it.id) : openItems.add(it.id);
      itEl.classList.toggle('open');
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      snapshot();
      it.grams = Math.max(1, Math.round(it.grams + Number(step.dataset.step) * itemStep(it)));
      paint(); return;
    }
    if (e.target.closest('[data-remove]')) {
      snapshot();
      meal.items = meal.items.filter((x) => x !== it);
      paint();
    }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.matches('[data-grams]')) {
      const it = meal.items.find((x) => x.id === e.target.closest('.it').dataset.id);
      const v = parseFloat(e.target.value);
      if (v > 0) { snapshot(); it.grams = Math.round(v); }
      paint();
    }
  });
  panel.addEventListener('input', (e) => {
    if (e.target.id === 'name') { meal.name = e.target.value; meal.nameEdited = !!e.target.value.trim(); }
  });

  function snapshot() { hist.push(structuredClone({ items: meal.items, servings: meal.servings })); if (hist.length > 50) hist.shift(); }

  // ---------- chat ----------
  function suggestions() {
    if (!meal.items.length) return ['2 eggs and toast with butter', 'rice and chicken curry', 'chicken salad 450 kcal', 'help'];
    const first = meal.items[0].name.toLowerCase(), last = meal.items[meal.items.length - 1].name.toLowerCase();
    return [`you missed the sauce`, `more ${first}`, `remove ${last}`, 'I only ate half', 'undo'];
  }
  function renderMsgs() {
    const box = chatEl.querySelector('.msgs');
    box.innerHTML = meal.chat.map((m) => `<div class="bubble ${m.role}">${esc(m.text)}</div>`).join('');
    box.scrollTop = box.scrollHeight;
    chatEl.querySelector('.chips').innerHTML = suggestions().map((s) => `<button class="chip">${esc(s)}</button>`).join('');
  }
  function openChat(focus = true) {
    if (chatEl) { if (focus) chatEl.querySelector('input').focus(); return; }
    scrimEl = document.createElement('div'); scrimEl.className = 'scrim';
    chatEl = document.createElement('div'); chatEl.className = 'chat';
    chatEl.innerHTML = `
      <div class="head"><div class="grab" style="margin-bottom:8px"></div>
        <div class="t"><b>Fix results</b><button class="iconbtn" style="width:32px;height:32px;box-shadow:none;background:var(--chip)" data-close>${ICON.close}</button></div>
        <div class="live"></div></div>
      <div class="msgs"></div>
      <div class="chips"></div>
      <form class="composer"><input placeholder="e.g. you missed the rice" autocomplete="off" enterkeyhint="send"><button class="send" aria-label="Send">${ICON.send}</button></form>`;
    document.getElementById('sheet-root').append(scrimEl, chatEl);
    if (!meal.chat.length) {
      meal.chat.push({ role: 'bot', text: ai.connected
        ? "Here's what I see. Anything I missed or got wrong? Just tell me."
        : `${meal.photo ? "Photo AI isn't connected yet, so describe the plate and I'll do the math." : "What did you eat?"} ${help(true)}` });
    }
    renderMsgs();
    chatEl.querySelector('.live').textContent = summary(meal);
    requestAnimationFrame(() => { scrimEl.classList.add('in'); chatEl.classList.add('in'); });
    scrimEl.onclick = closeChat;
    chatEl.querySelector('[data-close]').onclick = closeChat;
    chatEl.querySelector('.chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) send(c.textContent); });
    chatEl.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = chatEl.querySelector('input');
      const v = inp.value.trim();
      if (v) { inp.value = ''; send(v); }
    });
    fitKeyboard();
    if (focus) setTimeout(() => chatEl?.querySelector('input').focus(), 320);
  }
  function closeChat() {
    if (!chatEl) return;
    const c = chatEl, s = scrimEl;
    chatEl = scrimEl = null;
    c.classList.remove('in'); s.classList.remove('in');
    c.querySelector('input').blur();
    setTimeout(() => { c.remove(); s.remove(); }, 300);
  }
  async function send(text) {
    meal.chat.push({ role: 'me', text });
    renderMsgs();
    let reply;
    try {
      const res = await ai.revise(meal, text);
      if (res.undo) {
        if (hist.length) {
          const h = hist.pop();
          meal.items = h.items; meal.servings = h.servings;
          reply = `Undone. ${summary(meal)}`;
        } else reply = 'Nothing to undo.';
      } else {
        if (res.changed) { snapshot(); meal.items = res.meal.items; meal.servings = res.meal.servings; }
        reply = res.reply;
      }
    } catch (err) {
      reply = `Something went wrong: ${err.message}`;
    }
    meal.chat.push({ role: 'bot', text: reply });
    paint();
    if (chatEl) renderMsgs();
  }
  function fitKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      if (!chatEl) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); return; }
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      chatEl.style.bottom = kb + 'px';
      chatEl.style.height = Math.min(vv.height * (kb ? 0.92 : 0.72), 620) + 'px';
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
  }

  // ---------- footer ----------
  const leave = () => { closeChat(); state.draft = null; location.hash = '#/'; };
  view.querySelector('#back').onclick = () => {
    const dirty = JSON.stringify({ i: meal.items, s: meal.servings, n: meal.name }) !== original;
    if (dirty && !confirm(meal.isNew ? 'Discard this meal?' : 'Discard your changes?')) return;
    leave();
  };
  view.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm('Delete this meal? This cannot be undone.')) return;
    await deleteMeal(meal.id);
    toast('Meal deleted');
    leave();
  });
  view.querySelector('#fix').onclick = () => openChat();
  view.querySelector('#done').onclick = async () => {
    if (!meal.items.length) { toast('Add at least one item first'); openChat(); return; }
    const btn = view.querySelector('#done');
    btn.disabled = true;
    const out = {
      id: meal.id, ts: meal.ts, day: meal.day,
      name: (meal.name || '').trim() || autoName() || 'Meal',
      nameEdited: !!meal.nameEdited,
      thumb: meal.photo ? (meal.isNew ? await shrinkDataUrl(meal.photo, 200, 0.7) : meal.thumb) : null,
      items: meal.items, servings: meal.servings || 1,
      chat: meal.chat.slice(-40),
      source: ai.connected ? 'ai' : 'manual',
    };
    if (meal.photo && meal.isNew) await savePhoto(meal.id, await shrinkDataUrl(meal.photo, 900, 0.75));
    await saveMeal(out);
    state.day = meal.day;
    toast(meal.isNew ? `Logged ${fmt(mealTotals(out).k)} kcal` : 'Saved');
    leave();
  };

  paint();

  // ---------- first analysis for a new photo ----------
  if (meal.analyzing) {
    let result = null, error = null;
    try {
      [result] = await Promise.all([ai.analyzePhoto(meal.photo), new Promise((r) => setTimeout(r, 700))]);
    } catch (err) {
      error = err;
      console.warn(err);
    }
    if (state.draft !== meal) return; // navigated away
    meal.analyzing = false;
    if (result?.items?.length) {
      meal.items = result.items;
      if (result.name && !meal.nameEdited) { meal.name = result.name; meal.nameEdited = true; }
      const guessed = result.items.filter((i) => i.source === 'ai').length;
      meal.chat.push({ role: 'bot', text: `I see: ${result.items.map((i) => i.name).join(', ')}.${guessed ? ` ${guessed} item${guessed > 1 ? 's are' : ' is'} my own estimate (marked AI EST.).` : ''} Anything I missed or got wrong? Tell me here.` });
    } else if (error) {
      meal.chat.push({ role: 'bot', text: `Photo analysis didn't work: ${error.message}. Describe the plate instead and I'll do the math.` });
    } else if (result) {
      meal.chat.push({ role: 'bot', text: `${result.note || "I couldn't find any food in that photo."} Tell me what you ate instead.` });
    }
    paint();
    if (!result?.items?.length) openChat();
  } else if (meal.isNew && !meal.items.length) {
    openChat();
  }
}
