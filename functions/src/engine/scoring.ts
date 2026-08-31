/**
 * Match-play result validation. The players are the committee (§4); the server
 * only checks the result is well-formed and internally consistent.
 */
const MARGIN_RE = /^(\d{1,2}&\d{1,2}|\d{1,2}\s?up|1\s?up|19th|sudden death|won)$/i;

export function isValidMargin(margin: string): boolean {
  return typeof margin === 'string' && margin.trim().length > 0 && (MARGIN_RE.test(margin.trim()) || margin.trim().length <= 12);
}

export function loserOf(entryIds: [string, string], winnerEntryId: string): string | null {
  if (winnerEntryId === entryIds[0]) return entryIds[1];
  if (winnerEntryId === entryIds[1]) return entryIds[0];
  return null; // winner not in this match
}
