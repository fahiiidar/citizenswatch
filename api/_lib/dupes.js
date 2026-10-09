// Guards against the same thing being posted twice.
import { select, insert, rpc } from './supa.js';

// About 2.5 km either way. Locations are already snapped to ~1 km cells.
export const NEAR = 0.025;
export const REPEAT_HOURS = 6;
const PRINT_RE = /^[0-9a-f]{16}$/;

const box = (lat, lng) =>
  `lat=gte.${(lat - NEAR).toFixed(4)}&lat=lte.${(lat + NEAR).toFixed(4)}&lng=gte.${(lng - NEAR).toFixed(4)}&lng=lte.${(lng + NEAR).toFixed(4)}`;

// The same phone posting the same kind of report in the same area within a few hours.
export async function samePhoneRecent(cfg, { dHash, nf, category, lat, lng }, now = Date.now()) {
  const since = new Date(now - REPEAT_HOURS * 3600e3).toISOString();
  const who = nf ? `&or=(device_hash.eq.${dHash},net_fp.eq.${nf})` : `&device_hash=eq.${dHash}`;
  const rows = await select(cfg, 'reports',
    `select=id&status=eq.visible&ended_at=is.null&category=eq.${category}&created_at=gte.${since}&${box(lat, lng)}${who}&order=created_at.desc&limit=1`);
  return rows[0]?.id || null;
}

// Open reports of the same kind nearby, so people can add to one instead of posting again.
export async function nearbyOpen(cfg, { category, lat, lng, hours = 12 }, now = Date.now()) {
  const since = new Date(now - hours * 3600e3).toISOString();
  return select(cfg, 'reports',
    `select=id,created_at,category,agency,is_now,occurred_on,time_of_day,occurred_at,caption,place_label,area_label,lat,lng,media,mod_override,confirms,falses,updates,ended_at`
    + `&status=eq.visible&ended_at=is.null&category=eq.${category}&occurred_at=gte.${since}&${box(lat, lng)}&order=occurred_at.desc&limit=5`);
}

export function printsOf(media) {
  return (media || []).map((m) => m.print).filter((p) => PRINT_RE.test(p || ''));
}

function bitsApart(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

// Drop prints that match photos already on this report (the same scene added again is fine).
export function notIn(prints, existing) {
  const own = existing.filter((p) => PRINT_RE.test(p || ''));
  return prints.filter((p) => !own.some((o) => bitsApart(p, o) <= 6));
}

// Has any of these photos been posted before, on a different report?
// Never blocks posting: if the check fails, the post goes through unmarked.
export async function seenBefore(cfg, prints, excludeReportId = null) {
  if (!prints.length) return { seen_media: false, seen_of: null };
  try {
    const rows = await rpc(cfg, 'find_similar_prints', { p_prints: prints, p_exclude: excludeReportId, p_max: 6 });
    if (Array.isArray(rows) && rows.length) return { seen_media: true, seen_of: rows[0].report_id };
  } catch (err) {
    console.warn('Photo check failed', err.message);
  }
  return { seen_media: false, seen_of: null };
}

// Remember the fingerprints once a report or update is actually posted.
export async function savePrints(cfg, { reportId, updateId = null, media }) {
  const rows = printsOf(media).map((print) => ({ print, report_id: reportId, update_id: updateId }));
  if (!rows.length) return;
  try {
    await insert(cfg, 'media_prints', rows, { returning: false });
  } catch (err) {
    console.warn('Could not save photo prints', err.message);
  }
}
