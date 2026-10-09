import { randomUUID, randomBytes } from 'node:crypto';
import { route, send, readJson, queryOf, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, insert, signUpload, signDownloads, inList } from './_lib/supa.js';
import { deviceHash, ipHash, verifyHuman, rateLimit, assertNotBlocked } from './_lib/security.js';
import { CATEGORIES, PUBLIC_COLUMNS, validateNewReport, mapShape, fullShape } from './_lib/reports.js';

const RANGES = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
const MAP_COLUMNS = 'id,created_at,category,is_now,occurred_at,place_label,area_label,lat,lng,media,mod_override,confirms,falses';

export default route(['GET', 'POST'], async (req, res) => {
  const cfg = requireServerConfig();
  if (req.method === 'GET') return list(cfg, req, res);
  return create(cfg, req, res);
});

async function list(cfg, req, res) {
  const q = queryOf(req);
  const now = Date.now();

  // Detail mode: full reports (with photo and clip links) for a handful of ids.
  if (q.get('ids')) {
    const ids = q.get('ids').split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 40);
    if (!ids.length) return send(res, 200, { reports: [] });
    const rows = await select(cfg, 'reports', `select=${PUBLIC_COLUMNS}&status=eq.visible&id=in.${inList(ids)}`);
    const paths = rows.flatMap((r) => (r.media || []).map((m) => m.path));
    const urls = await signDownloads(cfg, paths, 3600);
    const byId = new Map(rows.map((r) => [r.id, fullShape(r, urls, now)]));
    return send(res, 200, { reports: ids.map((id) => byId.get(id)).filter(Boolean) });
  }

  // Map mode: every visible report in the chosen time range.
  const range = q.get('range') || '24h';
  let from;
  let to = new Date(now).toISOString();
  if (range === 'custom') {
    const f = q.get('from');
    const t = q.get('to');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '') || !/^\d{4}-\d{2}-\d{2}$/.test(t || '') || f > t) {
      throw new HttpError(400, 'Choose a start date that is on or before the end date.');
    }
    // Dates are Nigerian days (UTC+1).
    from = new Date(Date.parse(`${f}T00:00:00Z`) - 3600e3).toISOString();
    to = new Date(Date.parse(`${t}T23:59:59Z`) - 3600e3).toISOString();
    if (Date.parse(to) - Date.parse(from) > 92 * 24 * 3600e3) {
      throw new HttpError(400, 'Choose a range of 3 months or less.');
    }
  } else {
    const hours = RANGES[range];
    if (!hours) throw new HttpError(400, 'Unknown time range.');
    from = new Date(now - hours * 3600e3).toISOString();
  }

  let filter = `select=${MAP_COLUMNS}&status=eq.visible&occurred_at=gte.${from}&occurred_at=lte.${to}`;
  const cats = (q.get('cats') || '').split(',').filter((c) => CATEGORIES.includes(c));
  if (cats.length && cats.length < CATEGORIES.length) filter += `&category=in.${inList(cats)}`;
  filter += '&order=occurred_at.desc&limit=1500';

  const rows = await select(cfg, 'reports', filter);
  let reports = rows.map((r) => mapShape(r, now));
  if (q.get('corroborated') === '1') reports = reports.filter((r) => r.status === 'corroborated');

  const summary = {
    total: reports.length,
    corroborated: reports.filter((r) => r.status === 'corroborated').length,
    live: reports.filter((r) => r.live).length,
  };

  return send(res, 200, { reports, summary, generated_at: new Date(now).toISOString() }, {
    // Lets Vercel's edge cache absorb traffic spikes for a few seconds.
    'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30',
  });
}

async function create(cfg, req, res) {
  const body = await readJson(req);
  const report = validateNewReport(body);
  const dHash = deviceHash(cfg, body.device);

  await assertNotBlocked(cfg, dHash);
  await verifyHuman(cfg, body.turnstileToken, req);
  await rateLimit(cfg, `d:${dHash}`, 'post', 3600, 3,
    'You can post up to 3 reports an hour from one phone. Please wait a little.');
  await rateLimit(cfg, `ip:${ipHash(cfg, req)}`, 'post', 3600, 12,
    'Too many reports from this network in the last hour. Please wait a little.');

  const id = randomUUID();
  const media = report.mediaSpec.map((m, i) => ({
    path: `${id}/${i}.${m.type === 'image/jpeg' ? 'jpg' : m.type === 'video/mp4' ? 'mp4' : 'webm'}`,
    type: m.type,
  }));
  const finalizeToken = media.length ? randomBytes(24).toString('hex') : null;

  await insert(cfg, 'reports', [{
    id,
    category: report.category,
    caption: report.caption,
    place_label: report.place_label,
    area_label: report.area_label,
    lat: report.lat,
    lng: report.lng,
    is_now: report.is_now,
    occurred_on: report.occurred_on,
    time_of_day: report.time_of_day,
    occurred_at: report.occurred_at,
    sensitive: report.sensitive,
    media,
    device_hash: dHash,
    finalize_token: finalizeToken,
    // Reports with files stay hidden until every file has arrived.
    status: media.length ? 'pending' : 'visible',
  }], { returning: false });

  const uploads = [];
  for (const m of media) uploads.push({ url: await signUpload(cfg, m.path), type: m.type });

  return send(res, 201, { id, finalizeToken, uploads });
}
