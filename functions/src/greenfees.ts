/**
 * The cancellation ladder (spec §5) for a scheduled match.
 *
 * Green fees are ALWAYS paid by each player at the course — The Draw never
 * collects, splits, or refunds them. (An opt-in "prepaid split" existed and was
 * removed: it contradicted that rule.) If a match is cancelled, whoever booked
 * the tee time cancels it with the course under the course's own policy.
 *
 * Ladder (published before entry, deterministic §P1):
 *   >72h   — free reschedule (one per season), back to scheduling, no mark
 *   24–72h — back to scheduling, late-cancel mark on the canceller's record
 *   <24h   — the canceller forfeits the match to their opponent
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp, requireAuth, requireActive, writeReputation } from './shared';
import { forfeitMatch } from './matches';
import { notify } from './lib/notify';

const H = 3_600_000;

/** The deterministic cancellation ladder (§5). Either competitor may invoke. */
export const cancelScheduledMatch = onCall<{ matchId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const mRef = db.doc(`matches/${req.data.matchId}`);
  const m = (await mRef.get()).data() as any;
  if (!m) throw new HttpsError('not-found', 'Match not found.');
  if (m.status !== 'scheduled') throw new HttpsError('failed-precondition', 'Nothing scheduled to cancel.');

  // Identify the canceller's entry.
  let myEntryId: string | null = null;
  for (const entryId of m.entryIds) {
    if (!entryId) continue;
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { captainId: string; userIds: string[] } | undefined;
    if (e?.userIds.includes(uid)) myEntryId = entryId;
  }
  if (!myEntryId) throw new HttpsError('permission-denied', 'You are not in this match.');

  const teeMs = (m.scheduling?.agreedTime as Timestamp | null)?.toMillis() ?? 0;
  const hoursOut = (teeMs - Date.now()) / H;

  // Both reschedule branches tell the opponent — a vanished tee time with no
  // notice is exactly the flake experience this app exists to prevent.
  async function notifyOpponent(body: string) {
    const other = m.entryIds.find((x: string) => x && x !== myEntryId);
    if (!other) return;
    const oe = (await db.doc(`entries/${other}`).get()).data() as { userIds: string[] } | undefined;
    for (const u of oe?.userIds ?? []) {
      await notify({ userId: u, title: 'Tee time cancelled', body, deadlineCritical: true, link: `/matches/${req.data.matchId}` });
    }
  }

  if (hoursOut > 72) {
    // Free reschedule — ONE per season per entry, and genuinely free: no
    // reputation mark.
    const eRef = db.doc(`entries/${myEntryId}`);
    const e = (await eRef.get()).data() as { seasonRescheduleUsed?: boolean };
    if (e.seasonRescheduleUsed) {
      throw new HttpsError('failed-precondition', 'You have used your free reschedule this season.');
    }
    await eRef.update({ seasonRescheduleUsed: true });
    await mRef.update({
      status: 'scheduling',
      'scheduling.agreedTime': null,
      'scheduling.deadline': Timestamp.fromMillis(Date.now() + 48 * H),
    });
    await notifyOpponent('Your opponent used their free reschedule (72h+ notice). Back to scheduling — post fresh dates.');
    return { ok: true, outcome: 'rescheduled' };
  }

  if (hoursOut >= 24) {
    // Late reschedule: the match goes back to scheduling and the canceller
    // takes a late-cancel mark. Deterministic — no pending states
    // waiting on an attestation flow that doesn't exist.
    await mRef.update({
      status: 'scheduling',
      'scheduling.agreedTime': null,
      'scheduling.deadline': Timestamp.fromMillis(Date.now() + 48 * H),
    });
    await writeReputation(uid, 'lateCancel', req.data.matchId, Date.now());
    await notifyOpponent('Your opponent cancelled 24–72h out (late-cancel on their record). Back to scheduling — post fresh dates.');
    return { ok: true, outcome: 'rescheduled-late' };
  }

  // <24h — the canceller forfeits; their captured stake goes to the opponent (§P1: deterministic).
  const other = m.entryIds.find((e: string) => e && e !== myEntryId);
  await forfeitMatch(req.data.matchId, myEntryId, other, 'Cancelled inside 24 hours.');
  return { ok: true, outcome: 'forfeited' };
});
