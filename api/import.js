// Admin tool: loads a prepared batch of reports found on social media
// (data/imports/<batch>.json), copies their photos and clips into our own
// storage and puts them on the map, labelled as imported.
//
//   GET /api/import?key=<IMPORT_SECRET>&batch=<name>&from=0&count=8[&dry=1]
//
// It can also run an Apify scraper (APIFY_TOKEN in Vercel) and hand back the
// posts it found, so they can be sorted before anything is imported:
//
//   GET /api/import?key=<IMPORT_SECRET>&step=scrape&actor=<user~actor>&input=<json>
//
// Safe to run again: a post that was already imported is skipped.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { route, send, queryOf, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, insert, update, uploadFile } from './_lib/supa.js';
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
  if (typeof it.caption !== 'string' || it.caption.trim().length < 10 || it.caption.length > 4000) problems.push('caption');
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

// Every photo and clip address found anywhere inside a scraped post.
export function mediaIn(item) {
  const found = new Set();
  const walk = (v, depth) => {
    if (depth > 8 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (/^https:\/\/(pbs\.twimg\.com\/media\/|video\.twimg\.com\/.+\.mp4|scontent[^/]*\.fbcdn\.net\/|video[^/]*\.fbcdn\.net\/)/.test(v)) found.add(v);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === 'object') Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(item, 0);
  return [...found];
}

// A small, readable version of a scraped post: who, when, what, and its media
// (photos at medium size; for a video, the best version up to about 1 Mbps).
export function compact(it) {
  const a = it.author || {};
  const photos = [];
  let video = null;
  for (const m of (it.extendedEntities && it.extendedEntities.media) || []) {
    if (m.type === 'photo' && m.media_url_https) photos.push(`${m.media_url_https}?format=jpg&name=medium`);
    if ((m.type === 'video' || m.type === 'animated_gif') && !video) {
      const vs = ((m.video_info && m.video_info.variants) || []).filter((v) => v.content_type === 'video/mp4')
        .sort((x, y) => (x.bitrate || 0) - (y.bitrate || 0));
      const pick = vs.filter((v) => (v.bitrate || 0) <= 1000000).pop() || vs[0];
      if (pick) video = { url: pick.url, seconds: Math.round(((m.video_info || {}).duration_millis || 0) / 1000) };
    }
  }
  return {
    url: it.url || it.twitterUrl || it.postUrl || null,
    date: it.createdAt || it.created_at || it.date || it.timestamp || null,
    user: a.userName || null,
    name: a.name || null,
    followers: a.followers ?? null,
    text: it.text || it.full_text || it.message || '',
    lang: it.lang || null,
    sensitive: Boolean(it.possiblySensitive),
    retweet: Boolean(it.retweeted_tweet),
    photos: photos.length ? photos : mediaIn(it).filter((u) => /pbs\.twimg\.com\/media\//.test(u)),
    video,
  };
}

async function scrape(cfg, q, res) {
  const token = process.env.APIFY_TOKEN || '';
  if (!token) throw new HttpError(400, 'APIFY_TOKEN is not set in Vercel.');
  const actor = q.get('actor') || '';
  if (!/^[A-Za-z0-9_.-]+~[A-Za-z0-9_.-]+$/.test(actor)) throw new HttpError(400, 'actor must look like user~actor-name.');
  let input;
  try { input = JSON.parse(q.get('input') || '{}'); } catch { throw new HttpError(400, 'input must be JSON.'); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 280000);
  let r;
  try {
    r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=270&format=json&clean=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new HttpError(504, `Apify did not answer in time: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await r.text();
  if (!r.ok) return send(res, 502, { error: `Apify ${r.status}`, detail: text.slice(0, 1500) });
  let items = [];
  try { items = JSON.parse(text); } catch { /* not JSON */ }
  const raw = q.get('raw') === '1';
  return send(res, 200, {
    count: items.length,
    items: items.map((it) => (raw ? it : compact(it))),
  });
}

export default route(['GET'], async (req, res) => {
  const cfg = requireServerConfig();
  const q = queryOf(req);
  if (!allowed(cfg, q.get('key'))) throw new HttpError(404, 'Not found.');
  if (q.get('step') === 'scrape') return scrape(cfg, q, res);

  // One report passed in the address itself (base64url JSON), so a scheduled
  // run can import without changing the code; or a batch file from data/imports.
  let items;
  let batch = 'inline';
  if (q.get('item')) {
    try {
      items = [JSON.parse(Buffer.from(q.get('item'), 'base64url').toString('utf8'))];
    } catch {
      throw new HttpError(400, 'item must be base64url-encoded JSON.');
    }
  } else {
    batch = q.get('batch') || '';
    if (!/^[a-z0-9-]{1,40}$/.test(batch)) throw new HttpError(400, 'Bad batch name.');
    try {
      items = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'imports', `${batch}.json`), 'utf8'));
    } catch {
      throw new HttpError(404, 'Batch not found.');
    }
  }
  const from = Math.max(0, Number(q.get('from')) || 0);
  const count = Math.min(20, Math.max(1, Number(q.get('count')) || 8));
  const dry = q.get('dry') === '1';
  const slice = items.slice(from, from + count);

  const out = { batch, total: items.length, from, next: from + slice.length < items.length ? from + slice.length : null, imported: [], skipped: [], failed: [] };

  for (const it of slice) {
    const problems = checkItem(it);
    if (problems.length) { out.failed.push({ source: it.source_url, reason: `bad ${problems.join(', ')}` }); continue; }
    const id = idFor(it.import_key || it.source_url);
    const exists = await select(cfg, 'reports', `select=id,media,caption,source_url&id=eq.${id}`);
    const refresh = exists.length && q.get('refresh') === '1';
    // Already imported: with refresh=1, bring its wording and source up to date,
    // and add photos if it has none yet.
    const addTo = refresh && !(exists[0].media || []).length && (it.media || []).length;
    if (refresh && (exists[0].caption !== it.caption.trim() || exists[0].source_url !== it.source_url) && !dry) {
      await update(cfg, 'reports', `id=eq.${id}`, { caption: it.caption.trim(), source_url: it.source_url });
      out.updated = [...(out.updated || []), id];
    }
    if (exists.length && !addTo) { out.skipped.push(id); continue; }
    if (dry) { out.imported.push({ id, dry: true, ...(addTo ? { addMedia: true } : {}) }); continue; }

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

    if (addTo) {
      if (media.length) await update(cfg, 'reports', `id=eq.${id}`, { media, sensitive: Boolean(it.sensitive), reviewed: false });
      out.imported.push({ id, addedMedia: media.length, ...(mediaErrors.length ? { mediaErrors } : {}) });
      continue;
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
