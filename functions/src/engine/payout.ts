/**
 * Payout computation (spec §4/§5/§7). Purse is a percentage of the prize fund,
 * never a fixed dollar amount. The organizer is never the residual claimant.
 *
 * Integer cents throughout, penny-exact via largest-remainder splitPurse. The
 * double-dip rule is honored: onePrizePerPlayer means an entry keeps its biggest
 * prize and smaller prizes cascade down that division's standings to the next
 * unpaid entry.
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
  place: number;
  entryId: string;
  amountCents: Cents;
}

/**
 * @param poolCents        total prize fund (entries × per-entry prize cents)
 * @param payoutTable      published grid; sharePercent values sum to 100
 * @param standings        ordered entryIds per division (winner first)
 * @param doubleDipRule    onePrizePerPlayer | exclusiveDivisions
 */
export function computePayouts(
  poolCents: Cents,
  payoutTable: PayoutRow[],
  standings: Record<Division, string[]>,
  doubleDipRule: 'onePrizePerPlayer' | 'exclusiveDivisions',
): PayoutAssignment[] {
  const amounts = splitPurse(
    poolCents,
    payoutTable.map((r) => r.sharePercent),
  );
  // Pair each row with its cents amount, biggest first so the "keep the higher
  // prize" rule falls out of the iteration order.
  const rows = payoutTable
    .map((r, i) => ({ ...r, amountCents: amounts[i] }))
    .sort((a, b) => b.amountCents - a.amountCents);

  const paidEntries = new Set<string>();
  const assignments: PayoutAssignment[] = [];
  let undistributed = 0;

  for (const row of rows) {
    const order = standings[row.division] ?? [];
    let entryId: string | undefined = order[row.place - 1];

    if (doubleDipRule === 'onePrizePerPlayer' && entryId && paidEntries.has(entryId)) {
      // Cascade down this division to the next entry that hasn't been paid.
      entryId = order.slice(row.place - 1).find((e) => !paidEntries.has(e));
    }

    if (!entryId) {
      // Field shorter than the payout grid — roll this money into the top prize.
      undistributed += row.amountCents;
      continue;
    }
    paidEntries.add(entryId);
    assignments.push({
      division: row.division,
      place: row.place,
      entryId,
      amountCents: row.amountCents,
    });
  }

  if (undistributed > 0 && assignments.length > 0) {
    assignments[0].amountCents += undistributed;
  }
  return assignments;
}
