/**
 * Tournament completion (spec §4/§5/§7). Computes final standings, writes the
 * append-only awards (placements, not just wins), and pays out from the FROZEN
 * payout table — percentage of the prize fund, integer cents, straight to the
 * winner's own connected account. The platform holds nothing overnight (§P6).
 *
 * Brackets become immutable on completion; the trophy links to the frozen draw.
 */
import { db, FieldValue, Timestamp, getPrivate, writeLedger } from './shared';
import { computePayouts, type PayoutRow, type Standings } from './engine/payout';
import { itemizeEntry } from './engine/money';
import { payout as stripePayout, stripeEnabled } from './lib/stripe';
import { rankPod } from './engine/pods';
import { notify } from './lib/notify';

/** Addendum §1: minimum admin fee of $10 per event. */
export const MIN_EVENT_ADMIN_FEE_CENTS = 1000;

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

  let standings: Standings = { gross: [], net: [] };
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

  // --- Payout math first, so awards can carry each member's real share ------
  // memberShare: `${entryId}:${uid}` → cents. Empty for free events.
  const memberShare = new Map<string, number>();
  let assignments: { entryId: string; amountCents: number; division: string; place: number }[] = [];
  const isCash = t.entryFeeCents > 0 && t.prizeType === 'cashPurse';
  if (isCash) {
    const activeCount = entries.filter((e) => e.status !== 'withdrawn').length;
    const { adminCents } = itemizeEntry(t.entryFeeCents, t.adminFeePercent);
    const collected = t.entryFeeCents * activeCount;
    const adminT =
      t.adminFeePercent > 0
        ? Math.max(adminCents * activeCount, MIN_EVENT_ADMIN_FEE_CENTS)
        : 0;
    const pool = Math.max(0, collected - adminT);
    assignments = computePayouts(pool, t.payoutTable as PayoutRow[], standings, t.doubleDipRule);
    for (const a of assignments) {
      const e = entries.find((x) => x.id === a.entryId);
      if (!e) continue;
      // Addendum §3: team prizes split EVENLY and paid INDIVIDUALLY.
      const base = Math.floor(a.amountCents / e.userIds.length);
      e.userIds.forEach((u, i) =>
        memberShare.set(
          `${a.entryId}:${u}`,
          (memberShare.get(`${a.entryId}:${u}`) ?? 0) +
            (i === 0 ? a.amountCents - base * (e.userIds.length - 1) : base),
        ),
      );
    }
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
        // The member's own dollar share (ties and team splits already applied),
        // so "champion · $162" needs no reconciliation against the payout grid.
        amountCents: memberShare.get(`${a.entryId}:${u}`) ?? null,
        awardedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // --- Payouts (only for cash-purse events) ---
  if (isCash) {
    const activeCount = entries.filter((e) => e.status !== 'withdrawn').length;
    const { adminCents } = itemizeEntry(t.entryFeeCents, t.adminFeePercent);
    // Addendum §1: minimum admin fee of $10 PER EVENT so a tiny field doesn't
    // cost more in Stripe fees than it collects. If the percentage fee across
    // the field falls short, the shortfall comes out of the pool.
    const collectedCents = t.entryFeeCents * activeCount;
    // The $10 floor only applies when a fee is configured at all — a 0%
    // event (launch promo, at-cost season) is genuinely free of platform fees.
    const adminTotal =
      t.adminFeePercent > 0
        ? Math.max(adminCents * activeCount, MIN_EVENT_ADMIN_FEE_CENTS)
        : 0;
    // (The prize pool itself was computed above, before awards were written.)

    // City-organizer revenue share (spec Phase 5): the market's organizer —
    // the human doing the regulation labor (verifying handicaps, resolving
    // disputes, recruiting courses) — earns a percentage of EVERY admin fee in
    // their market, including instant events they never touched. This is the
    // franchise incentive that lets city #4 run without Jack. The event
    // CREATOR never shares in the fee (§7.4 stays intact).
    const market = (await db.doc(`markets/${t.marketId}`).get()).data() as
      | { marketOrganizerId?: string | null; organizerSharePercent?: number }
      | undefined;
    if (market?.marketOrganizerId && (market.organizerSharePercent ?? 0) > 0) {
      // Share is computed on the fee NET of card processing (~2.9% + 30¢ per
      // entry) — on a capped-fee $500 head-to-head the processing eats most of
      // the $40 fee, and sharing the gross would put the platform underwater.
      const processingCents = Math.round(collectedCents * 0.029) + 30 * activeCount;
      const orgBase = Math.max(0, adminTotal - processingCents);
      const orgCut = Math.round((orgBase * market.organizerSharePercent!) / 100);
      if (orgCut > 0) {
        const orgPriv = await getPrivate(market.marketOrganizerId);
        let stripeRef = 'pending-onboarding';
        if (stripeEnabled() && orgPriv.stripeConnectId) {
          try {
            const tr = await stripePayout({ amountCents: orgCut, destinationConnectId: orgPriv.stripeConnectId, tournamentId, toUserId: market.marketOrganizerId });
            stripeRef = tr.id;
          } catch (err) {
            console.error(`organizer share failed: ${(err as Error).message}`);
          }
        }
        await writeLedger({ type: 'adminFee', amountCents: orgCut, fromUserId: null, toUserId: market.marketOrganizerId, tournamentId, matchId: null, stripeRef, note: `market organizer share (${market.organizerSharePercent}% of admin)` });
      }
    }
    for (const a of assignments) {
      const e = entries.find((x) => x.id === a.entryId);
      if (!e) continue;
      const members = e.userIds;
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const share = memberShare.get(`${a.entryId}:${member}`) ?? 0;
        if (share <= 0) continue;
        const dollars = `$${(share / 100).toFixed(2)}`;
        const memberPriv = await getPrivate(member);
        let stripeRef = 'pending-onboarding';
        if (stripeEnabled() && memberPriv.stripeConnectId) {
          try {
            const tr = await stripePayout({ amountCents: share, destinationConnectId: memberPriv.stripeConnectId, tournamentId, toUserId: member });
            stripeRef = tr.id;
            await notify({
              userId: member,
              title: `You won ${dollars}`,
              body: `${t.name}: your prize is on its way to your bank. The Draw holds nothing.`,
              deadlineCritical: true,
              link: '/me',
            });
          } catch (err) {
            // Connect account exists but can't receive yet (onboarding
            // unfinished). The row stays pending; the hourly settle sweep
            // retries until it lands — and the winner is told what to do.
            console.error(`payout failed for ${member}: ${(err as Error).message}`);
            await notify({
              userId: member,
              title: `You won ${dollars} — action needed`,
              body: `${t.name}: finish payout setup to receive your prize. It retries automatically once you're set up.`,
              deadlineCritical: true,
              link: '/payouts',
            });
          }
        } else {
          await notify({
            userId: member,
            title: `You won ${dollars} — set up payouts`,
            body: `${t.name}: set up payouts to receive your prize. It pays out automatically once you're set up. The Draw never holds your money.`,
            deadlineCritical: true,
            link: '/payouts',
          });
        }
        await writeLedger({ type: 'payout', amountCents: share, fromUserId: null, toUserId: member, tournamentId, matchId: null, stripeRef, note: `${a.division} place ${a.place}${members.length > 1 ? ` (team split ${i + 1}/${members.length})` : ''}` });
      }
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

  const standings: Standings = {
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
  return { standings: { gross: winners, net: [] } as Standings, awards };
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

  // Group equal totals into tie groups (addendum §3: ties split the combined
  // prize for the tied places evenly).
  const toTieGroups = (byEntry: Map<string, number>): string[][] => {
    const sorted = [...byEntry.entries()].sort((a, b) => a[1] - b[1]);
    const groups: string[][] = [];
    for (const [id, total] of sorted) {
      const last = groups[groups.length - 1];
      if (last && byEntry.get(last[0]) === total) last.push(id);
      else groups.push([id]);
    }
    return groups;
  };

  const grossGroups = toTieGroups(grossByEntry);
  const netGroups = anyNet ? toTieGroups(netByEntry) : [];

  const awards: { entryId: string; placement: string; flight: string | null; path: any[] }[] = [];
  const placeName = ['champion', 'runnerUp', 'semifinalist'];
  // Everyone in a tied group gets the placement for the group's first place.
  let place = 0;
  for (const group of grossGroups) {
    if (place >= 3) break;
    for (const id of group) awards.push({ entryId: id, placement: placeName[Math.min(place, 2)], flight: 'gross', path: [] });
    place += group.length;
  }
  if (netGroups.length) {
    for (const id of netGroups[0]) awards.push({ entryId: id, placement: 'flightWinner', flight: 'net', path: [] });
  }

  return { standings: { gross: grossGroups, net: netGroups } as Standings, awards };
}
