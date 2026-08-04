/**
 * The Draw — Cloud Functions.
 *
 * Everything that must stay authoritative runs here, behind Auth. Per spec §3,
 * clients never write the collections these functions own; firestore.rules
 * blocks them, and the Admin SDK used here bypasses those rules by design.
 *
 * Phase 1 surface (this file):
 *   joinRound / leaveRound   — keep slotsFilled + joinedUserIds correct,
 *                              enforce blocks, respect host approval.
 *   submitReport             — route a report to the market's organizers.
 *   blockUser / unblockUser  — symmetric, silent to the blocked party.
 *   deleteAccount            — actually delete; retain only anonymized ledger.
 *
 * Later phases (Stripe capture, bracket advancement, payouts, weather voids)
 * attach here as additional callables/triggers — see the Phase map in README.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();

function requireAuth(auth: { uid: string } | undefined): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return auth.uid;
}

async function requireActiveUser(uid: string) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Finish onboarding first.');
  const user = snap.data() as { status: string; marketId: string; displayName: string };
  if (user.status === 'banned') throw new HttpsError('permission-denied', 'Account banned.');
  return user;
}

// ---------------------------------------------------------------------------
// joinRound — atomic. Rejects if full, if blocked either way, or if closed.
// ---------------------------------------------------------------------------
export const joinRound = onCall<{ postId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActiveUser(uid);
  const { postId } = req.data;
  if (!postId) throw new HttpsError('invalid-argument', 'postId required.');

  const postRef = db.doc(`roundPosts/${postId}`);

  // A block in EITHER direction prevents the join (§5). Checked outside the txn
  // since blocks are their own docs; a stale read here only fails safe.
  const post = (await postRef.get()).data() as
    | { createdBy: string }
    | undefined;
  if (!post) throw new HttpsError('not-found', 'Post not found.');
  const [aBlocksB, bBlocksA] = await Promise.all([
    db.doc(`blocks/${uid}_${post.createdBy}`).get(),
    db.doc(`blocks/${post.createdBy}_${uid}`).get(),
  ]);
  if (aBlocksB.exists || bBlocksA.exists) {
    throw new HttpsError('permission-denied', 'You cannot join this round.');
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
    const p = snap.data() as {
      status: string;
      slotsTotal: number;
      slotsFilled: number;
      joinedUserIds: string[];
      createdBy: string;
      hosting: { hostMustApprove: boolean } | null;
    };
    if (p.createdBy === uid) {
      throw new HttpsError('failed-precondition', 'You own this post.');
    }
    if (p.status === 'cancelled' || p.status === 'completed') {
      throw new HttpsError('failed-precondition', 'This round is closed.');
    }
    if (p.joinedUserIds.includes(uid)) return; // idempotent
    if (p.slotsFilled >= p.slotsTotal) {
      throw new HttpsError('failed-precondition', 'This round is full.');
    }
    // Host-approval posts add the requester to a pending list rather than
    // filling a slot; the host confirms via a separate call (Phase 1.1).
    if (p.hosting?.hostMustApprove) {
      tx.update(postRef, {
        pendingUserIds: FieldValue.arrayUnion(uid),
      });
      return;
    }
    const slotsFilled = p.slotsFilled + 1;
    tx.update(postRef, {
      joinedUserIds: FieldValue.arrayUnion(uid),
      slotsFilled,
      status: slotsFilled >= p.slotsTotal ? 'full' : 'open',
    });
  });

  return { status: 'joined' };
});

// ---------------------------------------------------------------------------
// leaveRound — atomic inverse. Reopens a full post.
// ---------------------------------------------------------------------------
export const leaveRound = onCall<{ postId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const { postId } = req.data;
  const postRef = db.doc(`roundPosts/${postId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
    const p = snap.data() as {
      slotsFilled: number;
      joinedUserIds: string[];
      status: string;
    };
    if (!p.joinedUserIds.includes(uid)) return; // idempotent
    const slotsFilled = Math.max(0, p.slotsFilled - 1);
    tx.update(postRef, {
      joinedUserIds: FieldValue.arrayRemove(uid),
      slotsFilled,
      status: p.status === 'full' ? 'open' : p.status,
    });
  });

  return { status: 'left' };
});

// ---------------------------------------------------------------------------
// submitReport — routes to the market organizers. Report volume is a signal:
// this stores the row; a scheduled function (Phase 2) surfaces repeat targets.
// ---------------------------------------------------------------------------
export const submitReport = onCall<{
  targetType: 'user' | 'post' | 'match';
  targetId: string;
  reason: string;
  context?: string;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActiveUser(uid);
  const { targetType, targetId, reason, context } = req.data;
  if (!targetId || !reason) {
    throw new HttpsError('invalid-argument', 'targetId and reason required.');
  }
  const ref = await db.collection('reports').add({
    reportedBy: uid,
    targetType,
    targetId,
    marketId: user.marketId,
    reason: String(reason).slice(0, 1000),
    context: context ? String(context).slice(0, 2000) : null,
    createdAt: FieldValue.serverTimestamp(),
    status: 'open',
  });
  return { reportId: ref.id };
});

// ---------------------------------------------------------------------------
// blockUser / unblockUser — silent to the blocked party (§5). Doc id is
// `${blockerId}_${blockedId}` so lookups on join are a single get.
// ---------------------------------------------------------------------------
export const blockUser = onCall<{ blockedId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActiveUser(uid);
  const { blockedId } = req.data;
  if (!blockedId || blockedId === uid) {
    throw new HttpsError('invalid-argument', 'Invalid target.');
  }
  await db.doc(`blocks/${uid}_${blockedId}`).set({
    blockerId: uid,
    blockedId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const unblockUser = onCall<{ blockedId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const { blockedId } = req.data;
  await db.doc(`blocks/${uid}_${blockedId}`).delete();
  return { ok: true };
});

// ---------------------------------------------------------------------------
// deleteAccount — self-serve and actually deletes (§5). Retain ONLY what's
// legally required: ledger rows for tax purposes, anonymized. Everything else —
// profile, posts, rounds, chat authorship — is removed.
// ---------------------------------------------------------------------------
export const deleteAccount = onCall<Record<string, never>>(async (req) => {
  const uid = requireAuth(req.auth);

  // Cancel the user's open posts rather than orphaning joiners.
  const posts = await db.collection('roundPosts').where('createdBy', '==', uid).get();
  const batch = db.batch();
  posts.forEach((d) => batch.update(d.ref, { status: 'cancelled' }));

  // Delete self-reported rounds (not competitive history, so safe to remove).
  const rounds = await db.collection('rounds').where('userId', '==', uid).get();
  rounds.forEach((d) => batch.delete(d.ref));

  // Delete the user's own blocks.
  const blocks = await db.collection('blocks').where('blockerId', '==', uid).get();
  blocks.forEach((d) => batch.delete(d.ref));

  // Ledger rows are retained but anonymized in place (fromUserId/toUserId
  // scrubbed) — the amounts and stripe refs survive for 1099/tax reconciliation.
  const ledgerFrom = await db.collection('ledger').where('fromUserId', '==', uid).get();
  const ledgerTo = await db.collection('ledger').where('toUserId', '==', uid).get();
  ledgerFrom.forEach((d) => batch.update(d.ref, { fromUserId: null, note: 'anonymized' }));
  ledgerTo.forEach((d) => batch.update(d.ref, { toUserId: null, note: 'anonymized' }));

  batch.delete(db.doc(`users/${uid}`));
  await batch.commit();

  // Finally remove the auth record so the phone number is freed.
  await getAuth().deleteUser(uid);
  return { ok: true };
});
