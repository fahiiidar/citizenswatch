// Tiny UI toolkit: safe HTML templates, icons, help tips, modals and toasts.

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Every interpolated value is escaped unless it is itself an html`` result.
export function html(strings, ...values) {
  let out = '';
  strings.forEach((str, i) => {
    out += str;
    if (i < values.length) out += render(values[i]);
  });
  return new Safe(out);
}
function render(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}
export const raw = (s) => new Safe(String(s));

export function mount(el, content) {
  el.innerHTML = String(content);
  return el;
}

// ---- Icons (24px grid, drawn with strokes) ----------------------------------
const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17.2h.01" stroke-width="2.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8h.01" stroke-width="2.6"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12l5 5L19 7"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
  xcircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  pin: '<path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  eyeoff: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  arrow: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  landmark: '<rect x="3" y="9" width="18" height="10" rx="2"/><path d="M6 9V6h12v3M7 19v2M17 19v2"/>',
  street: '<path d="M5 21L9 3M19 21L15 3M12 5v2M12 11v2M12 17v2"/>',
  area: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  // Categories
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  userx: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7"/><path d="M16 15l5 5M21 15l-5 5"/>',
  flame: '<path d="M12 2c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 1.5-4.5 3-6 0 2 1 3 2 3 0-3 0-5 1-8z"/>',
  bag: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/>',
  badge: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><path d="M12 8v4.5"/><path d="M12 15.6h.01" stroke-width="2.6"/>',
};

export function icon(name, size = 20, extra = '') {
  return raw(`<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`);
}

// ---- Help tips: tap a small (i) to read a one-line explanation --------------
import { TIPS } from './format.js';

export function tip(key, label, cls = '') {
  return html`<button type="button" class="tip ${cls}" data-tip="${key}" aria-label="${label}" aria-expanded="false">${icon('info', 15)}</button>`;
}

let openTip = null;
function closeTip() {
  if (!openTip) return;
  openTip.box.remove();
  openTip.btn.setAttribute('aria-expanded', 'false');
  openTip.btn.focus({ preventScroll: true });
  openTip = null;
}

function showTip(btn) {
  const key = btn.dataset.tip;
  const data = TIPS[key];
  if (!data) return;
  if (openTip && openTip.btn === btn) return closeTip();
  closeTip();
  const box = document.createElement('div');
  box.className = 'tipbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', data.title);
  box.innerHTML = String(html`<span class="arrow"></span><b>${data.title}</b><p>${data.text}</p><button type="button">Got it</button>`);
  document.body.appendChild(box);
  const r = btn.getBoundingClientRect();
  const bw = box.offsetWidth;
  const bh = box.offsetHeight;
  let left = Math.min(Math.max(16, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 16);
  const below = r.bottom + 10 + bh < window.innerHeight - 8;
  const top = below ? r.bottom + 10 : r.top - bh - 10;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  const arrow = box.querySelector('.arrow');
  arrow.style.left = `${Math.min(Math.max(12, r.left + r.width / 2 - left - 6), bw - 24)}px`;
  arrow.style[below ? 'top' : 'bottom'] = '-6px';
  btn.setAttribute('aria-expanded', 'true');
  box.querySelector('button').addEventListener('click', closeTip);
  box.querySelector('button').focus({ preventScroll: true });
  openTip = { btn, box };
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tip]');
  if (btn) { e.preventDefault(); e.stopPropagation(); showTip(btn); return; }
  if (openTip && !openTip.box.contains(e.target)) closeTip();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTip(); });
window.addEventListener('resize', closeTip);
document.addEventListener('scroll', closeTip, true);

// ---- Modal sheets -------------------------------------------------------------
export function openModal({ title, body, onMount, label }) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const modal = document.createElement('section');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', label || title);
  modal.innerHTML = String(html`
    <div class="modal-head"><h2>${title}</h2>
      <button type="button" class="round-btn" data-close aria-label="Close" style="width:36px;height:36px">${icon('x', 18, 'style="stroke-width:2.2"')}</button></div>
    <div class="modal-body">${body}</div>`);
  const previous = document.activeElement;
  document.body.append(scrim, modal);
  const close = () => {
    scrim.remove();
    modal.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    if (previous && previous.focus) previous.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const items = modal.querySelectorAll('button, input, a[href], textarea, select');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  // Going to another screen (including the phone's back button) closes it.
  window.addEventListener('hashchange', close);
  scrim.addEventListener('click', close);
  modal.querySelector('[data-close]').addEventListener('click', close);
  if (onMount) onMount(modal, close);
  const focusTarget = modal.querySelector('[aria-checked="true"]') || modal.querySelector('[data-close]');
  focusTarget?.focus({ preventScroll: true });
  return close;
}

// ---- Toasts -----------------------------------------------------------------
let toastTimer;
export function toast(message, ms = 3200) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

export async function shareReport(report) {
  const url = `${location.origin}/r/${report.id}`;
  const text = `${report.title} · ${report.where}. See live updates on CitizensWatch.`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'CitizensWatch alert', text, url });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Link copied. Paste it into WhatsApp or anywhere else.');
  } catch {
    toast(url, 6000);
  }
}
