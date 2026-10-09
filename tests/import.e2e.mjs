// Import tool check. Run:  node dev-server.mjs --mock   then   node tests/import.e2e.mjs
import assert from 'node:assert/strict';

const B = process.env.BASE || 'http://localhost:3000';
const KEY = 'local-import-secret-0123456789';
const get = async (p) => { const r = await fetch(B + p); return { status: r.status, data: await r.json() }; };
let n = 0;
const ok = (name, c) => { assert.ok(c, name); n += 1; console.log(`ok - ${name}`); };

ok('wrong key looks like nothing is there', (await get('/api/import?key=nope&batch=test-batch')).status === 404);
ok('unknown batch is refused', (await get(`/api/import?key=${KEY}&batch=missing`)).status === 404);
let r = await get(`/api/import?key=${KEY}&batch=test-batch&dry=1`);
ok('dry run writes nothing and checks every item', r.data.imported.length === 2 && r.data.failed.length === 1 && /category/.test(r.data.failed[0].reason));
r = await get(`/api/import?key=${KEY}&batch=test-batch&from=0&count=2`);
ok('two good posts are imported', r.data.imported.length === 2 && r.data.next === 2);
ok('a photo that is not really a photo is skipped, the report still goes in', r.data.imported[0].media === 1 && r.data.imported[0].mediaErrors.length === 1);
const id = r.data.imported[0].id;
r = await get(`/api/import?key=${KEY}&batch=test-batch&from=0&count=2`);
ok('running again never doubles up', r.data.skipped.length === 2 && r.data.imported.length === 0);

r = await get(`/api/reports?ids=${id}`);
const rep = r.data.reports[0];
ok('imported report is public, labelled, with its photo copied to our storage', rep.imported === true && rep.media_items.length === 1 && rep.media_items[0].url.includes('/storage/'));
ok('the original post link is never public', !JSON.stringify(r.data).includes('x.com'));
ok('posted time is the original post time, not now', rep.created_at.startsWith('2026-10-08T17:20'));
ok('"evening" is never later than the post itself', rep.occurred_at === '2026-10-08T17:20:00.000Z' && rep.status === 'unverified');

r = await get('/api/reports?range=30d');
ok('it shows on the map', r.data.reports.some((x) => x.id === id));

const MOD = { 'X-Moderator-Key': 'local-moderator-key-123' };
let m = await fetch(`${B}/api/mod?queue=recent`, { headers: MOD }).then((x) => x.json());
const mr = m.reports.find((x) => x.id === id);
ok('moderators can see the original post link', mr && mr.source_url === 'https://x.com/example/status/1000000000000000001');
const blk = await fetch(`${B}/api/mod`, { method: 'POST', headers: { ...MOD, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'block' }) });
ok('blocking an imported report is refused (it would hide every import)', blk.status === 400);
console.log(`\n${n} import checks passed`);
