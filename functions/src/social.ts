/**
 * Spectating + member event requests (spec §5). Following turns a series of
 * one-offs into a season; event requests give members the feeling of making
 * their own game while keeping the organizer-run tournament structure (§7 Path B).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, requireAuth, requireActive } from './shared';

export const followUser = onCall<{ targetId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  if (req.data.targetId === uid) throw new HttpsError('invalid-argument', 'Cannot follow yourself.');
  await db.doc(`follows/${uid}_${req.data.targetId}`).set({
    followerId: uid,
    targetId: req.data.targetId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const unfollowUser = onCall<{ targetId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await db.doc(`follows/${uid}_${req.data.targetId}`).delete();
  return { ok: true };
});

/**
 * Partner search — the missing half of team entry. Prefix-matches display
 * names in the caller's market (both as-typed and capitalized), returning just
 * what a picker needs: id, name, index, verified badge. Auth-gated like every
 * users read; never returns contact data (none lives on the users doc).
 */
export const searchPlayers = onCall<{ query: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const q = String(req.data.query ?? '').trim();
  if (q.length < 2) return { results: [] };

  const variants = [...new Set([q, q[0].toUpperCase() + q.slice(1), q.toLowerCase()])];
  const seen = new Map<string, { uid: string; displayName: string; index: number; verified: boolean }>();
  for (const v of variants) {
    const snap = await db
      .collection('users')
      .where('marketId', '==', user.marketId)
      .orderBy('displayName')
      .startAt(v)
      .endAt(v + '')
      .limit(8)
      .get();
    for (const d of snap.docs) {
      if (d.id === uid || seen.has(d.id)) continue;
      const u = d.data() as { displayName: string; handicap: { index: number; verifiedAt: unknown } };
      seen.set(d.id, {
        uid: d.id,
        displayName: u.displayName,
        index: u.handicap.index,
        verified: !!u.handicap.verifiedAt,
      });
    }
  }
  return { results: [...seen.values()].slice(0, 8) };
});

export const requestEvent = onCall<{
  formatId: string;
  proposedEntryCents: number;
  proposedField: number;
  preferredCourses: string[];
  preferredDates: number[];
  note?: string;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const d = req.data;
  if (!Number.isInteger(d.proposedEntryCents) || d.proposedEntryCents < 0) {
    throw new HttpsError('invalid-argument', 'proposedEntryCents must be a non-negative integer.');
  }
  const ref = await db.collection('eventRequests').add({
    requestedBy: uid,
    marketId: user.marketId,
    formatId: d.formatId,
    proposedEntryCents: d.proposedEntryCents,
    proposedField: d.proposedField,
    preferredCourses: d.preferredCourses ?? [],
    preferredDates: (d.preferredDates ?? []).map((ms) => new Date(ms)),
    note: d.note ? d.note.slice(0, 1000) : null,
    status: 'open',
    reviewedBy: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { requestId: ref.id };
});
