/**
 * Scheduling + forfeit machinery (spec §5) — fully deterministic (§P1). Every
 * rule produces an outcome when both parties do nothing; no admin decides.
 *
 *   1. Match posts → both captains have 48h to submit 3+ available dates.
 *   2. Failure to submit = automatic forfeit.
 *   3. Both submitted, no overlap → one self-serve extension each (+3 days).
 *   4. Both extensions used, still no overlap → escalate to organizer (rare).
 *
 * These are pure helpers; the scheduled Cloud Function applies them at deadline.
 */
export const AVAILABILITY_WINDOW_HOURS = 48;
export const EXTENSION_DAYS = 3;
export const RESULT_CONFIRM_HOURS = 48;
export const MIN_DATES = 3;

/** Day key in UTC for overlap comparison (market-tz refinement is future work). */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** First common day between two availability lists, or null. */
export function findOverlap(a: number[], b: number[]): number | null {
  const bDays = new Set(b.map(dayKey));
  for (const t of a) if (bDays.has(dayKey(t))) return t;
  return null;
}

export interface AvailabilityEntry {
  entryId: string;
  dates: number[];
}

export type SchedulingOutcome =
  | { kind: 'scheduleReady'; at: number }
  | { kind: 'forfeit'; forfeitedEntryId: string; advancingEntryId: string; reason: string }
  | { kind: 'doubleNonResponse'; advancingEntryId: string; reason: string }
  | { kind: 'noOverlap' }; // needs an extension or escalation, no auto-forfeit

/**
 * Resolve a match at its scheduling deadline. `higherSeedEntryId` is the better
 * seed, used as the deterministic tiebreak when neither side responded.
 */
export function resolveAtDeadline(
  entryIds: [string, string],
  log: AvailabilityEntry[],
  higherSeedEntryId: string,
): SchedulingOutcome {
  const [a, b] = entryIds;
  const subA = log.find((l) => l.entryId === a && l.dates.length >= MIN_DATES);
  const subB = log.find((l) => l.entryId === b && l.dates.length >= MIN_DATES);

  if (subA && subB) {
    const overlap = findOverlap(subA.dates, subB.dates);
    return overlap != null ? { kind: 'scheduleReady', at: overlap } : { kind: 'noOverlap' };
  }
  if (subA && !subB) {
    return { kind: 'forfeit', forfeitedEntryId: b, advancingEntryId: a, reason: 'No availability submitted.' };
  }
  if (!subA && subB) {
    return { kind: 'forfeit', forfeitedEntryId: a, advancingEntryId: b, reason: 'No availability submitted.' };
  }
  // Neither responded → deterministic walkover to the higher seed.
  return {
    kind: 'doubleNonResponse',
    advancingEntryId: higherSeedEntryId,
    reason: 'Neither side submitted availability; higher seed advances.',
  };
}
