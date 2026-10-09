// The home screen: floating search and filters over the map, plus the bottom sheet.
import { html, icon, tip, mount, openModal, toast } from './ui.js';
import { api } from './api.js';
import { state, saveFilters, setReports } from './state.js';
import { CATS, CAT_KEYS, STATUS, RANGES, rangeTitle, shortAgo, whereLabel, timeAgo, lagosDate, catTitle } from './format.js';
import * as mapMod from './map.js';

const root = document.getElementById('home');
let sheetMode = 'overview';
let area = null; // { ids, sort, details }
let snap = 'half';
let searchTimer = null;
let searchSeq = 0;

// ---------------------------------------------------------------------------
export function renderHome() {
  mount(root, html`
    <div class="topbar">
      <div class="search" role="search">
        ${icon('search', 20, 'style="color:var(--muted)"')}
        <label for="q" class="sr">Search a town, street or landmark</label>
        <input id="q" type="search" placeholder="Search a town, street or landmark" autocomplete="off" enterkeyhint="search">
        <button type="button" class="round-btn" id="help-btn" aria-label="How CitizensWatch works">${icon('help', 20)}</button>
        <div class="results" id="results" role="listbox" aria-label="Places" hidden></div>
      </div>
      <div class="chips" id="chips"></div>
    </div>
    <button type="button" class="round-btn float locate" id="locate" aria-label="Show my area">${icon('locate', 20)}</button>
    <a class="fab" id="fab" href="#/report">${icon('plus', 20, 'style="stroke-width:2.4"')}Report</a>
    <section class="sheet" id="sheet" aria-label="Reports">
      <div class="sheet-grab" id="grab" aria-hidden="true"><span></span></div>
      <div class="sheet-body" id="sheet-body"></div>
    </section>`);

  renderChips();
  renderSheet();
  bindSearch();
  bindSheetDrag();
  root.querySelector('#help-btn').addEventListener('click', openHelp);
  root.querySelector('#locate').addEventListener('click', locateMe);
  window.addEventListener('resize', () => setSnap(snap));
  setSnap('half');
}

export function showHome(visible) {
  root.hidden = !visible;
}

// ---- Data -------------------------------------------------------------------
export async function refresh({ quiet = false } = {}) {
  try {
    const data = await api.list(state.filters);
    setReports(data);
    mapMod.setReports(state.reports);
  } catch (err) {
    state.loadError = err.message;
    if (!quiet) toast(err.message);
  }
  if (sheetMode === 'overview') renderSheet();
}

// ---- Chips and filters --------------------------------------------------------
function renderChips() {
  const f = state.filters;
  const catCount = f.cats.length;
  mount(root.querySelector('#chips'), html`
    <button type="button" class="chip on" id="chip-range" aria-haspopup="dialog">${icon('clock', 16)}${rangeTitle(f)}${icon('down', 14, 'style="stroke-width:2.4"')}</button>
    <button type="button" class="chip ${catCount ? 'on' : ''}" id="chip-cats" aria-haspopup="dialog">${catCount ? `${catCount} categor${catCount === 1 ? 'y' : 'ies'}` : 'All categories'}${icon('down', 14, 'style="stroke-width:2.4"')}</button>
    <button type="button" class="chip ${f.corroborated ? 'on' : ''}" id="chip-cor" aria-pressed="${f.corroborated}">${f.corroborated ? icon('check', 16) : ''}Corroborated only</button>
    <button type="button" class="chip ${f.ended ? 'on' : ''}" id="chip-ended" aria-pressed="${f.ended}">${f.ended ? icon('check', 16) : ''}Include ended</button>`);
  root.querySelector('#chip-range').addEventListener('click', openRangePicker);
  root.querySelector('#chip-cats').addEventListener('click', openCategoryPicker);
  root.querySelector('#chip-ended').addEventListener('click', () => {
    state.filters.ended = !state.filters.ended;
    applyFilters();
  });
  root.querySelector('#chip-cor').addEventListener('click', () => {
    state.filters.corroborated = !state.filters.corroborated;
    applyFilters();
  });
}

function applyFilters() {
  saveFilters();
  renderChips();
  closeArea();
  refresh();
}

export function openRangePicker() {
  const f = state.filters;
  const maxDays = state.config?.maxDaysBack || 30;
  const today = lagosDate();
  const minDay = lagosDate(Date.now() - 365 * 86400e3);
  const options = Object.entries(RANGES).map(([key, label]) => html`
    <button type="button" class="opt" role="radio" data-range="${key}" aria-checked="${f.range === key}">
      <span class="radio"></span><span style="flex:1">${label}</span>
      ${key === '1h' ? html`<span class="badge live">Live only</span>` : ''}
      ${key === '24h' ? html`<span class="badge unverified">Default</span>` : ''}
    </button>`);
  const close = openModal({
    title: 'Show reports from',
    body: html`
      <div role="radiogroup" aria-label="Time range">
        ${options}
        <button type="button" class="opt" role="radio" data-range="custom" aria-checked="${f.range === 'custom'}">
          <span class="radio"></span><span style="flex:1">Choose dates</span>${icon('calendar', 18, 'style="color:var(--muted)"')}
        </button>
      </div>
      <div id="custom" style="padding:4px 20px 0" ${f.range === 'custom' ? '' : 'hidden'}>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)">From
            <input class="input" type="date" id="from" min="${minDay}" max="${today}" value="${f.from || lagosDate(Date.now() - 6 * 86400e3)}"></label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)">To
            <input class="input" type="date" id="to" min="${minDay}" max="${today}" value="${f.to || today}"></label>
        </div>
        <p class="error-text" id="range-err" hidden></p>
      </div>
      <div class="note-box">${icon('info', 18, 'style="margin-top:1px"')}<span>On longer ranges, older reports show lighter on the map so today's danger still stands out. Reports can be filed up to ${maxDays} days after something happened.</span></div>
      <div style="padding:16px 20px 0"><button type="button" class="btn" id="apply">Show reports</button></div>`,
    onMount(modal, done) {
      let choice = f.range;
      modal.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
        choice = b.dataset.range;
        modal.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        modal.querySelector('#custom').hidden = choice !== 'custom';
      }));
      modal.querySelector('#apply').addEventListener('click', () => {
        if (choice === 'custom') {
          const from = modal.querySelector('#from').value;
          const to = modal.querySelector('#to').value;
          const err = modal.querySelector('#range-err');
          const span = (Date.parse(to) - Date.parse(from)) / 86400e3;
          if (!from || !to || from > to) { err.hidden = false; err.textContent = 'Choose a start date on or before the end date.'; return; }
          if (span > 92) { err.hidden = false; err.textContent = 'Choose a range of 3 months or less.'; return; }
          Object.assign(state.filters, { range: 'custom', from, to });
        } else {
          Object.assign(state.filters, { range: choice, from: null, to: null });
        }
        done();
        applyFilters();
      });
    },
  });
  return close;
}

function openCategoryPicker() {
  const selected = new Set(state.filters.cats.length ? state.filters.cats : CAT_KEYS);
  openModal({
    title: 'Categories',
    body: html`
      <div role="group" aria-label="Categories">
        ${CAT_KEYS.map((k) => html`
          <button type="button" class="opt" role="checkbox" data-cat="${k}" aria-checked="${selected.has(k)}">
            <span class="box">${icon('check', 14, 'style="stroke-width:3"')}</span>
            <span class="ct sm ${CATS[k].tone}">${icon(CATS[k].icon, 17)}</span>
            <span style="flex:1">${CATS[k].name}</span>
          </button>`)}
      </div>
      <div style="padding:16px 20px 0" class="btn-row">
        <button type="button" class="btn ghost" id="all">Show all</button>
        <button type="button" class="btn" id="apply" style="height:48px;font-size:15px">Apply</button>
      </div>`,
    onMount(modal, done) {
      modal.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.cat;
        if (selected.has(k)) selected.delete(k); else selected.add(k);
        b.setAttribute('aria-checked', String(selected.has(k)));
      }));
      modal.querySelector('#all').addEventListener('click', () => {
        state.filters.cats = [];
        done();
        applyFilters();
      });
      modal.querySelector('#apply').addEventListener('click', () => {
        if (!selected.size) { toast('Choose at least one category.'); return; }
        state.filters.cats = selected.size === CAT_KEYS.length ? [] : [...selected];
        done();
        applyFilters();
      });
    },
  });
}

// ---- Search -------------------------------------------------------------------
function bindSearch() {
  const input = root.querySelector('#q');
  const box = root.querySelector('#results');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    searchTimer = setTimeout(() => runSearch(q, box, (r) => {
      input.value = r.label;
      box.hidden = true;
      input.blur();
      mapMod.flyTo(r.lng, r.lat, r.kind === 'area' ? 11 : 14);
    }), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { box.hidden = true; input.blur(); }
    if (e.key === 'Enter') box.querySelector('.result')?.click();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
}

export async function runSearch(q, box, onPick) {
  const seq = ++searchSeq;
  try {
    const { results } = await api.search(q, mapMod.center());
    if (seq !== searchSeq) return;
    mount(box, results.length ? html`
      ${results.map((r, i) => html`
        <button type="button" class="result" role="option" data-i="${i}">
          <span class="result-ic ${r.kind === 'street' ? 'street' : ''}">${icon(r.kind === 'street' ? 'street' : r.kind === 'area' ? 'area' : 'landmark', 18)}</span>
          <span style="min-width:0"><b>${r.label}</b><small>${r.kind === 'street' ? 'Street' : r.kind === 'area' ? 'Area' : 'Landmark'}${r.sub ? ` · ${r.sub}` : ''}</small></span>
        </button>`)}
      <span class="results-note">Street has no name? Try a nearby market, school, mosque, church or motor park.</span>`
      : html`<span class="results-note" style="border:0;padding:8px 0">No places found. Try a nearby market, school, mosque, church or motor park.</span>`);
    box.hidden = false;
    box.querySelectorAll('.result').forEach((b) => b.addEventListener('click', () => onPick(results[Number(b.dataset.i)])));
  } catch (err) {
    if (seq !== searchSeq) return;
    mount(box, html`<span class="results-note" style="border:0;padding:8px 0">${err.message}</span>`);
    box.hidden = false;
  }
}

// Tapping an empty spot on the map: name it in the search bar and offer to report there.
export async function homeTap({ lat, lng }) {
  const input = root.querySelector('#q');
  const box = root.querySelector('#results');
  if (!input || root.hidden) return;
  input.value = 'Finding this place…';
  try {
    const { results } = await api.reverse(lat, lng);
    const r = results[0];
    if (!r) { input.value = ''; return; }
    input.value = r.sub ? `${r.label}, ${r.sub}` : r.label;
    mount(box, html`
      <div class="result" style="cursor:default">
        <span class="result-ic street">${icon('pin', 18)}</span>
        <span style="min-width:0"><b>${r.label}</b><small>${r.sub || r.area || ''}</small></span>
      </div>
      <button type="button" class="result" id="report-here-tap">
        <span class="result-ic" style="background:var(--red-soft);color:var(--red-icon)">${icon('plus', 18)}</span>
        <span><b>Report something here</b><small>Starts a report at this spot</small></span>
      </button>`);
    box.hidden = false;
    box.querySelector('#report-here-tap').addEventListener('click', () => {
      box.hidden = true;
      sessionStorage.setItem('cw_report_start', JSON.stringify({ lat, lng }));
      location.hash = '#/report/1';
    });
  } catch {
    input.value = '';
    toast('Could not look up that place. Try searching instead.');
  }
}

function locateMe() {
  if (!navigator.geolocation) { toast('Your browser cannot share its location.'); return; }
  toast('Finding your area… Your location stays on this phone.');
  navigator.geolocation.getCurrentPosition(
    (pos) => mapMod.flyTo(pos.coords.longitude, pos.coords.latitude, 12),
    () => toast('Location is turned off. Search for your town instead.'),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

// ---- Help ---------------------------------------------------------------------
export function openHelp() {
  openModal({
    title: 'How CitizensWatch works',
    body: html`<div class="help-body">
      <p>People post what they see, without an account. Everyone else can confirm it, call it false or flag it.</p>
      <h3>Read the badge first</h3>
      <p><span class="badge unverified">Unverified</span> Just posted. Treat it as a warning, not a fact.</p>
      <p><span class="badge corroborated">Corroborated</span> At least 3 different people nearby confirmed it.</p>
      <p><span class="badge disputed">Disputed</span> More people say it is false or old than confirm it.</p>
      <p><span class="badge live">Live</span> Marked as happening now and posted in the last hour.</p>
      <h3>You stay anonymous</h3>
      <p>We never store your name, phone number, exact location or internet address. Photos and clips are cleaned on your phone before upload.</p>
      <h3>Rules</h3>
      <p>Say what happened and where. Don't name people, blame an ethnic or religious group, or reveal where soldiers, police or people hiding are.</p>
      <div class="emergency">${icon('phone', 22)}<span><b>In danger right now?</b> Call 112 first, then post.</span></div>
    </div>`,
  });
}

// ---- Bottom sheet ---------------------------------------------------------------
function sheetHeights() {
  const sheet = root.querySelector('#sheet');
  const h = sheet.offsetHeight;
  const vh = window.innerHeight;
  return {
    full: 0,
    half: Math.max(0, h - Math.round(vh * 0.44)),
    mini: Math.max(0, h - 132),
    h,
  };
}

export function setSnap(name) {
  snap = name;
  const sheet = root.querySelector('#sheet');
  if (!sheet || window.innerWidth >= 900) {
    positionFloating(0, false);
    return;
  }
  const hs = sheetHeights();
  const y = hs[name];
  sheet.style.setProperty('--sheet-y', `${y}px`);
  positionFloating(hs.h - y, name === 'full');
}

function positionFloating(visible, hide) {
  const fab = root.querySelector('#fab');
  const loc = root.querySelector('#locate');
  if (!fab) return;
  if (window.innerWidth >= 900) {
    fab.style.bottom = '24px';
    loc.style.bottom = '24px';
    fab.style.visibility = loc.style.visibility = 'visible';
    return;
  }
  // When the sheet is fully open, the Report button floats over the list instead.
  fab.style.bottom = hide ? 'calc(16px + env(safe-area-inset-bottom, 0px))' : `${visible + 16}px`;
  fab.style.visibility = 'visible';
  loc.style.bottom = `${visible + 20}px`;
  loc.style.visibility = hide ? 'hidden' : 'visible';
}

function bindSheetDrag() {
  const sheet = root.querySelector('#sheet');
  const body = root.querySelector('#sheet-body');
  let startY = 0;
  let startOffset = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let dragging = false;

  const begin = (e) => {
    if (window.innerWidth >= 900) return;
    if (e.target.closest('button, a, input, [data-tip]')) return;
    // Only drag from the body when it is scrolled to the top.
    if (e.currentTarget === body && body.scrollTop > 0) return;
    dragging = true;
    startY = lastY = e.clientY;
    lastT = performance.now();
    startOffset = sheetHeights()[snap];
    sheet.classList.add('dragging');
  };
  const move = (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (e.currentTarget === body && snap === 'full' && dy < 0) return;
    const y = Math.min(Math.max(0, startOffset + dy), sheetHeights().mini);
    sheet.style.setProperty('--sheet-y', `${y}px`);
    const now = performance.now();
    velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const hs = sheetHeights();
    const current = parseFloat(getComputedStyle(sheet).getPropertyValue('--sheet-y')) || 0;
    let target;
    if (velocity > 0.6) target = snap === 'full' ? 'half' : 'mini';
    else if (velocity < -0.6) target = snap === 'mini' ? 'half' : 'full';
    else {
      target = ['full', 'half', 'mini'].reduce((best, k) => (
        Math.abs(hs[k] - current) < Math.abs(hs[best] - current) ? k : best), 'half');
    }
    setSnap(target);
  };

  for (const el of [root.querySelector('#grab'), body]) {
    el.addEventListener('pointerdown', begin);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  root.querySelector('#grab').addEventListener('click', () => setSnap(snap === 'full' ? 'half' : 'full'));
}

function renderSheet() {
  const body = root.querySelector('#sheet-body');
  if (!body) return;
  if (sheetMode === 'area' && area) return renderArea(body);
  const s = state.summary;
  const list = state.reports.slice(0, mapMod.mapFailed() ? 60 : 25);
  const updated = state.loadedAt ? timeAgo(new Date(state.loadedAt).toISOString()) : 'loading…';
  mount(body, html`
    <div class="sheet-head">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <button type="button" class="title-btn" id="sheet-range" aria-haspopup="dialog">
          <h2 class="sheet-title">${rangeTitle(state.filters)}</h2>${icon('down', 18, 'style="stroke-width:2.4;color:var(--muted)"')}
        </button>
        <span class="sub">Across Nigeria · updated ${updated}</span>
      </div>
    </div>
    <div class="metrics">
      <div class="metric"><b>${s.total}</b><span>Reports ${tip('total', 'What this number counts')}</span></div>
      <div class="metric"><b style="color:var(--blue)">${s.corroborated}</b><span>Corroborated ${tip('corroborated', 'What corroborated means')}</span></div>
      <div class="metric"><b style="color:var(--red-icon)">${s.live}</b><span>Live now ${tip('live', 'What live means')}</span></div>
    </div>
    <span class="section-label">Latest</span>
    ${state.loadError && !state.reports.length ? html`<p class="empty">${state.loadError}</p>` : ''}
    ${!state.loadError && state.loadedAt && !list.length ? html`<p class="empty">No reports in this time range. That is good news. Choose a longer range to see older reports.</p>` : ''}
    ${!state.loadedAt ? html`<p class="empty">Loading reports…</p>` : ''}
    ${list.map((r) => rowFor(r))}`);
  body.querySelector('#sheet-range').addEventListener('click', openRangePicker);
}

function rowFor(r) {
  const c = CATS[r.category] || CATS.other;
  return html`<a class="row-link" href="#/r/${r.id}">
    <span class="ct ${c.tone}">${icon(c.icon, 20)}</span>
    <span class="row-main">
      <span class="row-top"><b>${catTitle(r)}</b>${statusBadge(r)}</span>
      <span class="sub ellipsis">${whereLabel(r)}</span>
    </span>
    <span class="sub tnum">${shortAgo(r.occurred_at)}</span>
  </a>`;
}

export function statusBadge(r) {
  if (r.ended) return html`<span class="badge past">Over</span>`;
  if (r.live) return html`<span class="badge live">Live</span>`;
  return html`<span class="badge ${r.status}">${STATUS[r.status]}</span>`;
}

// ---- Area panel -------------------------------------------------------------------
export async function openArea(ids) {
  const sorted = ids.map((id) => state.byId.get(id)).filter(Boolean)
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  area = { ids: sorted.map((r) => r.id), sort: 'newest', details: null, error: null };
  sheetMode = 'area';
  renderSheet();
  setSnap('half');
  try {
    const { reports } = await api.details(area.ids.slice(0, 40));
    if (area) { area.details = reports; renderSheet(); }
  } catch (err) {
    if (area) { area.error = err.message; renderSheet(); }
  }
}

export function closeArea() {
  area = null;
  sheetMode = 'overview';
  renderSheet();
}

function renderArea(body) {
  const light = area.ids.map((id) => state.byId.get(id)).filter(Boolean);
  const labels = light.map((r) => r.area_label || r.place_label);
  const top = mostCommon(labels) || 'This area';
  const [title, ...rest] = top.split(',');
  const counts = {
    corroborated: light.filter((r) => r.status === 'corroborated').length,
    live: light.filter((r) => r.live).length,
    unverified: light.filter((r) => r.status === 'unverified').length,
  };
  let items = area.details || [];
  if (area.sort === 'confirmed') items = [...items].sort((a, b) => b.confirms - a.confirms);
  const centerOf = light[0];

  mount(body, html`
    <div class="sheet-head">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <h2 class="sheet-title" style="font-size:24px;letter-spacing:-0.5px">${title.trim()}</h2>
        <span class="sub" style="font-size:14px">${rest.join(',').trim() ? `${rest.join(',').trim()} · ` : ''}${light.length} report${light.length === 1 ? '' : 's'} · ${rangeTitle(state.filters).toLowerCase()}</span>
      </div>
      <button type="button" class="round-btn" id="area-close" aria-label="Back to all reports" style="width:36px;height:36px">${icon('x', 18, 'style="stroke-width:2.2"')}</button>
    </div>
    <div class="stat-row">
      <span class="stat tipped" style="background:var(--blue-soft);color:var(--blue)"><b>${counts.corroborated}</b> Corroborated ${tip('corroborated', 'What corroborated means', 'inherit')}</span>
      ${counts.live ? html`<span class="stat" style="background:var(--red-soft);color:var(--red-ink)"><b>${counts.live}</b> Live</span>` : ''}
      <span class="stat tipped" style="background:var(--neutral-soft);color:var(--text-2)"><b>${counts.unverified}</b> Unverified ${tip('unverified', 'What unverified means', 'inherit')}</span>
    </div>
    <div class="seg" role="group" aria-label="Sort reports" style="margin:16px 20px 6px">
      <button type="button" data-sort="newest" aria-pressed="${area.sort === 'newest'}">Newest</button>
      <button type="button" data-sort="confirmed" aria-pressed="${area.sort === 'confirmed'}">Most confirmed</button>
    </div>
    ${area.error ? html`<p class="empty">${area.error}</p>` : ''}
    ${!area.details && !area.error ? html`<p class="empty">Loading reports…</p>` : ''}
    ${items.map((r) => cardFor(r))}
    ${area.ids.length > 40 ? html`<p class="empty">Showing the 40 most recent. Zoom in to see the rest.</p>` : ''}
    <div style="padding:16px 20px 0">
      <a class="btn" href="#/report" id="report-here">${icon('plus', 20, 'style="stroke-width:2.4"')}Report in this area</a>
    </div>`);

  body.querySelector('#area-close').addEventListener('click', closeArea);
  body.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    area.sort = b.dataset.sort;
    renderSheet();
  }));
  body.querySelector('#report-here').addEventListener('click', () => {
    if (centerOf) sessionStorage.setItem('cw_report_start', JSON.stringify({ lat: centerOf.lat, lng: centerOf.lng }));
  });
}

function cardFor(r) {
  const c = CATS[r.category] || CATS.other;
  const first = r.media_items?.[0];
  let thumb = '';
  if (first && first.url) {
    const isVideo = first.type.startsWith('video/');
    thumb = html`<span class="thumb ${r.sensitive ? 'blurred' : ''}">
      ${isVideo ? html`<span class="over" style="background:#2A2422">${icon('play', 20)}</span>` : html`<img src="${first.url}" alt="" loading="lazy">`}
      ${r.sensitive ? html`<span class="over">${icon('eyeoff', 18)}</span>` : ''}
    </span>`;
  }
  return html`<a class="card" href="#/r/${r.id}">
    <span class="ct ${c.tone}">${icon(c.icon, 20)}</span>
    <span class="row-main" style="gap:4px">
      <span class="row-top"><b>${catTitle(r)}</b>${r.ended_at ? html`<span class="badge past">Over</span>` : r.live ? html`<span class="badge live">Live</span>` : ''}</span>
      <span class="clamp" style="font-size:14px;line-height:1.4;color:var(--ink-2)">${r.caption}</span>
      <span class="row-top sub"><span class="badge ${r.status}">${STATUS[r.status]}</span>${r.confirms} confirmation${r.confirms === 1 ? '' : 's'}${r.updates ? ` · ${r.updates} update${r.updates === 1 ? '' : 's'}` : ''} · ${shortAgo(r.occurred_at)}</span>
      ${r.old_media ? html`<span class="sub" style="color:var(--amber-ink);font-weight:600">Photo may be old</span>` : ''}
      ${r.seen_media ? html`<span class="sub" style="color:var(--amber-ink);font-weight:600">Photo seen before</span>` : ''}
      ${r.imported ? html`<span class="sub">From social media</span>` : ''}
    </span>
    ${thumb}
  </a>`;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

export function sheetIsArea() { return sheetMode === 'area'; }
