// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNewReport, fuzz, statusOf, isLive, watToday } from '../api/_lib/reports.js';

const NOW = Date.parse('2026-10-09T14:00:00Z'); // 15:00 in Nigeria
const base = {
  category: 'gunmen', caption: 'Armed men on Kaduna Road', placeLabel: 'Kaduna Road',
  areaLabel: 'Birnin Gwari, Kaduna State', lat: 10.6653, lng: 6.5452, when: 'now', media: [],
};

test('exact locations are snapped to a ~1 km grid', () => {
  const r = validateNewReport(base, NOW);
  assert.equal(r.lat, 10.665);
  assert.equal(r.lng, 6.545);
  assert.equal(fuzz(10.6699), 10.665);
  assert.equal(fuzz(10.6601), 10.665);
});

test('places outside Nigeria are refused', () => {
  assert.throws(() => validateNewReport({ ...base, lat: 51.5, lng: -0.1 }, NOW), /outside Nigeria/);
});

test('"happening now" uses the posting time and today', () => {
  const r = validateNewReport(base, NOW);
  assert.equal(r.is_now, true);
  assert.equal(r.occurred_on, '2026-10-09');
  assert.equal(r.occurred_at, new Date(NOW).toISOString());
  assert.equal(r.time_of_day, null);
});

test('yesterday evening is estimated at 19:00 Nigeria time', () => {
  const r = validateNewReport({ ...base, when: 'yesterday', timeOfDay: 'evening' }, NOW);
  assert.equal(r.occurred_on, '2026-10-08');
  assert.equal(r.occurred_at, '2026-10-08T18:00:00.000Z');
  assert.equal(r.is_now, false);
});

test('a time later today than now is capped at now', () => {
  const r = validateNewReport({ ...base, when: 'today', timeOfDay: 'night' }, NOW);
  assert.equal(r.occurred_at, new Date(NOW).toISOString());
});

test('dates must be within 30 days and not in the future', () => {
  assert.throws(() => validateNewReport({ ...base, when: 'date', date: '2026-10-10' }, NOW), /future/);
  assert.throws(() => validateNewReport({ ...base, when: 'date', date: '2026-09-01' }, NOW), /30 days/);
  const ok = validateNewReport({ ...base, when: 'date', date: '2026-09-15' }, NOW);
  assert.equal(ok.occurred_on, '2026-09-15');
});

test('Nigeria day boundary: 23:30 UTC is already tomorrow in Lagos', () => {
  assert.equal(watToday(Date.parse('2026-10-09T23:30:00Z')), '2026-10-10');
});

test('captions are cleaned and length-checked', () => {
  const r = validateNewReport({ ...base, caption: '  Gunmen\n\n seen   near market \u0007 ' }, NOW);
  assert.equal(r.caption, 'Gunmen seen near market');
  assert.throws(() => validateNewReport({ ...base, caption: 'a' }, NOW), /Describe/);
  assert.equal(validateNewReport({ ...base, caption: 'x'.repeat(400) }, NOW).caption.length, 280);
});

test('media rules: up to 3 photos, or one clip, within size limits', () => {
  const photo = { type: 'image/jpeg', size: 500000 };
  const clip = { type: 'video/webm', size: 8000000 };
  assert.equal(validateNewReport({ ...base, media: [photo, photo, photo] }, NOW).mediaSpec.length, 3);
  assert.throws(() => validateNewReport({ ...base, media: [photo, photo, photo, photo] }, NOW), /at most 3/);
  assert.throws(() => validateNewReport({ ...base, media: [photo, clip] }, NOW), /either one clip/);
  assert.throws(() => validateNewReport({ ...base, media: [{ type: 'image/png', size: 10 }] }, NOW), /not supported/);
  assert.throws(() => validateNewReport({ ...base, media: [{ type: 'video/mp4', size: 40e6 }] }, NOW), /too large/);
});

test('unknown categories are refused', () => {
  assert.throws(() => validateNewReport({ ...base, category: 'protest' }, NOW), /Choose what happened/);
});

test('status: corroborated at 3 confirmations, disputed when false votes win', () => {
  assert.equal(statusOf({ confirms: 2, falses: 0 }), 'unverified');
  assert.equal(statusOf({ confirms: 3, falses: 0 }), 'corroborated');
  assert.equal(statusOf({ confirms: 3, falses: 4 }), 'disputed');
  assert.equal(statusOf({ confirms: 0, falses: 2 }), 'unverified');
  assert.equal(statusOf({ confirms: 0, falses: 9, mod_override: 'corroborated' }), 'corroborated');
});

test('live only for "now" reports under an hour old', () => {
  assert.equal(isLive({ is_now: true, created_at: new Date(NOW - 30 * 60e3).toISOString() }, NOW), true);
  assert.equal(isLive({ is_now: true, created_at: new Date(NOW - 61 * 60e3).toISOString() }, NOW), false);
  assert.equal(isLive({ is_now: false, created_at: new Date(NOW).toISOString() }, NOW), false);
});

test('an exact time is stored in Nigeria time, with its part of the day', () => {
  const r = validateNewReport({ ...base, when: 'yesterday', time: '19:30' }, NOW);
  assert.equal(r.occurred_at, '2026-10-08T18:30:00.000Z');
  assert.equal(r.time_of_day, 'evening');
  const early = validateNewReport({ ...base, when: 'date', date: '2026-10-05', time: '02:10' }, NOW);
  assert.equal(early.time_of_day, 'night');
  assert.equal(early.occurred_at, '2026-10-05T01:10:00.000Z');
});

test('a time later today than now is refused, and bad times are refused', () => {
  assert.throws(() => validateNewReport({ ...base, when: 'today', time: '18:00' }, NOW), /not happened yet/);
  assert.equal(validateNewReport({ ...base, when: 'today', time: '14:50' }, NOW).time_of_day, 'afternoon');
  assert.throws(() => validateNewReport({ ...base, when: 'today', time: '25:00' }, NOW), /valid time/);
});

test('election incidents need to say what kind of problem it was', () => {
  assert.throws(() => validateNewReport({ ...base, category: 'election' }, NOW), /election problem/);
  assert.throws(() => validateNewReport({ ...base, category: 'election', electionKind: 'nope' }, NOW), /election problem/);
  const r = validateNewReport({ ...base, category: 'election', electionKind: 'vote_buying' }, NOW);
  assert.equal(r.election_kind, 'vote_buying');
  assert.equal(validateNewReport({ ...base, electionKind: 'rigging' }, NOW).election_kind, null);
});
