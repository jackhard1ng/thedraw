/**
 * Money — integer cents only, never a float (spec §3). Server copy of the same
 * math the client uses for display; the server is authoritative for anything
 * that moves money. Balances are always summed from the append-only ledger.
 */
export type Cents = number;

/** Largest-remainder split so the shares sum EXACTLY to the pool — no lost penny. */
export function splitPurse(poolCents: Cents, shares: number[]): Cents[] {
  const raw = shares.map((s) => (poolCents * s) / 100);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = poolCents - floored.reduce((a, b) => a + b, 0);
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

/** Addendum-style cap: the admin fee never exceeds $20 per entry. */
export const MAX_ADMIN_FEE_CENTS_PER_ENTRY = 2000;

/** "$X entry — $Y prize fund, $Z tournament administration" (§7.3). */
export function itemizeEntry(entryFeeCents: Cents, adminFeePercent: number) {
  // Fee = percentage CAPPED per entry: organizing a $500 match is the same
  // work as a $50 match, so the fee stops scaling with the stakes. Cost-based
  // pricing that also keeps the fee reading as a service charge, not a rake.
  const adminCents = Math.min(
    Math.round((entryFeeCents * adminFeePercent) / 100),
    MAX_ADMIN_FEE_CENTS_PER_ENTRY,
  );
  const prizeCents = entryFeeCents - adminCents;
  return { entryFeeCents, prizeCents, adminCents };
}
