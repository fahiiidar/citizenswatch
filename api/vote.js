import { route, send, readJson, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select } from './_lib/supa.js';
import { deviceHash, ipHash, netFp, rateLimit, assertNotBlocked } from './_lib/security.js';
import { statusOf } from './_lib/reports.js';
import { castVote, isOwner } from './_lib/votes.js';

const KINDS = ['confirm', 'false', 'flag'];
const REASONS = ['face', 'graphic', 'hate', 'old', 'spam', 'other'];

// "I can confirm this", "False or old" and "Flag".
export default route(['POST'], async (req, res) => {
  const cfg = requireServerConfig();
  const body = await readJson(req);
  const id = String(body.id || '');
  const kind = String(body.kind || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown report.');
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Unknown action.');
  const reason = kind === 'flag' ? String(body.reason || '') : null;
  if (kind === 'flag' && !REASONS.includes(reason)) throw new HttpError(400, 'Choose why you are flagging it.');

  const dHash = deviceHash(cfg, body.device);
  const nf = netFp(cfg, req, body.fp);
  await assertNotBlocked(cfg, dHash);
  await rateLimit(cfg, `d:${dHash}`, 'vote', 3600, 40, 'You have done that a lot this hour. Please wait a little.');
  await rateLimit(cfg, `ip:${ipHash(cfg, req)}`, 'vote', 3600, 150, 'Too many actions from this network. Please wait a little.');

  const rows = await select(cfg, 'reports', `select=id,device_hash,net_fp,status,ended_at&id=eq.${id}&status=eq.visible`);
  const report = rows[0];
  if (!report) throw new HttpError(404, 'That report is no longer available.');
  if (kind !== 'flag' && report.ended_at) throw new HttpError(400, 'This incident has been marked as over.');
  if (kind !== 'flag' && isOwner(report, dHash, nf)) {
    throw new HttpError(400, 'You posted this report, so you cannot confirm or dispute it.');
  }

  const counted = await castVote(cfg, { reportId: id, dHash, nf, kind, reason });

  const after = await select(cfg, 'reports', `select=status,confirms,falses,mod_override&id=eq.${id}`);
  const r = after[0] || { confirms: 0, falses: 0 };
  return send(res, 200, {
    id,
    counted,
    confirms: r.confirms,
    falses: r.falses,
    status: statusOf(r),
    hidden: r.status === 'hidden',
  });
});
