/**
 * Payout computation (spec §4/§5/§7 + addendum §3). Purse is a percentage of
 * the prize fund, never a fixed dollar amount. The organizer is never the
 * residual claimant. Integer cents throughout, penny-exact.
 *
 * Addendum §3 rules, all handled here:
 *   - TIES split the combined prize for the tied places evenly. Two players tie
 *     for 1st in a 1st/2nd event → they split (1st + 2nd); 3rd is unaffected.
 *   - The double-dip rule is honored: onePrizePerPlayer means an entry keeps its
 *     biggest prize and smaller prizes cascade down that division's standings.
 *   - Team splitting (even, per member, individual transfers) happens at the
 *     transfer layer in completion.ts — this module assigns per ENTRY.
 *
 * Standings are given per division as ORDERED TIE GROUPS: [["A"],["B","C"],["D"]]
 * means A won, B and C tied for 2nd, D took 4th. A flat string[] is accepted
 * and treated as no ties.
 */
import { splitPurse, type Cents } from './money';

export type Division = 'gross' | 'net';
export interface PayoutRow {
  division: Division;
  place: number;
  sharePercent: number;
}

export interface PayoutAssignment {
  division: Division;
  place: number; // the first place of the tie group this money came from
  entryId: string;
  amountCents: Cents;
}

export type Standings = Record<Division, (string | string[])[]>;

/** Normalize flat entries into tie groups. */
function toGroups(order: (string | string[])[]): string[][] {
  return order.map((x) => (Array.isArray(x) ? x : [x]));
}

/** Even integer split of a pool among n recipients, remainder to the first. */
function evenSplit(poolCents: Cents, n: number): Cents[] {
  const base = Math.floor(poolCents / n);
  const out = Array(n).fill(base);
  out[0] += poolCents - base * n;
  return out;
}

/**
 * @param poolCents     total prize fund (entries × per-entry prize cents)
 * @param payoutTable   published grid; sharePercent values sum to 100
 * @param standings     ordered tie groups per division (winner group first)
 * @param doubleDipRule onePrizePerPlayer | exclusiveDivisions
 */
export function computePayouts(
  poolCents: Cents,
  payoutTable: PayoutRow[],
  standings: Standings,
  doubleDipRule: 'onePrizePerPlayer' | 'exclusiveDivisions',
): PayoutAssignment[] {
  const amounts = splitPurse(
    poolCents,
    payoutTable.map((r) => r.sharePercent),
  );
  const rows = payoutTable.map((r, i) => ({ ...r, amountCents: amounts[i] }));

  const assignments: PayoutAssignment[] = [];
  const paidEntries = new Set<string>();
  let undistributed = 0;

  // Process per division so tie groups consume consecutive places correctly.
  const divisions = [...new Set(rows.map((r) => r.division))];
  for (const division of divisions) {
    const divRows = rows
      .filter((r) => r.division === division)
      .sort((a, b) => a.place - b.place);
    const groups = toGroups(standings[division] ?? []);

    // Walk the standings groups; each group of size k consumes the next k
    // places' prizes and splits their combined value evenly (addendum §3).
    let placeCursor = 1;
    const prizeByPlace = new Map(divRows.map((r) => [r.place, r.amountCents]));
    const placesPaid = new Set<number>();

    for (const group of groups) {
      const groupPlaces = Array.from({ length: group.length }, (_, i) => placeCursor + i);
      const combined = groupPlaces.reduce((a, p) => a + (prizeByPlace.get(p) ?? 0), 0);
      groupPlaces.forEach((p) => placesPaid.add(p));
      placeCursor += group.length;
      if (combined <= 0) continue;

      // Double-dip: drop already-paid entries from the group; their share
      // redistributes to the remaining tied entries, or cascades if none remain.
      const eligible =
        doubleDipRule === 'onePrizePerPlayer'
          ? group.filter((e) => !paidEntries.has(e))
          : group;

      if (eligible.length === 0) {
        // Whole group already paid in the other division — cascade this money to
        // the next unpaid entry in this division's standings.
        const rest = groups.slice(groups.indexOf(group) + 1).flat();
        const next = rest.find((e) => !paidEntries.has(e));
        if (next) {
          paidEntries.add(next);
          assignments.push({ division, place: groupPlaces[0], entryId: next, amountCents: combined });
        } else {
          undistributed += combined;
        }
        continue;
      }

      const split = evenSplit(combined, eligible.length);
      eligible.forEach((entryId, i) => {
        paidEntries.add(entryId);
        assignments.push({ division, place: groupPlaces[0], entryId, amountCents: split[i] });
      });
    }

    // Prize places beyond the field (short field): roll into undistributed.
    for (const r of divRows) {
      if (!placesPaid.has(r.place)) undistributed += r.amountCents;
    }
  }

  if (undistributed > 0 && assignments.length > 0) {
    // Roll leftover money into the single largest assignment — the organizer is
    // never the residual claimant (§4).
    const top = assignments.reduce((a, b) => (b.amountCents > a.amountCents ? b : a));
    top.amountCents += undistributed;
  }
  return assignments;
}
