/**
 * Match scheduling + results (spec §5). The players are the committee (§4): the
 * server records well-formed results and advances the draw. Silence resolves —
 * an unconfirmed result auto-confirms after 48h via the scheduler (§P1).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, Timestamp, requireAuth, requireActive, writeReputation } from './shared';
import { isValidMargin, loserOf } from './engine/scoring';
import { EXTENSION_DAYS, RESULT_CONFIRM_HOURS, MIN_DATES } from './engine/scheduling';
import { advanceWinner } from './lib/matchgen';
import { notify } from './lib/notify';
import { maybeCompleteTournament } from './completion';

interface MatchDoc {
  tournamentId: string;
  round: number;
  podIndex?: number;
  entryIds: [string, string];
  scheduling: { deadline: Timestamp | null; extensionsUsed: Record<string, boolean> };
  result: any;
  status: string;
}

/** Which of the match's two entries is captained by `uid`, or null. */
async function actorEntry(match: MatchDoc, uid: string): Promise<string | null> {
  for (const entryId of match.entryIds) {
    if (!entryId) continue;
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { captainId: string } | undefined;
    if (e?.captainId === uid) return entryId;
  }
  return null;
}

function parseBracket(id: string): { round: number; index: number } | null {
  const m = id.match(/_r(\d+)_m(\d+)$/);
  return m ? { round: Number(m[1]), index: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------
export const submitAvailability = onCall<{ matchId: string; dates: number[] }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match) throw new HttpsError('not-found', 'Match not found.');
  const entryId = await actorEntry(match, uid);
  if (!entryId) throw new HttpsError('permission-denied', 'You are not in this match.');
  if ((req.data.dates?.length ?? 0) < MIN_DATES) {
    throw new HttpsError('invalid-argument', `Submit at least ${MIN_DATES} dates.`);
  }
  await ref.update({
    'scheduling.availabilityLog': FieldValue.arrayUnion({
      entryId,
      dates: req.data.dates.map((ms) => Timestamp.fromMillis(ms)),
      submittedAt: Timestamp.now(),
    }),
  });
  return { ok: true, status: match.status };
});

export const useExtension = onCall<{ matchId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match) throw new HttpsError('not-found', 'Match not found.');
  const entryId = await actorEntry(match, uid);
  if (!entryId) throw new HttpsError('permission-denied', 'You are not in this match.');

  // One extension per tournament per captain (§5.3) — tracked on the entry.
  const eRef = db.doc(`entries/${entryId}`);
  const e = (await eRef.get()).data() as { extensionUsed?: boolean };
  if (e.extensionUsed) throw new HttpsError('failed-precondition', 'You have already used your extension this tournament.');

  const base = match.scheduling.deadline?.toMillis() ?? Date.now();
  await ref.update({
    'scheduling.deadline': Timestamp.fromMillis(base + EXTENSION_DAYS * 86_400_000),
    [`scheduling.extensionsUsed.${entryId}`]: true,
  });
  await eRef.update({ extensionUsed: true });
  return { ok: true };
});

export const setAgreedTime = onCall<{
  matchId: string;
  agreedTime: number;
  placeId: string | null;
  bookedBy: string | null;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match) throw new HttpsError('not-found', 'Match not found.');
  if (!(await actorEntry(match, uid))) throw new HttpsError('permission-denied', 'You are not in this match.');
  await ref.update({
    'scheduling.agreedTime': Timestamp.fromMillis(req.data.agreedTime),
    'scheduling.placeId': req.data.placeId,
    'scheduling.bookedBy': req.data.bookedBy,
    status: 'scheduled',
  });
  // Record "committed" once per match so attendance ("played X of Y committed",
  // §4) is meaningful — it pairs 1:1 with the later played/noShow outcome.
  if (!(match as MatchDoc & { committedRecorded?: boolean }).committedRecorded) {
    const now = Date.now();
    for (const entryId of match.entryIds) {
      if (!entryId) continue;
      const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
      for (const u of e?.userIds ?? []) await writeReputation(u, 'committed', req.data.matchId, now);
    }
    await ref.update({ committedRecorded: true });
  }
  return { ok: true };
});

export const submitResult = onCall<{
  matchId: string;
  winnerEntryId: string;
  margin: string;
  scorecardPhotoUrl?: string;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match) throw new HttpsError('not-found', 'Match not found.');
  const entryId = await actorEntry(match, uid);
  if (!entryId) throw new HttpsError('permission-denied', 'You are not in this match.');
  if (!isValidMargin(req.data.margin)) throw new HttpsError('invalid-argument', 'Enter a result margin, e.g. "3&2".');
  if (!loserOf(match.entryIds, req.data.winnerEntryId)) {
    throw new HttpsError('invalid-argument', 'Winner must be one of the two competitors.');
  }
  await ref.update({
    'result.submittedBy': entryId,
    'result.submittedAt': Timestamp.now(),
    'result.winnerEntryId': req.data.winnerEntryId,
    'result.margin': req.data.margin,
    'result.scorecardPhotoUrl': req.data.scorecardPhotoUrl ?? null,
    'result.confirmDeadline': Timestamp.fromMillis(Date.now() + RESULT_CONFIRM_HOURS * 3_600_000),
    status: 'awaitingConfirmation',
  });
  // Notify the other side — 48h to confirm or dispute, else it auto-confirms.
  const other = match.entryIds.find((e) => e && e !== entryId);
  if (other) {
    const oe = (await db.doc(`entries/${other}`).get()).data() as { captainId: string } | undefined;
    if (oe) await notify({ userId: oe.captainId, title: 'Confirm your result', body: 'Your opponent reported the match. Confirm or dispute within 48h, or it auto-confirms.', deadlineCritical: true, link: `/matches/${req.data.matchId}` });
  }
  return { ok: true, status: 'awaitingConfirmation' };
});

export const confirmResult = onCall<{ matchId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match) throw new HttpsError('not-found', 'Match not found.');
  const entryId = await actorEntry(match, uid);
  if (!entryId) throw new HttpsError('permission-denied', 'You are not in this match.');
  if (entryId === match.result?.submittedBy) {
    throw new HttpsError('failed-precondition', 'The other side confirms — you submitted it.');
  }
  await finalizeMatch(req.data.matchId, entryId);
  return { ok: true };
});

export const disputeResult = onCall<{ matchId: string; note: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match) throw new HttpsError('not-found', 'Match not found.');
  if (!(await actorEntry(match, uid))) throw new HttpsError('permission-denied', 'You are not in this match.');
  const t = (await db.doc(`tournaments/${match.tournamentId}`).get()).data() as { marketId: string; name: string } | undefined;
  await ref.update({ 'result.disputed': true });
  // Route to the market organizer with the scorecard attached (§5).
  await db.collection('reports').add({
    reportedBy: uid,
    targetType: 'match',
    targetId: req.data.matchId,
    marketId: t?.marketId ?? '',
    reason: `Disputed result: ${String(req.data.note).slice(0, 500)}`,
    context: null,
    createdAt: FieldValue.serverTimestamp(),
    status: 'open',
  });
  return { ok: true };
});

/**
 * Finalize a confirmed (or auto-confirmed) match: freeze the result, eliminate
 * the loser, advance the winner (bracket) and record reputation. `confirmedBy`
 * is the entry that confirmed, or null for an auto-confirm.
 */
export async function finalizeMatch(matchId: string, confirmedBy: string | null) {
  const ref = db.doc(`matches/${matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match || match.status === 'complete') return;
  const winner = match.result?.winnerEntryId as string | undefined;
  if (!winner) return;
  const loser = loserOf(match.entryIds, winner);

  await ref.update({
    status: 'complete',
    'result.confirmedBy': confirmedBy,
    'result.confirmedAt': Timestamp.now(),
  });
  if (loser) await db.doc(`entries/${loser}`).update({ status: 'eliminated' });

  // Reputation: everyone who showed up played.
  const now = Date.now();
  for (const entryId of match.entryIds) {
    if (!entryId) continue;
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
    for (const u of e?.userIds ?? []) await writeReputation(u, 'played', matchId, now);
  }

  const t = (await db.doc(`tournaments/${match.tournamentId}`).get()).data() as { bracketRounds?: number; structure: string } | undefined;

  if (match.podIndex === undefined && t?.structure === 'bracket') {
    const parsed = parseBracket(matchId);
    if (parsed && t.bracketRounds && parsed.round < t.bracketRounds) {
      await advanceWinner(match.tournamentId, parsed.round, parsed.index, winner);
    }
  }
  // For pods and stroke play, completion is decided by tallying, not advancement.
  await maybeCompleteTournament(match.tournamentId);
}

/**
 * Forfeit finalizer — used by the deterministic deadline machinery (§P1). The
 * advancing entry moves on; the non-responder is eliminated and takes a
 * forfeitNonResponse reputation mark (which expires in ~1 year).
 */
export async function forfeitMatch(
  matchId: string,
  forfeitedEntryId: string | null,
  advancingEntryId: string,
  reason: string,
) {
  const ref = db.doc(`matches/${matchId}`);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match || match.status === 'complete' || match.status === 'forfeited') return;

  await ref.update({
    status: 'forfeited',
    forfeitedBy: forfeitedEntryId,
    forfeitReason: reason,
    'result.winnerEntryId': advancingEntryId,
    'result.confirmedAt': Timestamp.now(),
  });
  const now = Date.now();
  if (forfeitedEntryId) {
    await db.doc(`entries/${forfeitedEntryId}`).update({ status: 'forfeited' });
    const fe = (await db.doc(`entries/${forfeitedEntryId}`).get()).data() as { userIds: string[] } | undefined;
    for (const u of fe?.userIds ?? []) await writeReputation(u, 'forfeitNonResponse', matchId, now);
  }

  const t = (await db.doc(`tournaments/${match.tournamentId}`).get()).data() as { bracketRounds?: number; structure: string } | undefined;
  if (match.podIndex === undefined && t?.structure === 'bracket') {
    const parsed = parseBracket(matchId);
    if (parsed && t.bracketRounds && parsed.round < t.bracketRounds) {
      await advanceWinner(match.tournamentId, parsed.round, parsed.index, advancingEntryId);
    }
  }
  await maybeCompleteTournament(match.tournamentId);
}

// ---------------------------------------------------------------------------
// Stroke-play scorecards (gross foursome, multi-round stroke play).
// ---------------------------------------------------------------------------
export const submitRoundScore = onCall<{
  tournamentId: string;
  round: number;
  gross: number;
  scorecardPhotoUrl?: string;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const { tournamentId, round, gross } = req.data;
  const entry = await db.collection('entries').where('tournamentId', '==', tournamentId).where('userIds', 'array-contains', uid).limit(1).get();
  if (entry.empty) throw new HttpsError('permission-denied', 'You are not in this tournament.');
  const entryId = entry.docs[0].id;
  const id = `${tournamentId}_${entryId}_${round}`;
  const ref = db.doc(`scorecards/${id}`);
  const cardSnap = await ref.get();
  if (!cardSnap.exists) throw new HttpsError('not-found', 'No scorecard for that round.');
  if (!Number.isInteger(gross) || gross <= 0) throw new HttpsError('invalid-argument', 'Enter a valid gross score.');
  // Net = gross − the playing handicap FROZEN at draw time. Null handicap
  // (gross format, or a course without tee data) means this card is gross-only.
  const frozenCh = (cardSnap.data() as { courseHandicap: number | null }).courseHandicap;
  await ref.update({
    gross,
    net: frozenCh != null ? gross - frozenCh : null,
    submittedBy: uid,
    scorecardPhotoUrl: req.data.scorecardPhotoUrl ?? null,
    confirmDeadline: Timestamp.fromMillis(Date.now() + RESULT_CONFIRM_HOURS * 3_600_000),
    status: 'awaitingConfirmation',
  });
  return { ok: true, status: 'awaitingConfirmation' };
});

export const confirmRoundScore = onCall<{ scorecardId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const ref = db.doc(`scorecards/${req.data.scorecardId}`);
  const sc = (await ref.get()).data() as { userId: string; status: string } | undefined;
  if (!sc) throw new HttpsError('not-found', 'Scorecard not found.');
  // A playing partner attests — anyone in the field other than the scorer (§4 marker).
  if (sc.userId === uid) throw new HttpsError('failed-precondition', 'A playing partner must confirm your card.');
  await ref.update({ status: 'complete', confirmedBy: uid, confirmedAt: Timestamp.now() });
  const scData = (await ref.get()).data() as { tournamentId: string };
  await maybeCompleteTournament(scData.tournamentId);
  return { ok: true };
});
