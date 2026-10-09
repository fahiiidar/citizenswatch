import { randomUUID, randomBytes } from 'node:crypto';
import { route, send, readJson, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, insert, update, signUpload } from './_lib/supa.js';
import { deviceHash, ipHash, netFp, verifyHuman, rateLimit, assertNotBlocked } from './_lib/security.js';
import { validateUpdate, extFor } from './_lib/reports.js';
import { afterUpdatePublished, recountUpdates } from './_lib/updates.js';
import { seenBefore, printsOf, notIn } from './_lib/dupes.js';

const REASONS = ['face', 'graphic', 'hate', 'old', 'spam', 'other'];

// People adding to an existing report (another angle, what happened next),
// and flagging an update that breaks the rules.
export default route(['POST'], async (req, res) => {
  const cfg = requireServerConfig();
  const body = await readJson(req);
  if (body.action === 'flag') return flag(cfg, req, res, body);
  return create(cfg, req, res, body);
});

async function create(cfg, req, res, body) {
  const reportId = String(body.reportId || '');
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) throw new HttpError(400, 'Unknown report.');
  const upd = validateUpdate(body);
  const dHash = deviceHash(cfg, body.device);
  const nf = netFp(cfg, req, body.fp);

  const reports = await select(cfg, 'reports', `select=id,ended_at,media&id=eq.${reportId}&status=eq.visible`);
  if (!reports.length) throw new HttpError(404, 'That report is no longer available.');
  if (reports[0].ended_at) throw new HttpError(400, 'This incident has been marked as over, so it cannot take new updates.');

  await assertNotBlocked(cfg, dHash);
  await verifyHuman(cfg, body.turnstileToken, req);
  await rateLimit(cfg, `d:${dHash}`, 'update', 3600, 6,
    'You can add up to 6 updates an hour from one phone. Please wait a little.');
  await rateLimit(cfg, `ip:${ipHash(cfg, req)}`, 'update', 3600, 20,
    'Too many updates from this network in the last hour. Please wait a little.');

  const id = randomUUID();
  const media = upd.mediaSpec.map((m, i) => ({
    path: `u/${id}/${i}.${extFor(m.type)}`, type: m.type, check: m.check, ...(m.print ? { print: m.print } : {}),
  }));
  // Photos already posted on a different report are marked. Matching this report is fine.
  const seen = await seenBefore(cfg, notIn(printsOf(media), printsOf(reports[0].media)), reportId);
  const finalizeToken = media.length ? randomBytes(24).toString('hex') : null;
  const row = {
    id,
    report_id: reportId,
    caption: upd.caption,
    media,
    sensitive: upd.sensitive,
    old_media: upd.old_media,
    ...(seen.seen_media ? seen : {}),
    device_hash: dHash,
    net_fp: nf,
    finalize_token: finalizeToken,
    status: media.length ? 'pending' : 'visible',
  };
  await insert(cfg, 'report_updates', [row], { returning: false });
  if (!media.length) await afterUpdatePublished(cfg, row);

  const uploads = [];
  for (const m of media) uploads.push({ url: await signUpload(cfg, m.path), type: m.type });
  return send(res, 201, { id, finalizeToken, uploads });
}

async function flag(cfg, req, res, body) {
  const id = String(body.updateId || '');
  const reason = String(body.reason || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown update.');
  if (!REASONS.includes(reason)) throw new HttpError(400, 'Choose why you are flagging it.');
  const dHash = deviceHash(cfg, body.device);
  await assertNotBlocked(cfg, dHash);
  await rateLimit(cfg, `d:${dHash}`, 'vote', 3600, 40, 'You have done that a lot this hour. Please wait a little.');

  const rows = await select(cfg, 'report_updates', `select=id,report_id,reviewed,status&id=eq.${id}&status=eq.visible`);
  const u = rows[0];
  if (!u) throw new HttpError(404, 'That update is no longer available.');

  await insert(cfg, 'update_flags', [{ update_id: id, device_hash: dHash, reason }], { returning: false, ignoreDuplicates: true });
  const flags = await select(cfg, 'update_flags', `select=device_hash&update_id=eq.${id}&limit=100`);
  const patch = { flags: flags.length };
  const hide = flags.length >= 5 && !u.reviewed;
  if (hide) Object.assign(patch, { status: 'hidden', hidden_reason: 'auto: 5 flags' });
  await update(cfg, 'report_updates', `id=eq.${id}`, patch);
  if (hide) await recountUpdates(cfg, u.report_id);
  return send(res, 200, { id, hidden: hide });
}
