// End-to-end check of every API route against the fake database.
// Run:  node dev-server.mjs --mock   (in one terminal)   then   node tests/api.e2e.mjs
import assert from 'node:assert/strict';

const B = process.env.BASE || 'http://localhost:3000';
const dev = (n) => `device-${String(n).padStart(4, '0')}-abcdefghijkl`;
const MOD = { 'X-Moderator-Key': 'local-moderator-key-123' };
let passed = 0;
let r2;

async function call(path, { method = 'GET', body, headers = {}, ip } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, data };
}
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`ok - ${name}`); }

const report = {
  category: 'gunmen', caption: 'Armed men on motorbikes on Kaduna Road', placeLabel: 'Kaduna Road',
  areaLabel: 'Birnin Gwari, Kaduna State', lat: 10.6653, lng: 6.5452, when: 'now', media: [],
};

// Config and place search
let r = await call('/api/config');
ok('config is public and has no secrets', r.status === 200 && r.data.configured === true && !JSON.stringify(r.data).includes('mock-service'));
r = await call('/api/geocode?q=Kaduna%20Rd&lat=10.6&lng=6.5');
ok('street search returns a street first', r.data.results[0].kind === 'street' && r.data.results[0].label === 'Kaduna Road');
ok('landmarks are labelled as landmarks', r.data.results.some((x) => x.kind === 'landmark'));
r = await call('/api/geocode?reverse=1&lat=10.6653&lng=6.5452');
ok('reverse lookup names the spot and area', r.data.results[0].label === 'Kaduna Road' && r.data.results[0].area.includes('Kaduna State'));

// Posting
r = await call('/api/reports', { method: 'POST', body: { ...report, device: dev(1) }, ip: '1.1.1.1' });
ok('text-only report posts immediately', r.status === 201 && r.data.uploads.length === 0 && !r.data.finalizeToken);
const id1 = r.data.id;

r = await call('/api/reports', { method: 'POST', body: { ...report, device: 'bad' }, ip: '1.1.1.1' });
ok('missing device code is refused', r.status === 400);
r = await call('/api/reports', { method: 'POST', body: { ...report, category: 'x', device: dev(1) }, ip: '1.1.1.1' });
ok('bad category is refused with a clear message', r.status === 400 && /Choose what happened/.test(r.data.error));

// List
r = await call('/api/reports?range=24h');
const listed = r.data.reports.find((x) => x.id === id1);
ok('report appears on the map list', Boolean(listed));
ok('map list never exposes device or exact location', !('device_hash' in listed) && listed.lat === 10.665 && listed.lng === 6.545);
ok('new "now" report is live and unverified', listed.live === true && listed.status === 'unverified');
ok('summary counts it', r.data.summary.total >= 1 && r.data.summary.live >= 1);
r = await call('/api/reports?range=24h&cats=road');
ok('category filter excludes other categories', !r.data.reports.some((x) => x.id === id1));
r = await call('/api/reports?range=custom&from=2026-10-01&to=2026-09-01');
ok('bad custom range is refused', r.status === 400);

// Votes
r = await call('/api/vote', { method: 'POST', body: { id: id1, kind: 'confirm', device: dev(1) }, ip: '1.1.1.1' });
ok('poster cannot confirm their own report', r.status === 400);
for (const n of [2, 3]) await call('/api/vote', { method: 'POST', body: { id: id1, kind: 'confirm', device: dev(n) }, ip: '2.2.2.2' });
r = await call('/api/vote', { method: 'POST', body: { id: id1, kind: 'confirm', device: dev(2) }, ip: '2.2.2.2' });
ok('the same phone confirming twice counts once', r.data.confirms === 2);
r = await call('/api/vote', { method: 'POST', body: { id: id1, kind: 'confirm', device: dev(4) }, ip: '2.2.2.2' });
ok('3 different phones make it corroborated', r.data.status === 'corroborated' && r.data.confirms === 3);
r = await call('/api/vote', { method: 'POST', body: { id: id1, kind: 'false', device: dev(4) }, ip: '2.2.2.2' });
ok('switching to "false" removes that phone’s confirmation', r.data.confirms === 2 && r.data.falses === 1);
r = await call('/api/vote', { method: 'POST', body: { id: id1, kind: 'flag', device: dev(5) }, ip: '2.2.2.2' });
ok('flag needs a reason', r.status === 400);

// Rate limit: 3 posts an hour per phone
await call('/api/reports', { method: 'POST', body: { ...report, device: dev(1) }, ip: '1.1.1.1' });
await call('/api/reports', { method: 'POST', body: { ...report, device: dev(1) }, ip: '1.1.1.1' });
r = await call('/api/reports', { method: 'POST', body: { ...report, device: dev(1) }, ip: '1.1.1.1' });
ok('4th post in an hour from one phone is refused', r.status === 429 && /3 reports an hour/.test(r.data.error));

// Auto-hide after 5 flags
r = await call('/api/reports', { method: 'POST', body: { ...report, category: 'avoid', device: dev(20) }, ip: '3.3.3.3' });
const id2 = r.data.id;
for (const n of [21, 22, 23, 24, 25]) {
  r = await call('/api/vote', { method: 'POST', body: { id: id2, kind: 'flag', reason: 'hate', device: dev(n) }, ip: `4.4.4.${n}` });
}
ok('5 flags from different phones hide a report', r.data.hidden === true);
r = await call(`/api/reports?ids=${id2}`);
ok('hidden report is no longer served', r.data.reports.length === 0);

// Media: signed upload, finalize, signed view link
const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
r = await call('/api/reports', { method: 'POST', body: { ...report, category: 'road', when: 'yesterday', timeOfDay: 'evening', device: dev(30), media: [{ type: 'image/jpeg', size: fakeJpeg.length }], sensitive: true }, ip: '5.5.5.5' });
ok('report with a photo gets an upload link and stays hidden until done', r.status === 201 && r.data.uploads.length === 1 && Boolean(r.data.finalizeToken));
const id3 = r.data.id;
let list = await call('/api/reports?range=7d');
ok('pending report is not on the map yet', !list.data.reports.some((x) => x.id === id3));
let fin = await call('/api/finalize', { method: 'POST', body: { id: id3, token: r.data.finalizeToken } });
ok('finalize refuses when the file has not arrived', fin.status === 409);
const put = await fetch(r.data.uploads[0].url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: fakeJpeg });
ok('phone can upload straight to storage', put.ok);
fin = await call('/api/finalize', { method: 'POST', body: { id: id3, token: r.data.finalizeToken } });
ok('finalize publishes the report', fin.status === 200);
fin = await call('/api/finalize', { method: 'POST', body: { id: id3, token: r.data.finalizeToken } });
ok('finalize cannot be replayed', fin.status === 404);
list = await call('/api/reports?range=7d');
const past = list.data.reports.find((x) => x.id === id3);
ok('yesterday’s report shows in 7 days, not live', past && past.live === false && past.media === 'photo');
list = await call('/api/reports?range=1h');
ok('yesterday’s report is not in the last hour', !list.data.reports.some((x) => x.id === id3));
r = await call(`/api/reports?ids=${id3}`);
const full = r.data.reports[0];
ok('detail has a working view link and the sensitive flag', full.sensitive === true && full.media_items[0].url && (await fetch(full.media_items[0].url)).ok);
ok('detail keeps the time of day', full.time_of_day === 'evening' && full.is_now === false);

// Share preview
r = await call(`/r/${id3}`);
ok('shared link has a preview title without the caption', typeof r.data === 'string' && r.data.includes('Road unsafe · Birnin Gwari') && !r.data.includes('motorbikes'));

// Moderation
r = await call('/api/mod?queue=flagged');
ok('moderation needs a key', r.status === 401);
r = await call('/api/mod?queue=flagged', { headers: { 'X-Moderator-Key': 'wrong-key-wrong-key-wrong' } });
ok('wrong moderator key is refused', r.status === 401);
r = await call('/api/mod?queue=hidden', { headers: MOD });
const hiddenItem = r.data.reports.find((x) => x.id === id2);
ok('hidden queue shows the auto-hidden report with flag reasons', hiddenItem && hiddenItem.flag_reasons.hate === 5 && r.data.moderator === 'tester');
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: id2, action: 'restore' } });
ok('moderator can restore it', r.status === 200);
r = await call(`/api/reports?ids=${id2}`);
ok('restored report is back', r.data.reports.length === 1);
r = await call('/api/vote', { method: 'POST', body: { id: id2, kind: 'flag', reason: 'spam', device: dev(26) }, ip: '6.6.6.6' });
ok('a reviewed report is not auto-hidden again by more flags', r.data.hidden === false);
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: id1, action: 'override', value: 'disputed' } });
r = await call(`/api/reports?ids=${id1}`);
ok('moderator can set a status', r.data.reports[0].status === 'disputed');
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: id2, action: 'block' } });
r = await call('/api/reports', { method: 'POST', body: { ...report, device: dev(20) }, ip: '7.7.7.7' });
ok('a blocked phone cannot post', r.status === 403);
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: id3, action: 'delete' } });
r = await call(`/api/reports?ids=${id3}`);
ok('delete removes the report', r.data.reports.length === 0);

// ---- Phone fingerprint: one phone counts once, even after clearing its browser ----
const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
r = await call('/api/reports', { method: 'POST', body: { ...report, category: 'robbery', device: dev(40), fp: FP_A }, ip: '8.8.8.1' });
const id4 = r.data.id;
r = await call('/api/vote', { method: 'POST', body: { id: id4, kind: 'confirm', device: dev(41), fp: FP_A }, ip: '8.8.8.1' });
ok('poster cannot confirm own report after clearing the browser (same phone, same network)', r.status === 400);
r = await call('/api/vote', { method: 'POST', body: { id: id4, kind: 'confirm', device: dev(42), fp: FP_B }, ip: '9.9.9.9' });
ok('a different phone can confirm', r.data.counted === true && r.data.confirms === 1);
r = await call('/api/vote', { method: 'POST', body: { id: id4, kind: 'confirm', device: dev(43), fp: FP_B }, ip: '9.9.9.9' });
ok('the same phone with a cleared browser is not counted twice', r.data.counted === false && r.data.confirms === 1);
r = await call('/api/vote', { method: 'POST', body: { id: id4, kind: 'confirm', device: dev(44), fp: FP_B }, ip: '9.9.9.10' });
ok('the same phone model on a different network still counts (real different people)', r.data.counted === true && r.data.confirms === 2);
r = await call('/api/vote', { method: 'POST', body: { id: id4, kind: 'false', device: dev(45), fp: FP_B }, ip: '9.9.9.9' });
ok('switching to "false" with a cleared browser removes the earlier confirmation', r.data.confirms === 1 && r.data.falses === 1);

// ---- Old-photo check is stored and shown ----
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
r = await call('/api/reports', { method: 'POST', body: { ...report, category: 'attack', device: dev(50), fp: 'c'.repeat(64), media: [{ type: 'image/jpeg', size: jpg.length, check: 'old' }] }, ip: '10.0.0.1' });
const id5 = r.data.id;
await fetch(r.data.uploads[0].url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpg });
await call('/api/finalize', { method: 'POST', body: { id: id5, token: r.data.finalizeToken } });
r = await call(`/api/reports?ids=${id5}`);
ok('a report with an old photo is marked for everyone to see', r.data.reports[0].old_media === true);
r = await call('/api/mod?queue=media', { headers: MOD });
ok('old-photo reports come first in the moderators’ photo queue', r.data.reports[0].id === id5 && r.data.reports[0].old_media === true);

// ---- Updates added by other people ----
r = await call('/api/update', { method: 'POST', body: { action: 'create', reportId: id4, caption: 'x', device: dev(60) }, ip: '11.0.0.1' });
ok('an update needs a photo or a few words', r.status === 400);
r = await call('/api/update', { method: 'POST', body: { action: 'create', reportId: id4, caption: 'Still happening, shops closed now', device: dev(60), fp: 'd'.repeat(64) }, ip: '11.0.0.1' });
ok('a text update posts straight away', r.status === 201 && r.data.uploads.length === 0);
const upd1 = r.data.id;
r = await call(`/api/reports?ids=${id4}&updates=1`);
ok('the report shows the update and its count', r.data.reports[0].updates === 1 && r.data.reports[0].update_items[0].caption.includes('shops closed'));
ok('adding an update counts as a confirmation', r.data.reports[0].confirms === 2);
r = await call('/api/update', { method: 'POST', body: { action: 'create', reportId: id4, caption: 'Me again from my own report', device: dev(40), fp: FP_A }, ip: '8.8.8.1' });
r = await call(`/api/reports?ids=${id4}`);
ok('the poster adding an update does not confirm their own report', r.data.reports[0].confirms === 2 && r.data.reports[0].updates === 2);

r = await call('/api/update', { method: 'POST', body: { action: 'create', reportId: id4, device: dev(61), fp: 'e'.repeat(64), media: [{ type: 'image/jpeg', size: jpg.length, check: 'ok' }] }, ip: '11.0.0.2' });
const upd2 = r.data.id;
ok('a photo update waits for its upload', r.status === 201 && r.data.uploads.length === 1);
r2 = await call(`/api/reports?ids=${id4}&updates=1`);
ok('a photo update is hidden until the photo arrives', r2.data.reports[0].update_items.length === 2);
await fetch(r.data.uploads[0].url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpg });
let fin2 = await call('/api/finalize', { method: 'POST', body: { id: upd2, token: r.data.finalizeToken, kind: 'update' } });
ok('finalizing the photo update publishes it', fin2.status === 200);
r = await call(`/api/reports?ids=${id4}&updates=1`);
const photoUpd = r.data.reports[0].update_items.find((u) => u.id === upd2);
ok('the photo update has a working view link', photoUpd && photoUpd.media_items[0].url && (await fetch(photoUpd.media_items[0].url)).ok);
ok('the report now has 3 updates', r.data.reports[0].updates === 3);

for (const n of [70, 71, 72, 73, 74]) {
  r = await call('/api/update', { method: 'POST', body: { action: 'flag', updateId: upd1, reason: 'spam', device: dev(n) }, ip: `12.0.0.${n}` });
}
ok('5 flags hide an update', r.data.hidden === true);
r = await call(`/api/reports?ids=${id4}&updates=1`);
ok('a hidden update disappears and the count drops', r.data.reports[0].updates === 2 && !r.data.reports[0].update_items.some((u) => u.id === upd1));
r = await call('/api/mod?queue=updates', { headers: MOD });
const modUpd = r.data.updates.find((u) => u.id === upd1);
ok('moderators see the hidden update with its flag reasons and parent report', modUpd && modUpd.hidden && modUpd.flag_reasons.spam === 5 && modUpd.report.category === 'robbery');
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: upd1, action: 'restore', target: 'update' } });
r = await call(`/api/reports?ids=${id4}&updates=1`);
ok('a moderator can restore an update', r.data.reports[0].updates === 3);
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: id4, action: 'delete' } });
r = await call(`/api/reports?ids=${id4}`);
ok('deleting a report also removes its updates', r.data.reports.length === 0);

// ---- Harassment by officials ----
r = await call('/api/reports', { method: 'POST', body: { ...report, category: 'officials', caption: 'Checkpoint asking every bus for N2000', device: dev(80) }, ip: '13.0.0.1' });
ok('officials reports must say which agency', r.status === 400 && /agency/.test(r.data.error));
r = await call('/api/reports', { method: 'POST', body: { ...report, category: 'officials', agency: 'police', caption: 'Checkpoint asking every bus for N2000', device: dev(80) }, ip: '13.0.0.1' });
const id6 = r.data.id;
r = await call(`/api/reports?ids=${id6}`);
ok('the agency is stored and shown', r.data.reports[0].category === 'officials' && r.data.reports[0].agency === 'police');
r = await call('/api/reports?range=24h&cats=officials');
ok('officials reports can be filtered on the map', r.data.reports.length === 1 && r.data.reports[0].agency === 'police');
r = await call(`/r/${id6}`);
ok('shared link names the category', String(r.data).includes('Harassment by officials'));

// ---- Marking a report as over ----
r = await call('/api/end', { method: 'POST', body: { id: id6, device: dev(81) }, ip: '13.0.0.9' });
ok('only the poster can mark their report as over', r.status === 403);
r = await call('/api/end', { method: 'POST', body: { id: id6, device: dev(80) }, ip: '13.0.0.1' });
ok('the poster can mark it as over', r.status === 200);
r = await call('/api/reports?range=24h');
ok('an ended report leaves the map by default', !r.data.reports.some((x) => x.id === id6));
r = await call('/api/reports?range=24h&ended=1');
const endedRow = r.data.reports.find((x) => x.id === id6);
ok('it can still be shown on request, marked as ended and not live', endedRow && endedRow.ended === true && endedRow.live === false);
r = await call('/api/vote', { method: 'POST', body: { id: id6, kind: 'confirm', device: dev(82) }, ip: '13.0.0.10' });
ok('an ended report takes no more confirmations', r.status === 400);
r = await call('/api/update', { method: 'POST', body: { action: 'create', reportId: id6, caption: 'Checkpoint is back', device: dev(82) }, ip: '13.0.0.10' });
ok('an ended report takes no more updates', r.status === 400);
r = await call('/api/mod?queue=ended', { headers: MOD });
ok('moderators see it in the Over tab, with who ended it', r.data.reports.some((x) => x.id === id6 && x.ended_by === 'poster'));
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: id6, action: 'reopen' } });
r = await call('/api/reports?range=24h');
ok('a moderator can reopen it', r.data.reports.some((x) => x.id === id6));
r = await call('/api/mod', { method: 'POST', headers: MOD, body: { id: id6, action: 'end' } });
r = await call(`/api/reports?ids=${id6}`);
ok('a moderator can mark any report as over', Boolean(r.data.reports[0].ended_at));

console.log(`\n${passed} checks passed`);
