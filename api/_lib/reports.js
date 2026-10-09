import { HttpError } from './http.js';

export const CATEGORIES = ['gunmen', 'kidnapping', 'attack', 'road', 'robbery', 'avoid', 'clear', 'other'];
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

  let timeOfDay = null;
  if (!isNow && body.timeOfDay) {
    if (!TIMES_OF_DAY.includes(body.timeOfDay)) throw new HttpError(400, 'Choose a time of day.');
    timeOfDay = body.timeOfDay;
  }

  let occurredAt;
  if (isNow) {
    occurredAt = new Date(now).toISOString();
  } else {
    const hour = timeOfDay ? HOUR_FOR[timeOfDay] : 12;
    let ms = Date.parse(`${occurredOn}T00:00:00Z`) + (hour * 60 * 60 * 1000) - WAT_OFFSET_MS;
    if (ms > now) ms = now; // "this evening" picked in the afternoon still counts as now
    occurredAt = new Date(ms).toISOString();
  }

  const media = Array.isArray(body.media) ? body.media : [];
  if (media.length > MAX_PHOTOS) throw new HttpError(400, `Add at most ${MAX_PHOTOS} photos.`);
  const videos = media.filter((m) => String(m?.type).startsWith('video/'));
  if (videos.length > 1 || (videos.length === 1 && media.length > 1)) {
    throw new HttpError(400, 'Add either one clip or up to 3 photos, not both.');
  }
  const mediaSpec = media.map((m) => {
    const type = String(m?.type || '');
    const size = Number(m?.size);
    if (!MEDIA_TYPES.includes(type)) throw new HttpError(400, 'That file type is not supported.');
    const limit = type.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    if (!Number.isFinite(size) || size <= 0 || size > limit) {
      throw new HttpError(400, type.startsWith('video/') ? 'That clip is too large.' : 'That photo is too large.');
    }
    return { type, size };
  });

  return {
    category,
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
  };
}

export function statusOf(r) {
  if (r.mod_override) return r.mod_override;
  if (r.falses >= 3 && r.falses > r.confirms) return 'disputed';
  if (r.confirms >= 3) return 'corroborated';
  return 'unverified';
}

export function isLive(r, now = Date.now()) {
  return Boolean(r.is_now) && now - Date.parse(r.created_at) < 60 * 60 * 1000;
}

// The light version used to draw the map.
export function mapShape(r, now = Date.now()) {
  const media = Array.isArray(r.media) ? r.media : [];
  return {
    id: r.id,
    category: r.category,
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
    media_items: media.map((m) => ({ type: m.type, url: urls[m.path] || null })),
  };
}

export const PUBLIC_COLUMNS =
  'id,created_at,category,is_now,occurred_on,time_of_day,occurred_at,caption,place_label,area_label,lat,lng,media,sensitive,status,mod_override,confirms,falses';
