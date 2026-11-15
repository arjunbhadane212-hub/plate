import { clamp } from '../util.js';

export const ICON = {
  flame: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12.6 2.2c.3 2.6-.8 4.3-2.2 5.9-1.5 1.7-3.4 3.4-3.4 6.6A5.1 5.1 0 0 0 12 20c2.9 0 5-2.2 5-5.3 0-1.9-.8-3.4-1.9-4.6.1 1.4-.4 2.6-1.6 3.1.4-3.6-.5-7.4-.9-11z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.6" stroke="currentColor" stroke-width="1.9" fill="none"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" stroke-width="1.9" fill="none"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.9"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  fork: '<svg viewBox="0 0 24 24"><path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6M16 21V3c-2 1.5-3 4-3 7 0 1.7 1.3 3 3 3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  wheat: '<svg viewBox="0 0 24 24"><path d="M12 22V9M12 13c-3 0-4.5-2-4.5-4.5C10.5 8.5 12 10 12 13zm0 0c3 0 4.5-2 4.5-4.5C13.5 8.5 12 10 12 13zm0-4.5c-2.5 0-3.8-1.7-3.8-3.8C10.7 4.7 12 6 12 8.5zm0 0c2.5 0 3.8-1.7 3.8-3.8C13.3 4.7 12 6 12 8.5zM12 18c-3 0-4.5-2-4.5-4.5 3 0 4.5 1.5 4.5 4.5zm0 0c3 0 4.5-2 4.5-4.5-3 0-4.5 1.5-4.5 4.5z" fill="currentColor"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.5S5.5 9.6 5.5 14a6.5 6.5 0 0 0 13 0C18.5 9.6 12 2.5 12 2.5z"/></svg>',
  logo: '<svg viewBox="0 0 24 24"><defs><mask id="bite"><rect width="24" height="24" fill="#fff"/><circle cx="18.6" cy="6.6" r="3" fill="#000"/><circle cx="20.4" cy="10.6" r="2.5" fill="#000"/></mask></defs><circle cx="12" cy="12" r="8.5" fill="#fff" mask="url(#bite)"/></svg>',
};

export const MACRO = [
  { key: 'p', label: 'Protein', color: 'var(--protein)', icon: ICON.bolt },
  { key: 'c', label: 'Carbs', color: 'var(--carbs)', icon: ICON.wheat },
  { key: 'f', label: 'Fats', color: 'var(--fat)', icon: ICON.drop },
];

/** SVG progress ring. */
export function ring(pct, { size = 96, stroke = 9, color = '#111', track = '#EFEFF3', inner = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = clamp(pct, 0, 1);
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" style="transition:stroke-dashoffset .6s ease"/>
    </svg>
    <div class="ic">${inner}</div>
  </div>`;
}

/** Bottom sheet helper. Returns close(). */
export function openSheet(html, onMount) {
  const root = document.getElementById('sheet-root');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="grab"></div>${html}`;
  root.append(scrim, sheet);
  requestAnimationFrame(() => { scrim.classList.add('in'); sheet.classList.add('in'); });
  const close = () => {
    scrim.classList.remove('in'); sheet.classList.remove('in');
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 280);
  };
  scrim.onclick = close;
  onMount?.(sheet, close);
  return close;
}
