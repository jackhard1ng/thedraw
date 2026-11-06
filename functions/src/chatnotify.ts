/**
 * Chat message notifications — the glue that keeps coordination IN the app.
 * An unseen in-app message sends both players back to text messaging forever,
 * so every thread message notifies the other participants, throttled to at
 * most one notification per thread per hour per user (a conversation should
 * ping you once, not once per sentence).
 *
 * Thread id semantics (established across the app):
 *   roundPosts/{id}  — post + draw-group chat (creator + joined)
 *   matches/{id}     — match chat (both captains)
 *   tournaments/{id} — field chat (all entered captains)
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, Timestamp } from './shared';
import { notify } from './lib/notify';

async function threadParticipants(threadId: string): Promise<string[]> {
  const post = await db.doc(`roundPosts/${threadId}`).get();
  if (post.exists) {
    const p = post.data() as { createdBy: string; joinedUserIds: string[] };
    return [p.createdBy, ...p.joinedUserIds];
  }
  const match = await db.doc(`matches/${threadId}`).get();
  if (match.exists) {
    const m = match.data() as { entryIds: string[] };
    const out: string[] = [];
    for (const entryId of m.entryIds) {
      if (!entryId) continue;
      const e = (await db.doc(`entries/${entryId}`).get()).data() as
        | { userIds: string[] }
        | undefined;
      if (e) out.push(...e.userIds);
    }
    return out;
  }
  const t = await db.doc(`tournaments/${threadId}`).get();
  if (t.exists) {
    const entries = await db
      .collection('entries')
      .where('tournamentId', '==', threadId)
      .where('status', '==', 'active')
      .get();
    return entries.docs.flatMap((d) => (d.data() as { userIds: string[] }).userIds);
  }
  return [];
}

export const onChatMessage = onDocumentCreated(
  'threads/{threadId}/messages/{messageId}',
  async (event) => {
    const msg = event.data?.data() as
      | { authorId: string; authorName: string; text: string }
      | undefined;
    if (!msg) return;
    const threadId = event.params.threadId;

    const participants = [...new Set(await threadParticipants(threadId))].filter(
      (u) => u !== msg.authorId,
    );
    if (participants.length === 0) return;

    const matchSnap = await db.doc(`matches/${threadId}`).get();
    const isMatch = matchSnap.exists;
    const link = (await db.doc(`roundPosts/${threadId}`).get()).exists
      ? `/post/${threadId}`
      : isMatch
        ? `/matches/${threadId}`
        : `/tournaments/${threadId}`;

    // GAME-DAY OVERRIDE: within 12h of a match's agreed tee time, every
    // message notifies. "I'm on the tee, where are you?" must never be eaten
    // by a politeness throttle.
    let gameDay = false;
    if (isMatch) {
      const agreed = (matchSnap.data() as { scheduling?: { agreedTime?: Timestamp | null } })
        ?.scheduling?.agreedTime;
      if (agreed) gameDay = Math.abs(agreed.toMillis() - Date.now()) < 12 * 3_600_000;
    }

    const hourAgo = Timestamp.fromMillis(Date.now() - 3_600_000);
    for (const userId of participants) {
      // Throttle: skip if this user was already pinged about CHAT in this
      // thread within the hour. Keyed to kind 'chat' — a "confirm your
      // result" notice sharing the same link must not suppress chat pings.
      if (!gameDay) {
        const recent = await db
          .collection('notifications')
          .where('userId', '==', userId)
          .where('threadId', '==', threadId)
          .where('kind', '==', 'chat')
          .where('createdAt', '>', hourAgo)
          .limit(1)
          .get();
        if (!recent.empty) continue;
      }
      await notify({
        userId,
        title: `${msg.authorName} in your group chat`,
        body: msg.text.slice(0, 120),
        // Match coordination is time-sensitive and the web can't push — a
        // match-thread message rides SMS (hourly-throttled, except game day)
        // so scheduling conversations reach people without the site open (§5).
        deadlineCritical: isMatch,
        link,
        kind: 'chat',
        threadId,
      });
    }
  },
);
