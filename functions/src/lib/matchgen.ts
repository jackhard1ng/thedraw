/**
 * Match generation + bracket advancement. Deterministic match ids make
 * advancement a pure function of position (see engine/bracket.ts).
 *
 *   bracket match id: `${tid}_r{round}_m{index}`
 *   pod match id:     `${tid}_p{pod}_m{index}`
 *
 * Empty bracket slots are the empty string until a winner advances into them.
 */
import { addThreadMembers, db, FieldValue, Timestamp } from '../shared';
import { firstRoundPairings, advancementTarget, nextPowerOfTwo, totalRounds } from '../engine/bracket';
import { podPairings } from '../engine/pods';
import { notify } from './notify';

function deadline(days: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + days * 86_400_000);
}

interface NewMatch {
  id: string;
  tournamentId: string;
  round: number;
  podIndex?: number;
  entryIds: [string, string];
  scheduling: {
    deadline: Timestamp | null;
    availabilityLog: [];
    extensionsUsed: Record<string, boolean>;
    agreedTime: Timestamp | null;
    placeId: string | null;
    bookedBy: string | null;
  };
  result: {
    submittedBy: null;
    submittedAt: null;
    winnerEntryId: null;
    margin: null;
    holes: null;
    confirmedBy: null;
    confirmedAt: null;
    disputed: false;
    scorecardPhotoUrl: null;
  };
  status: string;
  forfeitedBy: null;
  forfeitReason: null;
}

function blankMatch(id: string, tid: string, round: number, entryIds: [string, string]): NewMatch {
  const bothPresent = entryIds[0] !== '' && entryIds[1] !== '';
  return {
    id,
    tournamentId: tid,
    round,
    entryIds,
    scheduling: {
      deadline: bothPresent ? deadline(2) : null, // 48h availability window opens when paired
      availabilityLog: [],
      extensionsUsed: {},
      agreedTime: null,
      placeId: null,
      bookedBy: null,
    },
    result: {
      submittedBy: null,
      submittedAt: null,
      winnerEntryId: null,
      margin: null,
      holes: null,
      confirmedBy: null,
      confirmedAt: null,
      disputed: false,
      scorecardPhotoUrl: null,
    },
    status: bothPresent ? 'scheduling' : 'pendingOpponent',
    forfeitedBy: null,
    forfeitReason: null,
  };
}

/** Everyone on either entry becomes a member of the match's chat thread. */
async function syncMatchThread(matchId: string, entryIds: [string, string]) {
  const uids: string[] = [];
  for (const eid of entryIds) {
    if (!eid) continue;
    const e = (await db.doc(`entries/${eid}`).get()).data() as { userIds?: string[] } | undefined;
    uids.push(...(e?.userIds ?? []));
  }
  await addThreadMembers(matchId, uids);
}

/** Generate a single-elimination bracket. Byes auto-advance to round 2. */
export async function createBracketMatches(tid: string, entriesBySeed: string[]) {
  const pairings = firstRoundPairings(entriesBySeed);
  const batch = db.batch();
  const byeAdvances: { round: number; index: number; slot: number; entryId: string }[] = [];
  const threadSyncs: { id: string; entryIds: [string, string] }[] = [];

  for (const p of pairings) {
    const bothReal = p.entryA && p.entryB;
    if (bothReal) {
      const id = `${tid}_r1_m${p.index}`;
      batch.set(db.doc(`matches/${id}`), blankMatch(id, tid, 1, [p.entryA!, p.entryB!]));
      threadSyncs.push({ id, entryIds: [p.entryA!, p.entryB!] });
    } else {
      // exactly one real entry (the top seed of the pair) gets a bye to round 2
      const winner = (p.entryA ?? p.entryB)!;
      const t = advancementTarget(1, p.index);
      byeAdvances.push({ ...t, entryId: winner });
    }
  }
  await batch.commit();
  for (const s of threadSyncs) await syncMatchThread(s.id, s.entryIds);

  // Place byes into round 2 (creating those matches as needed).
  for (const b of byeAdvances) {
    await placeIntoSlot(tid, b.round, b.index, b.slot, b.entryId);
  }

  return { bracketRounds: totalRounds(nextPowerOfTwo(entriesBySeed.length)) };
}

/** Round-robin pods (each pod is independent). */
export async function createPodMatches(tid: string, pods: string[][]) {
  const batch = db.batch();
  const threadSyncs: { id: string; entryIds: [string, string] }[] = [];
  pods.forEach((pod, podIndex) => {
    for (const pair of podPairings(pod, podIndex)) {
      const id = `${tid}_p${podIndex}_m${pair.index}`;
      const m = blankMatch(id, tid, 1, [pair.entryA, pair.entryB]);
      m.podIndex = podIndex;
      batch.set(db.doc(`matches/${id}`), m);
      threadSyncs.push({ id, entryIds: [pair.entryA, pair.entryB] });
    }
  });
  await batch.commit();
  for (const s of threadSyncs) await syncMatchThread(s.id, s.entryIds);
}

/**
 * Handicap allowance spec, straight off the format doc:
 *   { percent }                       — flat % of the entry's (combined) index
 *   { type:'scramble2', low, high }   — USGA-style 2-man scramble: low% of the
 *                                       BETTER player's course handicap plus
 *                                       high% of the other's. Computed from the
 *                                       two REAL indexes — a 6+7 team and a
 *                                       1+12 team both "add to 13" but are
 *                                       nothing alike, so the sum is never used.
 *   { type:'none' } / null            — gross, no strokes ever.
 */
export type AllowanceSpec =
  | { percent: number }
  | { type: 'scramble2'; low: number; high: number }
  | { type: 'none' }
  | null;

function playingHandicap(
  spec: AllowanceSpec,
  entry: { combinedIndex: number; indexes?: number[] },
  tee: { slope: number; rating: number; par: number },
): number | null {
  if (!spec || ('type' in spec && spec.type === 'none')) return null;
  const ch = (index: number) => index * (tee.slope / 113) + (tee.rating - tee.par);
  if ('percent' in spec) {
    return Math.round(ch(entry.combinedIndex) * spec.percent);
  }
  if (spec.type === 'scramble2') {
    // Legacy entries may lack per-player indexes; splitting the sum evenly is
    // the least-wrong fallback (never silently gross).
    const pair =
      entry.indexes && entry.indexes.length === 2
        ? [...entry.indexes].sort((a, b) => a - b)
        : [entry.combinedIndex / 2, entry.combinedIndex / 2];
    return Math.round(spec.low * ch(pair[0]) + spec.high * ch(pair[1]));
  }
  return null;
}

/**
 * Stroke-play scorecards: one per entry per round, awaiting the player's score.
 *
 * The stroke rule is FROZEN here, at draw time (§4): for a net-scored format,
 * each card gets a playing handicap computed from the entry's frozen indexes
 * and the DESIGNATED course's tee data (see AllowanceSpec above).
 *
 * A gross format (allowance null/'none') freezes courseHandicap at null — no
 * strokes, ever, and the UI states it. Net requires a supported course with
 * tee data; a listed course leaves courseHandicap null, gross-only.
 *
 * `dueAt` arms the DNF sweep (§P1): a card still awaiting its result after the
 * round deadline is closed out by the scheduler so one absent player can never
 * freeze an event's completion.
 */
export async function createScorecards(
  tid: string,
  entries: { id: string; userIds: string[]; combinedIndex: number; indexes?: number[] }[],
  rounds: number,
  designatedCourses: string[],
  allowance: AllowanceSpec | number | null, // number = legacy flat percent
  roundDeadlineDays = 7,
) {
  const spec: AllowanceSpec =
    typeof allowance === 'number' ? { percent: allowance } : allowance;
  const scored = spec != null && !('type' in spec && spec.type === 'none');

  // Resolve tee data per designated course once.
  const teeByRound: ({ slope: number; rating: number; par: number } | null)[] = [];
  for (let r = 1; r <= rounds; r++) {
    const placeId = designatedCourses[r - 1];
    let tee: { slope: number; rating: number; par: number } | null = null;
    if (placeId && scored) {
      const course = (await db.doc(`courses/${placeId}`).get()).data() as
        | { tier: string; teeSets: { slope: number; rating: number; par: number }[] | null }
        | undefined;
      if (course?.tier === 'supported' && course.teeSets?.length) {
        tee = course.teeSets[0];
      }
    }
    teeByRound.push(tee);
  }

  const batch = db.batch();
  for (const e of entries) {
    for (let r = 1; r <= rounds; r++) {
      const tee = teeByRound[r - 1];
      const courseHandicap = tee ? playingHandicap(spec, e, tee) : null;
      const id = `${tid}_${e.id}_${r}`;
      batch.set(db.doc(`scorecards/${id}`), {
        tournamentId: tid,
        entryId: e.id,
        userId: e.userIds[0],
        round: r,
        placeId: designatedCourses[r - 1] ?? '',
        gross: 0,
        courseHandicap, // frozen now — never recomputed (§4)
        net: null, // gross − courseHandicap, filled on submission
        holes: null,
        submittedBy: null,
        confirmedBy: null,
        confirmDeadline: null,
        dueAt: Timestamp.fromMillis(Date.now() + roundDeadlineDays * r * 86_400_000),
        scorecardPhotoUrl: null,
        status: 'awaitingResult',
      });
    }
  }
  await batch.commit();
}

/** Advance a winner into the next bracket slot, creating the match if needed. */
export async function advanceWinner(tid: string, fromRound: number, fromIndex: number, winnerEntryId: string) {
  const t = advancementTarget(fromRound, fromIndex);
  await placeIntoSlot(tid, t.round, t.index, t.slot, winnerEntryId);
}

async function placeIntoSlot(tid: string, round: number, index: number, slot: number, entryId: string) {
  const id = `${tid}_r${round}_m${index}`;
  const ref = db.doc(`matches/${id}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const entryIds: [string, string] = slot === 0 ? [entryId, ''] : ['', entryId];
      tx.set(ref, blankMatch(id, tid, round, entryIds));
      return;
    }
    const m = snap.data() as NewMatch;
    const entryIds: [string, string] = [...m.entryIds] as [string, string];
    entryIds[slot] = entryId;
    const bothPresent = entryIds[0] !== '' && entryIds[1] !== '';
    tx.update(ref, {
      entryIds,
      status: bothPresent ? 'scheduling' : 'pendingOpponent',
      'scheduling.deadline': bothPresent ? Timestamp.fromMillis(Date.now() + 2 * 86_400_000) : null,
    });
  });

  await syncMatchThread(id, [entryId, ''] as [string, string]);

  // A newly-formed pairing quietly starts a 48h forfeit clock — winning round 1
  // must never be how you lose round 2. Tell both sides the moment the
  // matchup exists (§P1: every deadline announces itself).
  const after = (await ref.get()).data() as (NewMatch & { pairNoticeSent?: boolean }) | undefined;
  if (!after || after.status !== 'scheduling' || after.pairNoticeSent) return;
  await ref.update({ pairNoticeSent: true });
  const entryDocs = await Promise.all(
    after.entryIds.map(async (eid) =>
      eid ? ((await db.doc(`entries/${eid}`).get()).data() as { userIds: string[]; displayNames?: string[]; teamName: string | null } | undefined) : undefined,
    ),
  );
  const nameOf = (i: number) =>
    entryDocs[i]?.teamName || entryDocs[i]?.displayNames?.join(' / ') || 'your opponent';
  for (let i = 0; i < 2; i++) {
    const e = entryDocs[i];
    if (!e) continue;
    for (const u of e.userIds) {
      await notify({
        userId: u,
        title: `Round ${round}: you play ${nameOf(1 - i)}`,
        body: 'Your next match is live. Post your availability within 48 hours — silence forfeits.',
        deadlineCritical: true,
        link: `/matches/${id}`,
      });
    }
  }
}

export { FieldValue };
