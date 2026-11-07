/**
 * Net match-play running state, for the LIVE match card ("A 2 up thru 7"). Pure
 * display math — a mirror of functions/src/engine/scoring.ts. The server stays
 * authoritative when the scorekeeper finishes (finalizeMatchScores); this just
 * lets watchers follow along.
 */
export function strokeAllocation(
  chDiff: number,
  holeHandicapOrder: number[] | null,
  totalHoles: number,
): number[] {
  const alloc = new Array(totalHoles).fill(0);
  if (chDiff <= 0) return alloc;
  const order =
    holeHandicapOrder && holeHandicapOrder.length >= totalHoles
      ? Array.from({ length: totalHoles }, (_, i) => i).sort(
          (a, b) => holeHandicapOrder[a] - holeHandicapOrder[b],
        )
      : Array.from({ length: totalHoles }, (_, i) => i);
  for (let s = 0; s < chDiff; s++) alloc[order[s % totalHoles]] += 1;
  return alloc;
}

export interface MatchState {
  up: number; // from entryIds[0]'s perspective
  thru: number;
  decided: boolean;
  winnerEntryId: string | null;
  margin: string | null;
  allSquareAfterRegulation: boolean;
}

export function netMatchState(
  holeScores: { hole: number; scores: Record<string, number> }[],
  entryIds: [string, string],
  chByEntry: Record<string, number>,
  holeHandicapOrder: number[] | null,
  totalHoles: number,
): MatchState {
  const [a, b] = entryIds;
  // Strokes = the index difference SCALED to the round: the full difference
  // over 18, half of it over 9 (a 9-hole course handicap is ~half an 18's).
  const chDiff = Math.round((Math.abs((chByEntry[a] ?? 0) - (chByEntry[b] ?? 0)) * totalHoles) / 18);
  const receiver = (chByEntry[a] ?? 0) > (chByEntry[b] ?? 0) ? a : b;
  const alloc = strokeAllocation(chDiff, holeHandicapOrder, totalHoles);
  const holeWinner = (h: { hole: number; scores: Record<string, number> }): 'a' | 'b' | 'halved' | null => {
    const ga = h.scores[a];
    const gb = h.scores[b];
    if (ga == null || gb == null) return null;
    const st = alloc[(h.hole - 1) % totalHoles] ?? 0; // extra holes reuse the stroke index
    const na = ga - (receiver === a ? st : 0);
    const nb = gb - (receiver === b ? st : 0);
    return na < nb ? 'a' : nb < na ? 'b' : 'halved';
  };

  const sorted = [...holeScores].sort((x, y) => x.hole - y.hole);
  const regulation = sorted.filter((h) => h.hole <= totalHoles);
  let up = 0; // A perspective
  let thru = 0;
  for (const h of regulation) {
    const w = holeWinner(h);
    if (w == null) continue;
    thru += 1;
    if (w === 'a') up += 1;
    else if (w === 'b') up -= 1;
  }
  const remaining = totalHoles - thru;
  const lead = Math.abs(up);
  const decided = remaining >= 0 && lead > remaining && lead > 0;

  let winnerEntryId: string | null = null;
  let margin: string | null = null;
  let allSquareAfterRegulation = false;
  if (decided) {
    winnerEntryId = up > 0 ? a : b;
    margin = remaining > 0 ? `${lead}&${remaining}` : `${lead} up`;
  } else if (remaining === 0) {
    if (up !== 0) {
      winnerEntryId = up > 0 ? a : b;
      margin = `${lead} up`;
    } else {
      // All square after regulation → sudden death: the first extra hole won
      // decides it ("1 up (19)" on an 18-hole match, "(10)" on a nine).
      allSquareAfterRegulation = true;
      margin = 'AS';
      for (const h of sorted.filter((x) => x.hole > totalHoles)) {
        const w = holeWinner(h);
        if (w == null) continue;
        thru += 1;
        if (w === 'halved') continue;
        winnerEntryId = w === 'a' ? a : b;
        margin = `1 up (${h.hole})`;
        allSquareAfterRegulation = false;
        break;
      }
    }
  }
  return { up, thru, decided, winnerEntryId, margin, allSquareAfterRegulation };
}
