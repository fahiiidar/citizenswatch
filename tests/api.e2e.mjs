// End-to-end check of every API route against the fake database.
// Run:  node dev-server.mjs --mock   (in one terminal)   then   node tests/api.e2e.mjs
import assert from 'node:assert/strict';

const B = process.env.BASE || 'http://localhost:3000';
const dev = (n) => `device-${String(n).padStart(4, '0')}-abcdefghijkl`;
const MOD = { 'X-Moderator-Key': 'local-moderator-key-123' };
let passed = 0;

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

console.log(`\n${passed} checks passed`);
