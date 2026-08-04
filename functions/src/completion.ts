/**
 * Tournament completion (spec §4/§5/§7). Computes final standings, writes the
 * append-only awards (placements, not just wins), and pays out from the FROZEN
 * payout table — percentage of the prize fund, integer cents, straight to the
 * winner's own connected account. The platform holds nothing overnight (§P6).
 *
 * Brackets become immutable on completion; the trophy links to the frozen draw.
 */
import { db, FieldValue, Timestamp, writeLedger } from './shared';
import { computePayouts, type Division, type PayoutRow } from './engine/payout';
import { itemizeEntry } from './engine/money';
import { payout as stripePayout, stripeEnabled } from './lib/stripe';
import { rankPod } from './engine/pods';
import { notify } from './lib/notify';

interface EntryLite {
  id: string;
  userIds: string[];
  teamId: string | null;
  teamName: string | null;
  combinedIndex: number;
  seed: number;
  status: string;
}

async function entryName(e: EntryLite): Promise<string> {
  if (e.teamName) return e.teamName;
  const names = await Promise.all(
    e.userIds.map(async (u) => {
      const d = (await db.doc(`users/${u}`).get()).data() as { displayName?: string } | undefined;
      return d?.displayName ?? 'Player';
    }),
  );
  return names.join(' / ');
}

function seasonLabel(closeMs: number): string {
  const d = new Date(closeMs);
  const month = d.getUTCMonth();
  const part = month >= 6 ? 'Fall' : 'Spring';
  return `${d.getUTCFullYear()} ${part}`;
}

/** Decide whether a tournament is finished and, if so, finalize it. */
export async function maybeCompleteTournament(tournamentId: string) {
  const tRef = db.doc(`tournaments/${tournamentId}`);
  const t = (await tRef.get()).data() as any;
  if (!t || t.status !== 'inProgress') return;

  const format = (await db.doc(`formats/${t.formatId}`).get()).data() as any;
  const entriesSnap = await db.collection('entries').where('tournamentId', '==', tournamentId).get();
  const entries: EntryLite[] = entriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  let standings: Record<Division, string[]> = { gross: [], net: [] };
  const awardsToWrite: { entryId: string; placement: string; flight: string | null; path: any[] }[] = [];

  if (format?.scoring === 'matchPlay') {
    const done = await completeBracket(tournamentId, t.bracketRounds, entries);
    if (!done) return; // final not in yet
    standings = done.standings;
    awardsToWrite.push(...done.awards);
  } else if (t.structure === 'pods' || format?.advancement === 'roundRobin') {
    const done = await completePods(tournamentId, entries);
    if (!done) return;
    standings = done.standings;
    awardsToWrite.push(...done.awards);
  } else {
    const done = await completeStrokePlay(tournamentId, entries, format?.rounds ?? 1);
    if (!done) return;
    standings = done.standings;
    awardsToWrite.push(...done.awards);
  }

  // --- Awards (append-only) ---
  const season = seasonLabel((t.registrationCloses as Timestamp).toMillis());
  for (const a of awardsToWrite) {
    const e = entries.find((x) => x.id === a.entryId)!;
    for (const u of e.userIds) {
      await db.collection('awards').add({
        userId: u,
        teamId: e.teamId,
        partnerId: e.userIds.find((x) => x !== u) ?? null,
        tournamentId,
        tournamentName: t.name,
        season,
        flight: a.flight,
        placement: a.placement,
        path: a.path,
        awardedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // --- Payouts (only for cash-purse events) ---
  if (t.entryFeeCents > 0 && t.prizeType === 'cashPurse') {
    const { prizeCents } = itemizeEntry(t.entryFeeCents, t.adminFeePercent);
    const poolCents = prizeCents * entries.filter((e) => e.status !== 'withdrawn').length;
    const assignments = computePayouts(poolCents, t.payoutTable as PayoutRow[], standings, t.doubleDipRule);
    for (const a of assignments) {
      const e = entries.find((x) => x.id === a.entryId);
      if (!e) continue;
      const captain = e.userIds[0];
      const user = (await db.doc(`users/${captain}`).get()).data() as { stripeConnectId: string | null } | undefined;
      let stripeRef = 'pending-onboarding';
      if (stripeEnabled() && user?.stripeConnectId) {
        try {
          const tr = await stripePayout({ amountCents: a.amountCents, destinationConnectId: user.stripeConnectId, tournamentId, toUserId: captain });
          stripeRef = tr.id;
        } catch (err) {
          console.error(`payout failed for ${captain}: ${(err as Error).message}`);
        }
      } else {
        await notify({ userId: captain, title: 'You won — set up payouts', body: 'Set up payouts to receive your prize. The Draw never holds your money.', deadlineCritical: true, link: '/me/payouts' });
      }
      await writeLedger({ type: 'payout', amountCents: a.amountCents, fromUserId: null, toUserId: captain, tournamentId, matchId: null, stripeRef, note: `${a.division} place ${a.place}` });
    }
  }

  await tRef.update({ status: 'complete' });
}

// --- bracket ---------------------------------------------------------------
async function completeBracket(tournamentId: string, bracketRounds: number, entries: EntryLite[]) {
  const finalId = `${tournamentId}_r${bracketRounds}_m0`;
  const finalSnap = await db.doc(`matches/${finalId}`).get();
  const fin = finalSnap.data() as any;
  if (!fin || fin.status !== 'complete' || !fin.result?.winnerEntryId) return null;

  const matchesSnap = await db.collection('matches').where('tournamentId', '==', tournamentId).get();
  const matches = matchesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const bySeed = (id: string) => entries.find((e) => e.id === id)?.seed ?? 999;

  const champion = fin.result.winnerEntryId as string;
  const runnerUp = fin.entryIds.find((e: string) => e && e !== champion) as string;

  // Losers by round → placement by depth.
  const losersInRound = (round: number) =>
    matches
      .filter((m) => m.round === round && m.status === 'complete' && m.result?.winnerEntryId)
      .map((m) => m.entryIds.find((e: string) => e && e !== m.result.winnerEntryId) as string)
      .filter(Boolean)
      .sort((a, b) => bySeed(a) - bySeed(b));

  const awards: { entryId: string; placement: string; flight: string | null; path: any[] }[] = [];
  const pathFor = async (entryId: string) => {
    const wins = matches
      .filter((m) => m.result?.winnerEntryId === entryId)
      .sort((a, b) => a.round - b.round);
    return Promise.all(
      wins.map(async (m) => {
        const opp = m.entryIds.find((e: string) => e && e !== entryId) as string;
        const oe = entries.find((x) => x.id === opp);
        return { round: m.round, opponentName: oe ? await entryName(oe) : 'Bye', result: m.result?.margin ?? '' };
      }),
    );
  };

  awards.push({ entryId: champion, placement: 'champion', flight: null, path: await pathFor(champion) });
  awards.push({ entryId: runnerUp, placement: 'runnerUp', flight: null, path: await pathFor(runnerUp) });
  if (bracketRounds >= 2) for (const e of losersInRound(bracketRounds - 1)) awards.push({ entryId: e, placement: 'semifinalist', flight: null, path: await pathFor(e) });
  if (bracketRounds >= 3) for (const e of losersInRound(bracketRounds - 2)) awards.push({ entryId: e, placement: 'quarterfinalist', flight: null, path: await pathFor(e) });

  const standings: Record<Division, string[]> = {
    gross: [champion, runnerUp, ...losersInRound(bracketRounds - 1)],
    net: [],
  };
  return { standings, awards };
}

// --- pods ------------------------------------------------------------------
async function completePods(tournamentId: string, entries: EntryLite[]) {
  const matchesSnap = await db.collection('matches').where('tournamentId', '==', tournamentId).get();
  const matches = matchesSnap.docs.map((d) => d.data() as any);
  if (matches.some((m) => m.status !== 'complete' && m.status !== 'forfeited' && m.status !== 'voidedWeather')) {
    return null; // not every pod match is in yet
  }
  const podIndexes = [...new Set(matches.map((m) => m.podIndex))].filter((p) => p !== undefined) as number[];
  const winners: string[] = [];
  const awards: { entryId: string; placement: string; flight: string | null; path: any[] }[] = [];
  for (const pi of podIndexes) {
    const podMatches = matches.filter((m) => m.podIndex === pi);
    const pod = [...new Set(podMatches.flatMap((m) => m.entryIds))].filter(Boolean) as string[];
    const results = podMatches
      .filter((m) => m.result?.winnerEntryId)
      .map((m) => ({ winnerEntryId: m.result.winnerEntryId, loserEntryId: m.entryIds.find((e: string) => e !== m.result.winnerEntryId) }));
    const ranked = rankPod(pod, results);
    if (ranked[0]) {
      winners.push(ranked[0].entryId);
      awards.push({ entryId: ranked[0].entryId, placement: 'podWinner', flight: `Pod ${pi + 1}`, path: [] });
    }
  }
  return { standings: { gross: winners, net: [] } as Record<Division, string[]>, awards };
}

// --- stroke play -----------------------------------------------------------
async function completeStrokePlay(tournamentId: string, entries: EntryLite[], rounds: number) {
  const scSnap = await db.collection('scorecards').where('tournamentId', '==', tournamentId).get();
  const cards = scSnap.docs.map((d) => d.data() as any);
  const expected = entries.filter((e) => e.status !== 'withdrawn').length * rounds;
  const complete = cards.filter((c) => c.status === 'complete');
  if (complete.length < expected) return null; // still waiting on scorecards

  const grossByEntry = new Map<string, number>();
  const netByEntry = new Map<string, number>();
  let anyNet = false;
  for (const e of entries) {
    const mine = complete.filter((c) => c.entryId === e.id);
    if (mine.length === 0) continue;
    grossByEntry.set(e.id, mine.reduce((a, c) => a + c.gross, 0));
    if (mine.every((c) => c.net != null)) {
      anyNet = true;
      netByEntry.set(e.id, mine.reduce((a, c) => a + (c.net as number), 0));
    }
  }

  const grossOrder = [...grossByEntry.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const netOrder = anyNet ? [...netByEntry.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id) : [];

  const awards: { entryId: string; placement: string; flight: string | null; path: any[] }[] = [];
  const placeName = ['champion', 'runnerUp', 'semifinalist'];
  grossOrder.slice(0, 3).forEach((id, i) => awards.push({ entryId: id, placement: placeName[i], flight: 'gross', path: [] }));
  if (netOrder.length) netOrder.slice(0, 1).forEach((id) => awards.push({ entryId: id, placement: 'flightWinner', flight: 'net', path: [] }));

  return { standings: { gross: grossOrder, net: netOrder } as Record<Division, string[]>, awards };
}
