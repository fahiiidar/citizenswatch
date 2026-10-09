import { route, send, readJson, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, insert, remove } from './_lib/supa.js';
import { deviceHash, ipHash, rateLimit, assertNotBlocked } from './_lib/security.js';
import { statusOf } from './_lib/reports.js';

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
  await assertNotBlocked(cfg, dHash);
  await rateLimit(cfg, `d:${dHash}`, 'vote', 3600, 40, 'You have done that a lot this hour. Please wait a little.');
  await rateLimit(cfg, `ip:${ipHash(cfg, req)}`, 'vote', 3600, 150, 'Too many actions from this network. Please wait a little.');

  const rows = await select(cfg, 'reports', `select=id,device_hash,status&id=eq.${id}&status=eq.visible`);
  const report = rows[0];
  if (!report) throw new HttpError(404, 'That report is no longer available.');
  if (kind !== 'flag' && report.device_hash === dHash) {
    throw new HttpError(400, 'You posted this report, so you cannot confirm or dispute it.');
  }

  // Confirming and calling it false cancel each other out.
  if (kind === 'confirm') await remove(cfg, 'votes', `report_id=eq.${id}&device_hash=eq.${dHash}&kind=eq.false`);
  if (kind === 'false') await remove(cfg, 'votes', `report_id=eq.${id}&device_hash=eq.${dHash}&kind=eq.confirm`);
  await insert(cfg, 'votes', [{ report_id: id, device_hash: dHash, kind, reason }], {
    returning: false,
    ignoreDuplicates: true,
  });

  const after = await select(cfg, 'reports', `select=status,confirms,falses,mod_override&id=eq.${id}`);
  const r = after[0] || { confirms: 0, falses: 0 };
  return send(res, 200, {
    id,
    confirms: r.confirms,
    falses: r.falses,
    status: statusOf(r),
    hidden: r.status === 'hidden',
  });
});
