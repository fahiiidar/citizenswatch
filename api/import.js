// Admin tool: loads a prepared batch of reports found on social media
// (data/imports/<batch>.json), copies their photos and clips into our own
// storage and puts them on the map, labelled as imported.
//
//   GET /api/import?key=<IMPORT_SECRET>&batch=<name>&from=0&count=8[&dry=1]
//
// Safe to run again: a post that was already imported is skipped.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { route, send, queryOf, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, insert, uploadFile } from './_lib/supa.js';
import { CATEGORIES, AGENCIES, TIMES_OF_DAY, fuzz, extFor, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from './_lib/reports.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_FOR = { morning: 9, afternoon: 14, evening: 19, night: 23 };

function allowed(cfg, key) {
  if (!cfg.importSecret || cfg.importSecret.length < 24 || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(cfg.importSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The same post always gets the same report id, so imports never double up.
export function idFor(sourceUrl) {
  const h = createHash('sha256').update(`import:${sourceUrl}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function checkItem(it) {
  const problems = [];
  if (!/^https:\/\/(x\.com|twitter\.com|www\.facebook\.com|facebook\.com|m\.facebook\.com)\//.test(it.source_url || '')) problems.push('source_url');
  if (!CATEGORIES.includes(it.category)) problems.push('category');
  if (it.category === 'officials' && !AGENCIES.includes(it.agency)) problems.push('agency');
  if (typeof it.caption !== 'string' || it.caption.trim().length < 10 || it.caption.length > 280) problems.push('caption');
  if (typeof it.place_label !== 'string' || it.place_label.trim().length < 2) problems.push('place_label');
  if (!(it.lat >= 4 && it.lat <= 14 && it.lng >= 2.6 && it.lng <= 14.8)) problems.push('lat/lng');
  if (!DAY.test(it.occurred_on || '')) problems.push('occurred_on');
  if (it.time_of_day && !TIMES_OF_DAY.includes(it.time_of_day)) problems.push('time_of_day');
  if (Number.isNaN(Date.parse(it.posted_at))) problems.push('posted_at');
  const media = Array.isArray(it.media) ? it.media : [];
  const vids = media.filter((m) => m.type === 'video/mp4');
  if (media.length > 3 || vids.length > 1 || (vids.length && media.length > 1)) problems.push('media count');
  const scheme = process.env.IMPORT_ALLOW_HTTP === '1' ? /^https?:\/\// : /^https:\/\//; // http only in local tests
  if (media.some((m) => !scheme.test(m.url || '') || !['image/jpeg', 'video/mp4'].includes(m.type))) problems.push('media item');
  return problems;
}

function occurredAt(it) {
  if (it.occurred_at && !Number.isNaN(Date.parse(it.occurred_at))) return new Date(it.occurred_at).toISOString();
  const hour = it.time_of_day ? HOUR_FOR[it.time_of_day] : 12;
  const ms = Math.min(Date.parse(`${it.occurred_on}T00:00:00Z`) + (hour - 1) * 3600e3, Date.parse(it.posted_at));
  return new Date(ms).toISOString();
}

async function download(url, type) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const got = (res.headers.get('content-type') || '').split(';')[0];
    if (type === 'image/jpeg' && got !== 'image/jpeg') throw new Error(`not a jpeg (${got})`);
    if (type === 'video/mp4' && got !== 'video/mp4') throw new Error(`not an mp4 (${got})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const limit = type === 'video/mp4' ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    if (buf.length > limit) throw new Error(`too large (${Math.round(buf.length / 1e6)} MB)`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

export default route(['GET'], async (req, res) => {
  const cfg = requireServerConfig();
  const q = queryOf(req);
  if (!allowed(cfg, q.get('key'))) throw new HttpError(404, 'Not found.');

  const batch = q.get('batch') || '';
  if (!/^[a-z0-9-]{1,40}$/.test(batch)) throw new HttpError(400, 'Bad batch name.');
  let items;
  try {
    items = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'imports', `${batch}.json`), 'utf8'));
  } catch {
    throw new HttpError(404, 'Batch not found.');
  }
  const from = Math.max(0, Number(q.get('from')) || 0);
  const count = Math.min(20, Math.max(1, Number(q.get('count')) || 8));
  const dry = q.get('dry') === '1';
  const slice = items.slice(from, from + count);

  const out = { batch, total: items.length, from, next: from + slice.length < items.length ? from + slice.length : null, imported: [], skipped: [], failed: [] };

  for (const it of slice) {
    const problems = checkItem(it);
    if (problems.length) { out.failed.push({ source: it.source_url, reason: `bad ${problems.join(', ')}` }); continue; }
    const id = idFor(it.source_url);
    const exists = await select(cfg, 'reports', `select=id&id=eq.${id}`);
    if (exists.length) { out.skipped.push(id); continue; }
    if (dry) { out.imported.push({ id, dry: true }); continue; }

    const media = [];
    const mediaErrors = [];
    for (const m of it.media || []) {
      try {
        const buf = await download(m.url, m.type);
        const p = `${id}/${media.length}.${extFor(m.type)}`;
        await uploadFile(cfg, p, buf, m.type);
        media.push({ path: p, type: m.type, check: 'unknown' });
      } catch (err) {
        mediaErrors.push(err.message);
      }
    }

    try {
      await insert(cfg, 'reports', [{
        id,
        created_at: new Date(it.posted_at).toISOString(),
        category: it.category,
        agency: it.category === 'officials' ? it.agency : null,
        caption: it.caption.trim(),
        place_label: it.place_label.trim().slice(0, 140),
        area_label: (it.area_label || '').trim().slice(0, 140) || null,
        lat: fuzz(it.lat),
        lng: fuzz(it.lng),
        is_now: false,
        occurred_on: it.occurred_on,
        time_of_day: it.time_of_day || null,
        occurred_at: occurredAt(it),
        sensitive: Boolean(it.sensitive),
        media,
        device_hash: 'import',
        status: 'visible',
        origin: 'imported',
        source_url: it.source_url,
        source_kind: /facebook/.test(it.source_url) ? 'facebook' : 'x',
      }], { returning: false });
      out.imported.push({ id, media: media.length, ...(mediaErrors.length ? { mediaErrors } : {}) });
    } catch (err) {
      out.failed.push({ source: it.source_url, reason: err.upstream ? JSON.stringify(err.upstream.data).slice(0, 200) : err.message });
    }
  }
  return send(res, 200, out);
});
