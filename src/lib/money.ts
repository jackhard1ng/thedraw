/**
 * Money — spec §3 hard rules.
 *
 *   - All money is integer CENTS. Never a float. Never parseFloat on a currency.
 *   - All movements are ledger rows. There is no mutable balance field.
 *
 * These helpers are the only sanctioned way to move between a user-entered
 * dollar string and the integer cents that live in Firestore.
 */
import type { Cents, LedgerRow } from '@/types/models';

/** Parse a user-typed dollar amount ("25", "25.50", "$25") into integer cents. */
export function dollarsToCents(input: string | number): Cents {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('non-finite dollar amount');
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) {
    throw new Error(`invalid dollar amount: ${input}`);
  }
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return cents;
}

/** Render integer cents for display, e.g. 2250 -> "$22.50". */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Split a purse across a payout table, integer-cents safe. The largest-remainder
 * method keeps the sum exactly equal to the pool — no penny is invented or lost.
 */
export function splitPurse(
  poolCents: Cents,
  shares: number[], // sharePercent values, expected to sum to 100
): Cents[] {
  const raw = shares.map((s) => (poolCents * s) / 100);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = poolCents - floored.reduce((a, b) => a + b, 0);
  // hand out leftover pennies to the largest fractional parts, biggest first
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

/**
 * The admin-fee itemization required by §7.3 — always disclosed at the point of
 * payment as "$X entry — $Y prize fund, $Z tournament administration".
 */
export function itemizeEntry(entryFeeCents: Cents, adminFeePercent: number) {
  const adminCents = Math.round((entryFeeCents * adminFeePercent) / 100);
  const prizeCents = entryFeeCents - adminCents;
  return {
    entryFeeCents,
    prizeCents,
    adminCents,
    line: `${formatCents(entryFeeCents)} entry — ${formatCents(
      prizeCents,
    )} prize fund, ${formatCents(adminCents)} tournament administration`,
  };
}

/** Sum ledger rows for a user — this is how a "balance" is ever computed (§3). */
export function balanceForUser(rows: LedgerRow[], userId: string): Cents {
  return rows.reduce((acc, r) => {
    if (r.toUserId === userId) return acc + r.amountCents;
    if (r.fromUserId === userId) return acc - r.amountCents;
    return acc;
  }, 0);
}
