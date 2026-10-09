// Run with:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readTakenDate, classifyTaken } from '../public/js/media.js';

const file = async (name) => new File([await readFile(new URL(name, import.meta.url))], name, { type: 'image/jpeg' });

test('reads the camera date from the main photo tags', async () => {
  const t = await readTakenDate(await file('fixtures-old.jpg'));
  assert.equal(new Date(t).toISOString(), '2024-03-14T09:20:00.000Z'); // 10:20 in Nigeria
});

test('reads DateTimeOriginal, which is where phones store it', async () => {
  const t = await readTakenDate(await file('fixtures-today.jpg'));
  assert.equal(new Date(t).toISOString(), '2026-10-09T13:05:00.000Z');
});

test('a photo with no camera date is unknown, not old', async () => {
  const t = await readTakenDate(await file('fixtures-noexif.jpg'));
  assert.equal(t, null);
  assert.equal(classifyTaken(t, '2026-10-09'), 'unknown');
});

test('photos from before the event day are old; same day or day before is fine', () => {
  const now = Date.parse('2026-10-09T15:00:00Z');
  assert.equal(classifyTaken(Date.parse('2024-03-14T09:20:00Z'), '2026-10-09', now), 'old');
  assert.equal(classifyTaken(Date.parse('2026-10-09T08:00:00Z'), '2026-10-09', now), 'ok');
  assert.equal(classifyTaken(Date.parse('2026-10-08T20:00:00Z'), '2026-10-09', now), 'ok');
  assert.equal(classifyTaken(Date.parse('2026-10-06T20:00:00Z'), '2026-10-09', now), 'old');
  assert.equal(classifyTaken(Date.parse('2026-10-06T20:00:00Z'), '2026-10-07', now), 'ok');
  assert.equal(classifyTaken(Date.parse('2027-01-01T00:00:00Z'), '2026-10-09', now), 'unknown');
});

test('photo fingerprint: same picture gives the same code, brightness change barely matters', async () => {
  const { printFromPixels } = await import('../public/js/media.js');
  const px = (f) => {
    const a = new Uint8ClampedArray(9 * 8 * 4);
    for (let i = 0; i < 72; i += 1) { const v = f(i % 9, Math.floor(i / 9)); a.set([v, v, v, 255], i * 4); }
    return a;
  };
  const scene = (x, y) => (x * 37 + y * 91 + ((x * y) % 5) * 23) % 256;
  const p1 = printFromPixels(px(scene));
  const p2 = printFromPixels(px((x, y) => Math.min(255, scene(x, y) * 0.9 + 10)));
  const p3 = printFromPixels(px((x, y) => 255 - scene(x, y)));
  const diff = (a, b) => [...(BigInt(`0x${a}`) ^ BigInt(`0x${b}`)).toString(2)].filter((c) => c === '1').length;
  assert.match(p1, /^[0-9a-f]{16}$/);
  assert.ok(diff(p1, p2) <= 6, 'a darker copy still matches');
  assert.ok(diff(p1, p3) > 20, 'a different picture does not');
});
