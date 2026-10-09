import { HttpError } from './http.js';

export const CATEGORIES = ['gunmen', 'kidnapping', 'attack', 'road', 'robbery', 'avoid', 'officials', 'clear', 'other'];
export const AGENCIES = ['police', 'army', 'lastma', 'ndlea', 'frsc', 'vio', 'customs', 'immigration', 'nscdc', 'hisbah', 'vigilante', 'taskforce', 'other'];
export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'night'];
export const MEDIA_TYPES = ['image/jpeg', 'video/webm', 'video/mp4'];
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
export const MAX_DAYS_BACK = 30;
export const CELL = 0.01; // about 1.1 km

// Nigeria is on West Africa Time (UTC+1) all year.
const WAT_OFFSET_MS = 60 * 60 * 1000;
const HOUR_FOR = { morning: 9, afternoon: 14, evening: 19, night: 23 };

export function watToday(now = Date.now()) {
  return new Date(now + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Snap to the centre of a ~1 km cell. Exact spots are never stored.
export function fuzz(value) {
  const snapped = Math.floor(value / CELL) * CELL + CELL / 2;
  return Math.round(snapped * 10000) / 10000;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function validateNewReport(body, now = Date.now()) {
  const category = String(body.category || '');
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Choose what happened.');

  const caption = cleanText(body.caption, 280);
  if (caption.length < 3) throw new HttpError(400, 'Describe what happened in a few words.');

  let agency = null;
  if (category === 'officials') {
    agency = String(body.agency || '');
    if (!AGENCIES.includes(agency)) throw new HttpError(400, 'Choose which agency was involved.');
  }

  const placeLabel = cleanText(body.placeLabel, 140);
  if (placeLabel.length < 2) throw new HttpError(400, 'Choose where it happened.');
  const areaLabel = cleanText(body.areaLabel, 140) || null;

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 4 || lat > 14 || lng < 2.6 || lng > 14.8) {
    throw new HttpError(400, 'That place is outside Nigeria. Move the pin and try again.');
  }

  const today = watToday(now);
  const when = String(body.when || '');
  let occurredOn;
  let isNow = false;
  if (when === 'now') {
    isNow = true;
    occurredOn = today;
  } else if (when === 'today') {
    occurredOn = today;
  } else if (when === 'yesterday') {
    occurredOn = addDays(today, -1);
  } else if (when === 'date') {
    occurredOn = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || Number.isNaN(Date.parse(occurredOn))) {
      throw new HttpError(400, 'Choose a valid date.');
    }
    if (occurredOn > today) throw new HttpError(400, 'The date cannot be in the future.');
    if (occurredOn < addDays(today, -MAX_DAYS_BACK)) {
      throw new HttpError(400, `Reports can be up to ${MAX_DAYS_BACK} days old.`);
    }
  } else {
    throw new HttpError(400, 'Choose when it happened.');
  }

  // An optional clock time ("19:30", Nigeria time). time_of_day keeps the rough
  // part of the day too, so reports can still be grouped by morning, evening...
  let timeOfDay = null;
  let clockMs = null;
  if (!isNow && body.time) {
    const m = String(body.time).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) throw new HttpError(400, 'Choose a valid time.');
    const h = Number(m[1]);
    clockMs = Date.parse(`${occurredOn}T${m[1]}:${m[2]}:00Z`) - WAT_OFFSET_MS;
    if (clockMs > now + 5 * 60 * 1000) throw new HttpError(400, 'That time has not happened yet today.');
    timeOfDay = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
  } else if (!isNow && body.timeOfDay) {
    if (!TIMES_OF_DAY.includes(body.timeOfDay)) throw new HttpError(400, 'Choose a time of day.');
    timeOfDay = body.timeOfDay;
  }

  let occurredAt;
  if (isNow) {
    occurredAt = new Date(now).toISOString();
  } else if (clockMs !== null) {
    occurredAt = new Date(Math.min(clockMs, now)).toISOString();
  } else {
    const hour = timeOfDay ? HOUR_FOR[timeOfDay] : 12;
    let ms = Date.parse(`${occurredOn}T00:00:00Z`) + (hour * 60 * 60 * 1000) - WAT_OFFSET_MS;
    if (ms > now) ms = now; // "this evening" picked in the afternoon still counts as now
    occurredAt = new Date(ms).toISOString();
  }

  const mediaSpec = validateMedia(body.media);

  return {
    category,
    agency,
    caption,
    place_label: placeLabel,
    area_label: areaLabel,
    lat: fuzz(lat),
    lng: fuzz(lng),
    is_now: isNow,
    occurred_on: occurredOn,
    time_of_day: timeOfDay,
    occurred_at: occurredAt,
    sensitive: Boolean(body.sensitive),
    mediaSpec,
    old_media: mediaSpec.some((m) => m.check === 'old'),
  };
}

// Photos and clips: up to 3 photos or one clip. Each carries the phone's own
// check of when it was taken: 'ok', 'old' (days before the event) or 'unknown'.
export const MEDIA_CHECKS = ['ok', 'old', 'unknown'];
export function validateMedia(input) {
  const media = Array.isArray(input) ? input : [];
  if (media.length > MAX_PHOTOS) throw new HttpError(400, `Add at most ${MAX_PHOTOS} photos.`);
  const videos = media.filter((m) => String(m?.type).startsWith('video/'));
  if (videos.length > 1 || (videos.length === 1 && media.length > 1)) {
    throw new HttpError(400, 'Add either one clip or up to 3 photos, not both.');
  }
  return media.map((m) => {
    const type = String(m?.type || '');
    const size = Number(m?.size);
    if (!MEDIA_TYPES.includes(type)) throw new HttpError(400, 'That file type is not supported.');
    const limit = type.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    if (!Number.isFinite(size) || size <= 0 || size > limit) {
      throw new HttpError(400, type.startsWith('video/') ? 'That clip is too large.' : 'That photo is too large.');
    }
    const check = MEDIA_CHECKS.includes(m?.check) ? m.check : 'unknown';
    // A small visual fingerprint made on the phone, used to spot reused photos.
    const print = /^[0-9a-f]{16}$/.test(m?.print || '') ? m.print : null;
    return { type, size, check, print };
  });
}

// An update someone adds to an existing report: words, photos, or both.
export function validateUpdate(body) {
  const caption = cleanText(body.caption, 280);
  if (caption.length > 0 && caption.length < 3) throw new HttpError(400, 'Write a few more words, or leave it empty.');
  const mediaSpec = validateMedia(body.media);
  if (!caption && !mediaSpec.length) throw new HttpError(400, 'Add a photo, a clip or a few words.');
  return {
    caption: caption || null,
    sensitive: Boolean(body.sensitive),
    mediaSpec,
    old_media: mediaSpec.some((m) => m.check === 'old'),
  };
}

export function extFor(type) {
  return type === 'image/jpeg' ? 'jpg' : type === 'video/mp4' ? 'mp4' : 'webm';
}

export function statusOf(r) {
  if (r.mod_override) return r.mod_override;
  if (r.falses >= 3 && r.falses > r.confirms) return 'disputed';
  if (r.confirms >= 3) return 'corroborated';
  return 'unverified';
}

export function isLive(r, now = Date.now()) {
  return Boolean(r.is_now) && !r.ended_at && now - Date.parse(r.created_at) < 60 * 60 * 1000;
}

// The light version used to draw the map.
export function mapShape(r, now = Date.now()) {
  const media = Array.isArray(r.media) ? r.media : [];
  return {
    id: r.id,
    category: r.category,
    agency: r.agency || null,
    ended: Boolean(r.ended_at),
    status: statusOf(r),
    live: isLive(r, now),
    lat: r.lat,
    lng: r.lng,
    occurred_at: r.occurred_at,
    place_label: r.place_label,
    area_label: r.area_label,
    confirms: r.confirms,
    media: media.length ? (media[0].type.startsWith('video/') ? 'video' : 'photo') : null,
  };
}

// The full version for lists and the detail screen.
export function fullShape(r, urls = {}, now = Date.now()) {
  const media = Array.isArray(r.media) ? r.media : [];
  return {
    ...mapShape(r, now),
    created_at: r.created_at,
    is_now: r.is_now,
    occurred_on: r.occurred_on,
    time_of_day: r.time_of_day,
    caption: r.caption,
    sensitive: r.sensitive,
    falses: r.falses,
    old_media: Boolean(r.old_media),
    seen_media: Boolean(r.seen_media),
    seen_of: r.seen_of || null,
    updates: r.updates || 0,
    ended_at: r.ended_at || null,
    media_items: media.map((m) => ({ type: m.type, url: urls[m.path] || null, check: m.check || 'unknown' })),
  };
}

export function updateShape(u, urls = {}) {
  const media = Array.isArray(u.media) ? u.media : [];
  return {
    id: u.id,
    created_at: u.created_at,
    caption: u.caption,
    sensitive: u.sensitive,
    old_media: Boolean(u.old_media),
    seen_media: Boolean(u.seen_media),
    seen_of: u.seen_of || null,
    media_items: media.map((m) => ({ type: m.type, url: urls[m.path] || null, check: m.check || 'unknown' })),
  };
}

export const PUBLIC_COLUMNS =
  'id,created_at,category,is_now,occurred_on,time_of_day,occurred_at,caption,place_label,area_label,lat,lng,media,sensitive,status,mod_override,confirms,falses,old_media,updates,agency,ended_at,seen_media,seen_of';
export const UPDATE_COLUMNS = 'id,report_id,created_at,caption,media,sensitive,old_media,status,seen_media,seen_of';
