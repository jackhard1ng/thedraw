/**
 * Organizer actions (spec §5 Roles). An organizer is a club handicap committee,
 * framed that way in the UI. They verify handicaps, adjust the Tour Index (our
 * competition handicap — never their GHIN), resolve disputes, and moderate.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, Timestamp, requireAuth, requireOrganizer, getUser } from './shared';
import { finalizeMatch } from './matches';
import { maybeCompleteTournament } from './completion';
import { isValidMargin, loserOf } from './engine/scoring';
import { notify } from './lib/notify';

export const verifyHandicap = onCall<{ userId: string; source: 'ghin' | 'thirdParty' | 'self'; note?: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const target = await getUser(req.data.userId);
  await requireOrganizer(uid, target.marketId);
  // An organizer may NOT verify their own handicap — self-verification is the
  // cheapest sandbag (declare a soft 14, stamp it verified, farm net money).
  if (req.data.userId === uid) {
    throw new HttpsError('permission-denied', 'You can’t verify your own handicap — another organizer or an admin must.');
  }
  // Stamping "GHIN-verified" requires a GHIN number actually on file — the
  // badge is meaningless (and the anti-sandbag gate defeated) if any click
  // makes source 'ghin'. The organizer confirms the number against the public
  // GHIN lookup out of band; this at least forces the number to exist.
  if (req.data.source === 'ghin' && !target.handicap?.ghinNumber) {
    throw new HttpsError('failed-precondition', 'This player has no GHIN number on file — they must add one before you can verify a GHIN source.');
  }
  await db.doc(`users/${req.data.userId}`).update({
    'handicap.source': req.data.source,
    'handicap.verifiedAt': FieldValue.serverTimestamp(),
    'handicap.verifiedBy': uid,
  });
  // Close any open request this verification answers, and tell the player —
  // the green badge is the key that unlocks money events.
  const open = await db
    .collection('verificationRequests')
    .where('userId', '==', req.data.userId)
    .where('status', '==', 'open')
    .get();
  await Promise.all(open.docs.map((d) => d.ref.update({ status: 'resolved', resolvedBy: uid })));
  await notify({
    userId: req.data.userId,
    title: 'Handicap verified',
    body: 'An organizer verified your index — the green badge is on your card and money events are open to you.',
    link: '/me',
  });
  return { ok: true };
});

export const adjustTourIndex = onCall<{ userId: string; tourIndex: number; note: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const target = await getUser(req.data.userId);
  await requireOrganizer(uid, target.marketId);
  if (!req.data.note?.trim()) throw new HttpsError('invalid-argument', 'A note is required — always explain a Tour Index change.');
  // Never modifies their GHIN/external index — a separate competition handicap.
  await db.doc(`users/${req.data.userId}`).update({ tourIndex: req.data.tourIndex });
  await db.collection('users').doc(req.data.userId).collection('tourIndexLog').add({
    tourIndex: req.data.tourIndex,
    note: req.data.note.slice(0, 500),
    by: uid,
    at: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const resolveDispute = onCall<{ matchId: string; winnerEntryId: string; margin: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const mRef = db.doc(`matches/${req.data.matchId}`);
  const match = (await mRef.get()).data() as { tournamentId: string; entryIds: [string, string] } | undefined;
  if (!match) throw new HttpsError('not-found', 'Match not found.');
  const t = (await db.doc(`tournaments/${match.tournamentId}`).get()).data() as { marketId: string } | undefined;
  await requireOrganizer(uid, t?.marketId ?? '');
  // A market organizer may PLAY in events (their revenue share is market-level,
  // not event-level) — but never referee a match they're competing in.
  for (const entryId of match.entryIds) {
    if (!entryId) continue;
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
    if (e?.userIds.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are a competitor in this match — a different organizer or admin must rule.');
    }
  }
  if (!isValidMargin(req.data.margin) || !loserOf(match.entryIds, req.data.winnerEntryId)) {
    throw new HttpsError('invalid-argument', 'Provide a valid winner and margin.');
  }
  await mRef.update({
    'result.winnerEntryId': req.data.winnerEntryId,
    'result.margin': req.data.margin,
    'result.disputed': false,
    // Permanent marker so the match page can say "ruled by an organizer" —
    // clearing `disputed` alone would erase the history from view.
    'result.resolvedByOrganizer': true,
  });
  await finalizeMatch(req.data.matchId, null);
  // Close any open dispute reports for this match.
  const reports = await db.collection('reports').where('targetType', '==', 'match').where('targetId', '==', req.data.matchId).where('status', '==', 'open').get();
  await Promise.all(reports.docs.map((d) => d.ref.update({ status: 'resolved' })));
  // Both competitors hear the ruling — finalizeMatch already announced the
  // final result; this names it as an organizer ruling, not an agreement.
  for (const entryId of match.entryIds) {
    if (!entryId) continue;
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
    for (const u of e?.userIds ?? []) {
      await notify({
        userId: u,
        title: 'Dispute ruled',
        body: `An organizer reviewed the dispute and finalized the result (${req.data.margin}). The ruling is on the match page.`,
        deadlineCritical: true,
        link: `/matches/${req.data.matchId}`,
      });
    }
  }
  return { ok: true };
});

/**
 * Rule a disputed stroke-play scorecard (§5) — the stroke-play counterpart to
 * resolveDispute. The organizer sets the authoritative gross; net is recomputed
 * from the handicap frozen at the draw. Marking the card `complete` releases the
 * hold the dispute placed on the event, so maybeCompleteTournament can finish
 * and payouts proceed.
 */
export const resolveScoreDispute = onCall<{ scorecardId: string; gross: number }>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`scorecards/${req.data.scorecardId}`);
  const sc = (await ref.get()).data() as
    | { tournamentId: string; entryId: string; userId: string; courseHandicap: number | null; status: string; disputedBy?: string }
    | undefined;
  if (!sc) throw new HttpsError('not-found', 'Scorecard not found.');
  if (sc.status !== 'disputed') throw new HttpsError('failed-precondition', 'That card is not under dispute.');
  const t = (await db.doc(`tournaments/${sc.tournamentId}`).get()).data() as { marketId: string; name: string } | undefined;
  await requireOrganizer(uid, t?.marketId ?? '');
  // An organizer may compete in the market's events, but never referee one they
  // are playing in.
  const mine = await db.collection('entries').where('tournamentId', '==', sc.tournamentId).where('userIds', 'array-contains', uid).limit(1).get();
  if (!mine.empty) {
    throw new HttpsError('permission-denied', 'You are competing in this event — a different organizer must rule.');
  }
  if (!Number.isInteger(req.data.gross) || req.data.gross <= 0) {
    throw new HttpsError('invalid-argument', 'Enter the ruled gross score as a whole number.');
  }
  const net = sc.courseHandicap != null ? req.data.gross - sc.courseHandicap : null;
  await ref.update({
    gross: req.data.gross,
    net,
    status: 'complete',
    confirmedBy: uid,
    confirmedAt: Timestamp.now(),
    resolvedByOrganizer: true,
  });
  // Close open dispute reports for this card.
  const reports = await db.collection('reports').where('targetType', '==', 'scorecard').where('targetId', '==', req.data.scorecardId).where('status', '==', 'open').get();
  await Promise.all(reports.docs.map((d) => d.ref.update({ status: 'resolved' })));
  // Tell the scorer's side and the disputer the card was ruled.
  const scorerEntry = (await db.doc(`entries/${sc.entryId}`).get()).data() as { userIds: string[] } | undefined;
  const audience = new Set<string>([...(scorerEntry?.userIds ?? []), ...(sc.disputedBy ? [sc.disputedBy] : [])]);
  for (const u of audience) {
    await notify({
      userId: u,
      title: 'Dispute ruled',
      body: `An organizer ruled the disputed card at gross ${req.data.gross}. ${t?.name ?? 'The event'} can now settle.`,
      deadlineCritical: true,
      link: `/tournaments/${sc.tournamentId}/leaderboard`,
    });
  }
  // Releasing the hold may complete the event and move payouts.
  await maybeCompleteTournament(sc.tournamentId);
  return { ok: true };
});

export const restrictUser = onCall<{ userId: string; status: 'active' | 'restricted' | 'banned' }>(async (req) => {
  const uid = requireAuth(req.auth);
  const actor = await getUser(uid);
  const target = await getUser(req.data.userId);
  // Restrict is organizer-level; a full ban is admin-only (§5 Roles).
  if (req.data.status === 'banned' && actor.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an admin can ban.');
  }
  await requireOrganizer(uid, target.marketId);
  await db.doc(`users/${req.data.userId}`).update({ status: req.data.status });
  return { ok: true };
});

export const reviewEventRequest = onCall<{ requestId: string; decision: 'approved' | 'declined' }>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`eventRequests/${req.data.requestId}`);
  const r = (await ref.get()).data() as { marketId?: string } | undefined;
  if (!r) throw new HttpsError('not-found', 'Request not found.');
  await requireOrganizer(uid, r.marketId ?? (await getUser(uid)).marketId);
  await ref.update({ status: req.data.decision, reviewedBy: uid, reviewedAt: Timestamp.now() });
  return { ok: true };
});
