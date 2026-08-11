/**
 * Phase 1 — the board. Join/leave stay server-authoritative so slot counts and
 * blocks can't be forged past the security rules; report/block/delete route
 * moderation and honor the actual-deletion requirement (§5).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { db, FieldValue, requireAuth, requireActive, getUser, addThreadMembers, removeThreadMembers } from './shared';

export const joinRound = onCall<{ postId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const { postId } = req.data;
  if (!postId) throw new HttpsError('invalid-argument', 'postId required.');
  const postRef = db.doc(`roundPosts/${postId}`);

  const post = (await postRef.get()).data() as { createdBy: string } | undefined;
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
    if (p.createdBy === uid) throw new HttpsError('failed-precondition', 'You own this post.');
    if (p.status === 'cancelled' || p.status === 'completed') {
      throw new HttpsError('failed-precondition', 'This round is closed.');
    }
    if (p.joinedUserIds.includes(uid)) return;
    if (p.slotsFilled >= p.slotsTotal) throw new HttpsError('failed-precondition', 'This round is full.');
    if (p.hosting?.hostMustApprove) {
      // Host-approval is not built yet — an honest error beats a silent
      // "pending" state the UI can't show and the host never hears about.
      throw new HttpsError('failed-precondition', 'This round is host-approved and approvals are not open yet.');
    }
    const slotsFilled = p.slotsFilled + 1;
    tx.update(postRef, {
      joinedUserIds: FieldValue.arrayUnion(uid),
      slotsFilled,
      status: slotsFilled >= p.slotsTotal ? 'full' : 'open',
    });
  });
  await addThreadMembers(postId, [uid]); // chat rules check this membership
  return { status: 'joined' };
});

export const leaveRound = onCall<{ postId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const { postId } = req.data;
  const postRef = db.doc(`roundPosts/${postId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
    const p = snap.data() as { slotsFilled: number; joinedUserIds: string[]; status: string };
    if (!p.joinedUserIds.includes(uid)) return;
    const slotsFilled = Math.max(0, p.slotsFilled - 1);
    tx.update(postRef, {
      joinedUserIds: FieldValue.arrayRemove(uid),
      slotsFilled,
      status: p.status === 'full' ? 'open' : p.status,
    });
  });
  await removeThreadMembers(postId, [uid]);
  return { status: 'left' };
});

export const submitReport = onCall<{
  targetType: 'user' | 'post' | 'match';
  targetId: string;
  reason: string;
  context?: string;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const { targetType, targetId, reason, context } = req.data;
  if (!targetId || !reason) throw new HttpsError('invalid-argument', 'targetId and reason required.');
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

  // Report volume is a signal (§5): multiple INDEPENDENT open reports against
  // one target surface to the organizer proactively, not in a queue.
  const open = await db
    .collection('reports')
    .where('targetType', '==', targetType)
    .where('targetId', '==', targetId)
    .where('status', '==', 'open')
    .get();
  const reporters = new Set(open.docs.map((d) => (d.data() as { reportedBy: string }).reportedBy));
  if (reporters.size >= 2) {
    const market = (await db.doc(`markets/${user.marketId}`).get()).data() as
      | { organizerIds: string[] }
      | undefined;
    const { notify } = await import('./lib/notify');
    await Promise.all(
      (market?.organizerIds ?? []).map((orgId) =>
        notify({
          userId: orgId,
          title: `${reporters.size} reports against one ${targetType}`,
          body: 'Multiple independent reports on the same target — worth a look now.',
          deadlineCritical: true,
          link: '/organizer',
        }),
      ),
    );
  }

  return { reportId: ref.id };
});

export const blockUser = onCall<{ blockedId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const { blockedId } = req.data;
  if (!blockedId || blockedId === uid) throw new HttpsError('invalid-argument', 'Invalid target.');
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

export const deleteAccount = onCall<Record<string, never>>(async (req) => {
  const uid = requireAuth(req.auth);
  await getUser(uid); // ensure exists

  const posts = await db.collection('roundPosts').where('createdBy', '==', uid).get();
  const rounds = await db.collection('rounds').where('userId', '==', uid).get();
  const blocks = await db.collection('blocks').where('blockerId', '==', uid).get();
  const ledgerFrom = await db.collection('ledger').where('fromUserId', '==', uid).get();
  const ledgerTo = await db.collection('ledger').where('toUserId', '==', uid).get();

  const batch = db.batch();
  posts.forEach((d) => batch.update(d.ref, { status: 'cancelled' }));
  rounds.forEach((d) => batch.delete(d.ref));
  blocks.forEach((d) => batch.delete(d.ref));
  // Ledger rows are RETAINED (tax/1099) but anonymized in place (§5).
  ledgerFrom.forEach((d) => batch.update(d.ref, { fromUserId: null, note: 'anonymized' }));
  ledgerTo.forEach((d) => batch.update(d.ref, { toUserId: null, note: 'anonymized' }));
  batch.delete(db.doc(`users/${uid}/private/data`)); // PII goes with the account
  batch.delete(db.doc(`users/${uid}`));
  await batch.commit();

  await getAuth().deleteUser(uid);
  return { ok: true };
});
