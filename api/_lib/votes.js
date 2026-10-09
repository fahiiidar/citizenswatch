import { select, insert, remove } from './supa.js';

// Who counts as "the same phone": the same browser code, or the same phone
// fingerprint on the same network (catches clearing the browser).
function samePhone(dHash, nf) {
  return nf ? `or=(device_hash.eq.${dHash},net_fp.eq.${nf})` : `device_hash=eq.${dHash}`;
}

export function isOwner(report, dHash, nf) {
  return report.device_hash === dHash || Boolean(nf && report.net_fp && report.net_fp === nf);
}

// Records a confirmation, a "false or old" vote or a flag. Returns false when
// this phone already did the same thing, so nothing changed.
export async function castVote(cfg, { reportId, dHash, nf, kind, reason = null }) {
  const existing = await select(cfg, 'votes',
    `select=kind&report_id=eq.${reportId}&kind=eq.${kind}&${samePhone(dHash, nf)}&limit=1`);
  if (existing.length) return false;

  // Confirming and calling it false cancel each other out.
  const opposite = kind === 'confirm' ? 'false' : kind === 'false' ? 'confirm' : null;
  if (opposite) await remove(cfg, 'votes', `report_id=eq.${reportId}&kind=eq.${opposite}&${samePhone(dHash, nf)}`);

  await insert(cfg, 'votes', [{ report_id: reportId, device_hash: dHash, net_fp: nf, kind, reason }], {
    returning: false,
    ignoreDuplicates: true,
  });
  return true;
}
