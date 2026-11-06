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
  const chDiff = Math.round(Math.abs((chByEntry[a] ?? 0) - (chByEntry[b] ?? 0)));
  const receiver = (chByEntry[a] ?? 0) > (chByEntry[b] ?? 0) ? a : b;
  const alloc = strokeAllocation(chDiff, holeHandicapOrder, totalHoles);
  const played = [...holeScores].sort((x, y) => x.hole - y.hole);
  let up = 0;
  let thru = 0;
  for (const h of played) {
    const ga = h.scores[a];
    const gb = h.scores[b];
    if (ga == null || gb == null) continue;
    thru += 1;
    const st = alloc[h.hole - 1] ?? 0;
    const na = ga - (receiver === a ? st : 0);
    const nb = gb - (receiver === b ? st : 0);
    if (na < nb) up += 1;
    else if (nb < na) up -= 1;
  }
  const remaining = totalHoles - thru;
  const lead = Math.abs(up);
  const decided = lead > remaining && lead > 0;
  let winnerEntryId: string | null = null;
  let margin: string | null = null;
  let allSquareAfterRegulation = false;
  if (decided) {
    winnerEntryId = up > 0 ? a : b;
    margin = remaining > 0 ? `${lead}&${remaining}` : `${lead} up`;
  } else if (remaining === 0) {
    if (up === 0) {
      allSquareAfterRegulation = true;
      margin = 'AS';
    } else {
      winnerEntryId = up > 0 ? a : b;
      margin = `${lead} up`;
    }
  }
  return { up, thru, decided, winnerEntryId, margin, allSquareAfterRegulation };
}
