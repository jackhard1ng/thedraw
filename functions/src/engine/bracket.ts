/**
 * Bracket engine (spec §4). Single-elimination.
 *
 *   - Seed by combined index, not registration order. Lower index = better =
 *     lower seed number (seed 1 is the best player).
 *   - Byes go to top seeds. Registration order breaks ties only (handled where
 *     seeds are assigned, before this module).
 *
 * Matches use deterministic ids `${tid}_r{round}_m{index}` so advancement is a
 * pure function of position: the winner of r{round}_m{i} goes to
 * r{round+1}_m{floor(i/2)} in slot i%2. Round 1 is the round of `bracketSize`.
 */

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(2, p);
}

export function totalRounds(bracketSize: number): number {
  return Math.round(Math.log2(bracketSize));
}

/**
 * Standard bracket seed order for a bracket of `size` slots. Returns the seed
 * number occupying each slot, so that 1 meets the weakest, and top seeds are
 * spread apart. e.g. size 4 -> [1,4,2,3].
 */
export function seedSlots(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

export interface FirstRoundPairing {
  round: number; // = totalRounds(bracketSize) numbered from 1 at the top? No — see below.
  index: number; // position within round 1
  seedA: number;
  seedB: number;
  entryA: string | null; // null = bye
  entryB: string | null;
}

/**
 * Compute round-1 pairings. `entriesBySeed[0]` is seed 1. A slot whose seed
 * exceeds the field size is a bye (null).
 */
export function firstRoundPairings(entriesBySeed: string[]): FirstRoundPairing[] {
  const n = entriesBySeed.length;
  const size = nextPowerOfTwo(n);
  const slots = seedSlots(size);
  const seedToEntry = (seed: number): string | null =>
    seed <= n ? entriesBySeed[seed - 1] : null;

  const pairings: FirstRoundPairing[] = [];
  for (let i = 0; i < size / 2; i++) {
    const seedA = slots[2 * i];
    const seedB = slots[2 * i + 1];
    pairings.push({
      round: 1,
      index: i,
      seedA,
      seedB,
      entryA: seedToEntry(seedA),
      entryB: seedToEntry(seedB),
    });
  }
  return pairings;
}

/** Where the winner of (round, index) advances to. */
export function advancementTarget(round: number, index: number) {
  return { round: round + 1, index: Math.floor(index / 2), slot: index % 2 };
}
