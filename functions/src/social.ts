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
