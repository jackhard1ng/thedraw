/**
 * Board lifecycle — three features that make the board self-sustaining:
 *
 * 1. ATTESTATION FUNNEL. Eligibility's alternate path is minAttestedRounds,
 *    and this is the only flow that creates an attested round. When a posted
 *    round's tee time passes, the post completes and everyone is nudged to log
 *    a score; any OTHER member of the group attests it (the §P3 witness —
 *    someone with an interest in an accurate result). Attested rounds feed the
 *    money-event gate and write real reputation (committed → played).
 *
 * 2. STANDING GAMES. A post marked `recurrence: 'weekly'` re-posts itself for
 *    the following week when it completes — "every Saturday 7am at Swope"
 *    seeds a season from one tap instead of a weekly chore.
 *
 * 3. MATCH ALERTS. When a post is created, players in the market who opted in
 *    (and are within their chosen index range of the poster) get an in-app
 *    notification — the demand side of the board. Not SMS: alerts are useful,
 *    not deadline-critical (§5 notification channels).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue, Timestamp, requireAuth, requireActive, writeReputation } from './shared';
import { notify } from './lib/notify';

// ---------------------------------------------------------------------------
// 1 + 2 — the hourly sweep (called from scheduled.tick)
// ---------------------------------------------------------------------------
export async function boardSweep(now: number) {
  // Fixed-time posts whose tee time has passed and are still open/full.
  const due = await db
    .collection('roundPosts')
    .where('status', 'in', ['open', 'full'])
    .where('timing.fixedTime', '<=', Timestamp.fromMillis(now))
    .get();

  for (const d of due.docs) {
    const p = d.data() as {
      createdBy: string;
      joinedUserIds: string[];
      marketId: string;
      title: string | null;
      recurrence?: 'weekly' | null;
      timing: { fixedTime: Timestamp | null };
      slotsFilled: number;
    };
    await d.ref.update({ status: 'completed' });

    // Reputation + attestation nudge — only if anyone actually joined.
    const group = [p.createdBy, ...p.joinedUserIds];
    if (p.joinedUserIds.length > 0) {
      for (const u of group) {
        await writeReputation(u, 'committed', null, now);
        await notify({
          userId: u,
          title: 'How was the round?',
          body: 'Log your score and attest your group — attested rounds count toward money-event eligibility.',
          link: `/post/${d.id}`,
        });
      }
    }

    // Standing game: clone one week forward, fresh slots, same everything else.
    if (p.recurrence === 'weekly' && p.timing.fixedTime) {
      const src = d.data();
      const nextTime = Timestamp.fromMillis(p.timing.fixedTime.toMillis() + 7 * 86_400_000);
      await db.collection('roundPosts').add({
        ...src,
        timing: { ...src.timing, fixedTime: nextTime },
        slotsFilled: 0,
        joinedUserIds: [],
        status: 'open',
        createdAt: FieldValue.serverTimestamp(),
        standingOriginId: (src.standingOriginId as string | undefined) ?? d.id,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// confirmTeeTime — the booker locks in the actual tee time on a post (board
// post or draw group). Flips booking to "booked", pins the fixed time, and
// SMS-notifies everyone in the group: the round is real now.
// ---------------------------------------------------------------------------
export const confirmTeeTime = onCall<{
  postId: string;
  teeTime: number; // epoch ms
  placeId?: string | null;
  courseName?: string | null;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const ref = db.doc(`roundPosts/${req.data.postId}`);
  const post = (await ref.get()).data() as
    | { createdBy: string; joinedUserIds: string[]; status: string; course: { placeId: string | null } }
    | undefined;
  if (!post) throw new HttpsError('not-found', 'Post not found.');
  if (post.createdBy !== uid) {
    throw new HttpsError('permission-denied', 'The booker (post creator) confirms the tee time.');
  }
  if (post.status !== 'open' && post.status !== 'full') {
    throw new HttpsError('failed-precondition', 'This round is closed.');
  }
  if (!req.data.teeTime || req.data.teeTime < Date.now()) {
    throw new HttpsError('invalid-argument', 'Pick a future tee time.');
  }
  await ref.update({
    'timing.mode': 'fixed',
    'timing.fixedTime': Timestamp.fromMillis(req.data.teeTime),
    'timing.flexibleDays': null,
    booking: 'booked',
    ...(req.data.placeId ? { 'course.placeId': req.data.placeId, 'course.mode': 'specific' } : {}),
  });
  const when = new Date(req.data.teeTime).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago',
  });
  for (const u of post.joinedUserIds) {
    await notify({
      userId: u,
      title: 'Tee time confirmed',
      body: `${when}${req.data.courseName ? ` at ${req.data.courseName}` : ''} — you're locked in.`,
      deadlineCritical: true,
      link: `/post/${req.data.postId}`,
    });
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// 1 — attestRound: a groupmate vouches for a score (§P3 witness)
// ---------------------------------------------------------------------------
export const attestRound = onCall<{ roundId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const rRef = db.doc(`rounds/${req.data.roundId}`);
  const round = (await rRef.get()).data() as
    | { userId: string; roundPostId: string | null; source: string }
    | undefined;
  if (!round) throw new HttpsError('not-found', 'Round not found.');
  if (round.userId === uid) {
    throw new HttpsError('failed-precondition', 'A playing partner attests your round — not you.');
  }
  if (round.source !== 'selfReported') {
    throw new HttpsError('failed-precondition', 'Already attested.');
  }
  if (!round.roundPostId) {
    throw new HttpsError('failed-precondition', 'Only rounds from a board post can be attested.');
  }
  // The attester must have been in the same group.
  const post = (await db.doc(`roundPosts/${round.roundPostId}`).get()).data() as
    | { createdBy: string; joinedUserIds: string[] }
    | undefined;
  const group = post ? [post.createdBy, ...post.joinedUserIds] : [];
  if (!group.includes(uid) || !group.includes(round.userId)) {
    throw new HttpsError('permission-denied', 'Only someone who played in that group can attest.');
  }

  await rRef.update({ source: 'attested', attestedBy: uid });
  await writeReputation(round.userId, 'played', null, Date.now());
  return { ok: true };
});

// ---------------------------------------------------------------------------
// 3 — match alerts on post creation (in-app; opt-in via users.alertPrefs)
// ---------------------------------------------------------------------------
export const onRoundPosted = onDocumentCreated('roundPosts/{postId}', async (event) => {
  const post = event.data?.data() as
    | { marketId: string; createdBy: string; title: string | null; vibe: string }
    | undefined;
  if (!post) return;

  const creator = (await db.doc(`users/${post.createdBy}`).get()).data() as
    | { displayName: string; handicap: { index: number } }
    | undefined;
  if (!creator) return;

  const candidates = await db
    .collection('users')
    .where('marketId', '==', post.marketId)
    .where('alertPrefs.newPostAlerts', '==', true)
    .limit(200)
    .get();

  for (const d of candidates.docs) {
    if (d.id === post.createdBy) continue;
    const u = d.data() as {
      handicap: { index: number };
      alertPrefs?: { maxIndexDelta?: number | null };
    };
    const delta = u.alertPrefs?.maxIndexDelta;
    if (delta != null && Math.abs(u.handicap.index - creator.handicap.index) > delta) continue;
    // A block in either direction suppresses the alert.
    const [a, b] = await Promise.all([
      db.doc(`blocks/${d.id}_${post.createdBy}`).get(),
      db.doc(`blocks/${post.createdBy}_${d.id}`).get(),
    ]);
    if (a.exists || b.exists) continue;
    await notify({
      userId: d.id,
      title: 'New round on the board',
      body: `${creator.displayName} (${creator.handicap.index.toFixed(1)}) posted${post.title ? `: ${post.title}` : ' a round'}.`,
      link: `/post/${event.params.postId}`,
    });
  }
});
