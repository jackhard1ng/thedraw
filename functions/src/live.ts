/**
 * Live scoring (§4 "Phase 4"): a scorekeeper enters hole-by-hole gross during
 * the round, everyone watches the leaderboard/match card update, and at the end
 * the card closes into the EXISTING confirm/dispute flow. Two surfaces, one idea:
 *
 *   stroke play  — a scoreGroup (a foursome) is assigned at close; the keeper
 *                  fills each entry's scorecard.holes; finalizeGroup sets gross
 *                  and moves each card to awaitingConfirmation.
 *   match play   — the match IS the group; the keeper fills result.holes;
 *                  finalizeMatchScores derives the net winner + margin and moves
 *                  the result to awaitingConfirmation.
 *
 * There is NO new money path here. Finalize hands off to the confirmation engine
 * that already settles, pays, and now holds-on-dispute.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp, requireAuth, requireActive } from './shared';
import { notify } from './lib/notify';
import { netMatchState } from './engine/scoring';

const RESULT_CONFIRM_HOURS = 48;

async function playerInEntries(uid: string, entryIds: string[]): Promise<boolean> {
  for (const eid of entryIds) {
    if (!eid) continue;
    const e = (await db.doc(`entries/${eid}`).get()).data() as { userIds?: string[] } | undefined;
    if (e?.userIds?.includes(uid)) return true;
  }
  return false;
}

async function entryOf(uid: string, entryIds: string[]): Promise<string | null> {
  for (const eid of entryIds) {
    if (!eid) continue;
    const e = (await db.doc(`entries/${eid}`).get()).data() as { userIds?: string[] } | undefined;
    if (e?.userIds?.includes(uid)) return eid;
  }
  return null;
}

function validStrokes(n: unknown): boolean {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 20;
}

// ---- scorekeeper selection (default + one-tap claim) ----------------------
export const claimScorekeeper = onCall<{ scope: 'group' | 'match'; id: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const { scope, id } = req.data;
  const ref = db.doc(`${scope === 'match' ? 'matches' : 'scoreGroups'}/${id}`);
  const doc = (await ref.get()).data() as { entryIds: string[] } | undefined;
  if (!doc) throw new HttpsError('not-found', `${scope === 'match' ? 'Match' : 'Group'} not found.`);
  if (!(await playerInEntries(uid, doc.entryIds))) {
    throw new HttpsError('permission-denied', 'Only a player in this group can keep score.');
  }
  await ref.update({ scorekeeperUid: uid });
  return { ok: true };
});

// ---- stroke play: live holes + finalize -----------------------------------
export const saveStrokeHole = onCall<{ groupId: string; hole: number; scores: Record<string, number> }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const gRef = db.doc(`scoreGroups/${req.data.groupId}`);
  const g = (await gRef.get()).data() as
    | { tournamentId: string; round: number; entryIds: string[]; holeCount: number; scorekeeperUid: string; status: string }
    | undefined;
  if (!g) throw new HttpsError('not-found', 'Group not found.');
  if (g.status !== 'live') throw new HttpsError('failed-precondition', 'This group is closed.');
  if (g.scorekeeperUid !== uid) throw new HttpsError('permission-denied', 'Only the group scorekeeper can enter scores.');
  const hole = req.data.hole;
  if (!Number.isInteger(hole) || hole < 1 || hole > g.holeCount) {
    throw new HttpsError('invalid-argument', `Hole must be 1–${g.holeCount}.`);
  }
  for (const entryId of g.entryIds) {
    const strokes = req.data.scores?.[entryId];
    if (strokes == null) continue; // partial groups are fine (someone picks up)
    if (!validStrokes(strokes)) throw new HttpsError('invalid-argument', 'Strokes must be 1–20.');
    const cardRef = db.doc(`scorecards/${g.tournamentId}_${entryId}_${g.round}`);
    const card = (await cardRef.get()).data() as { holes: number[] | null; status: string } | undefined;
    if (!card) continue;
    if (card.status === 'complete' || card.status === 'disputed') continue; // already settled
    const holes =
      Array.isArray(card.holes) && card.holes.length === g.holeCount ? [...card.holes] : new Array(g.holeCount).fill(0);
    holes[hole - 1] = strokes; // 0 = not yet played; real holes are always ≥1
    await cardRef.update({ holes });
  }
  return { ok: true };
});

export const finalizeGroup = onCall<{ groupId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const gRef = db.doc(`scoreGroups/${req.data.groupId}`);
  const g = (await gRef.get()).data() as
    | { tournamentId: string; round: number; entryIds: string[]; holeCount: number; scorekeeperUid: string; status: string }
    | undefined;
  if (!g) throw new HttpsError('not-found', 'Group not found.');
  if (g.scorekeeperUid !== uid) throw new HttpsError('permission-denied', 'Only the group scorekeeper can close the card.');
  if (g.status !== 'live') return { ok: true }; // idempotent
  const deadline = Timestamp.fromMillis(Date.now() + RESULT_CONFIRM_HOURS * 3_600_000);
  for (const entryId of g.entryIds) {
    const cardRef = db.doc(`scorecards/${g.tournamentId}_${entryId}_${g.round}`);
    const card = (await cardRef.get()).data() as
      | { holes: number[] | null; courseHandicap: number | null; status: string }
      | undefined;
    if (!card) continue;
    if (card.status !== 'awaitingResult' && card.status !== 'awaitingConfirmation') continue;
    const played = (Array.isArray(card.holes) ? card.holes : []).filter((s) => s > 0);
    if (played.length === 0) continue; // nothing entered — the DNF sweep handles it
    const gross = played.reduce((a, b) => a + b, 0);
    await cardRef.update({
      gross,
      net: card.courseHandicap != null ? gross - card.courseHandicap : null,
      submittedBy: uid,
      confirmDeadline: deadline,
      status: 'awaitingConfirmation',
    });
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
    for (const u of e?.userIds ?? []) {
      if (u === uid) continue;
      await notify({
        userId: u,
        title: 'Confirm your card',
        body: `The scorekeeper posted your round (${gross}). Confirm or dispute it, or it auto-confirms in 48h.`,
        link: `/tournaments/${g.tournamentId}/scorecard`,
      });
    }
  }
  await gRef.update({ status: 'closed' });
  return { ok: true };
});

// ---- match play: live holes + finalize ------------------------------------
export const saveMatchHole = onCall<{ matchId: string; hole: number; scores: Record<string, number> }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const m = (await ref.get()).data() as
    | { entryIds: [string, string]; scorekeeperUid?: string | null; status: string; result: { holes?: unknown } }
    | undefined;
  if (!m) throw new HttpsError('not-found', 'Match not found.');
  if (m.scorekeeperUid !== uid) throw new HttpsError('permission-denied', 'Only the match scorekeeper can enter scores.');
  if (m.status !== 'scheduled') throw new HttpsError('failed-precondition', 'Scores open once the tee time is set, until the result is in.');
  const hole = req.data.hole;
  if (!Number.isInteger(hole) || hole < 1 || hole > 18) throw new HttpsError('invalid-argument', 'Invalid hole.');
  const scores: Record<string, number> = {};
  for (const eid of m.entryIds) {
    const s = req.data.scores?.[eid];
    if (s == null) continue;
    if (!validStrokes(s)) throw new HttpsError('invalid-argument', 'Strokes must be 1–20.');
    scores[eid] = s;
  }
  const holes: { hole: number; scores: Record<string, number>; winnerEntryId: string | null }[] = Array.isArray(m.result?.holes)
    ? [...(m.result.holes as { hole: number; scores: Record<string, number>; winnerEntryId: string | null }[])]
    : [];
  const idx = holes.findIndex((h) => h.hole === hole);
  const entry = { hole, scores, winnerEntryId: null };
  if (idx >= 0) holes[idx] = entry;
  else holes.push(entry);
  await ref.update({ 'result.holes': holes });
  return { ok: true };
});

export const finalizeMatchScores = onCall<{ matchId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const ref = db.doc(`matches/${req.data.matchId}`);
  const m = (await ref.get()).data() as
    | {
        tournamentId: string;
        entryIds: [string, string];
        scorekeeperUid?: string | null;
        status: string;
        result: { holes?: { hole: number; scores: Record<string, number> }[] };
        scheduling: { placeId: string | null };
      }
    | undefined;
  if (!m) throw new HttpsError('not-found', 'Match not found.');
  if (m.scorekeeperUid !== uid) throw new HttpsError('permission-denied', 'Only the match scorekeeper can submit the result.');
  if (m.status !== 'scheduled') throw new HttpsError('failed-precondition', 'This match is not open for scoring.');
  const holes = Array.isArray(m.result?.holes) ? m.result.holes : [];
  if (holes.length === 0) throw new HttpsError('failed-precondition', 'Enter some holes before finishing.');

  const t = (await db.doc(`tournaments/${m.tournamentId}`).get()).data() as { formatId: string } | undefined;
  const fmt = t
    ? ((await db.doc(`formats/${t.formatId}`).get()).data() as { holes?: number; handicapAllowance: unknown } | undefined)
    : undefined;
  const totalHoles = fmt?.holes ?? 18;
  const chByEntry: Record<string, number> = {};
  for (const eid of m.entryIds) {
    const e = (await db.doc(`entries/${eid}`).get()).data() as { combinedIndex: number } | undefined;
    chByEntry[eid] = Math.round(e?.combinedIndex ?? 0);
  }
  const ha = fmt?.handicapAllowance as { type?: string } | null | undefined;
  const scratch = !!ha && typeof ha === 'object' && ha.type === 'none';
  if (scratch) for (const k of Object.keys(chByEntry)) chByEntry[k] = 0;
  let holeHandicapOrder: number[] | null = null;
  if (m.scheduling?.placeId && !scratch) {
    const course = (await db.doc(`courses/${m.scheduling.placeId}`).get()).data() as
      | { holeHandicapOrder: number[] | null }
      | undefined;
    holeHandicapOrder = course?.holeHandicapOrder ?? null;
  }
  const state = netMatchState(holes, m.entryIds, chByEntry, holeHandicapOrder, totalHoles);
  if (!state.winnerEntryId || !state.margin) {
    if (state.allSquareAfterRegulation) {
      throw new HttpsError('failed-precondition', 'All square after the round — play on, enter the extra hole(s), then finish.');
    }
    throw new HttpsError('failed-precondition', 'The match isn’t decided yet — enter more holes.');
  }
  // The scorekeeper's own entry is the "submitter"; the OTHER side confirms —
  // so a keeper can never self-confirm (the §4 marker still holds).
  const keeperEntry = await entryOf(uid, m.entryIds);
  await ref.update({
    'result.submittedBy': keeperEntry,
    'result.submittedAt': Timestamp.now(),
    'result.winnerEntryId': state.winnerEntryId,
    'result.margin': state.margin,
    'result.confirmDeadline': Timestamp.fromMillis(Date.now() + RESULT_CONFIRM_HOURS * 3_600_000),
    status: 'awaitingConfirmation',
  });
  const other = m.entryIds.find((x) => x && x !== keeperEntry);
  if (other) {
    const oe = (await db.doc(`entries/${other}`).get()).data() as { captainId: string } | undefined;
    if (oe) {
      await notify({
        userId: oe.captainId,
        title: 'Confirm the match result',
        body: `Scorekeeper posted ${state.margin}. Confirm or dispute within 48h, or it auto-confirms.`,
        deadlineCritical: true,
        link: `/matches/${req.data.matchId}`,
      });
    }
  }
  return { ok: true, margin: state.margin };
});
