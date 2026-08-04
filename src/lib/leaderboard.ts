/**
 * Leaderboard computation (spec §5 "Leaderboard design"). Scores render relative
 * to par — the convention on every broadcast leaderboard people have seen — and
 * gross/net are separate tables, never merged columns. Ties share a position
 * with a `T` prefix.
 *
 * Pure and display-only. The authoritative results live in `matches` /
 * `scorecards`; this turns them into rows for the table and the shareable image.
 */
export interface LbInput {
  entryId: string;
  name: string;
  index: number; // frozen combined index
  rounds: (number | null)[]; // gross strokes per round; null = not yet in
  courseHandicap: number | null; // for net; null if unavailable
  pars: number[]; // par per round (designated courses)
}

export interface LbRow {
  entryId: string;
  name: string;
  index: number;
  roundsToPar: (string | null)[]; // "+2", "E", null (THRU handled by caller)
  totalToPar: number | null;
  totalLabel: string; // "+12", "E", "—"
  net: number | null; // cumulative net strokes-to-par, if computable
  position: string; // "1", "T2"
}

function toParStr(rel: number): string {
  if (rel === 0) return 'E';
  return rel > 0 ? `+${rel}` : `${rel}`;
}

/** Build gross rows sorted low-to-high, with T-prefixed ties. */
export function grossLeaderboard(input: LbInput[]): LbRow[] {
  const rows = input.map((p) => {
    const played = p.rounds
      .map((s, i) => (s == null ? null : s - p.pars[i]))
      .filter((v): v is number => v != null);
    const totalToPar = played.length ? played.reduce((a, b) => a + b, 0) : null;
    const net =
      p.courseHandicap != null && played.length
        ? totalToPar! - p.courseHandicap * played.length
        : null;
    return {
      entryId: p.entryId,
      name: p.name,
      index: p.index,
      roundsToPar: p.rounds.map((s, i) => (s == null ? null : toParStr(s - p.pars[i]))),
      totalToPar,
      totalLabel: totalToPar == null ? '—' : toParStr(totalToPar),
      net,
      position: '',
    } satisfies LbRow;
  });

  rows.sort((a, b) => {
    if (a.totalToPar == null) return 1;
    if (b.totalToPar == null) return -1;
    return a.totalToPar - b.totalToPar;
  });

  // Assign positions with ties.
  let lastVal: number | null = null;
  let lastPos = 0;
  rows.forEach((r, i) => {
    if (r.totalToPar == null) {
      r.position = '—';
      return;
    }
    if (r.totalToPar === lastVal) {
      r.position = `T${lastPos}`;
      // mark the earlier tied row as T as well
      const prev = rows[i - 1];
      if (prev && !prev.position.startsWith('T')) prev.position = `T${lastPos}`;
    } else {
      lastPos = i + 1;
      lastVal = r.totalToPar;
      r.position = `${lastPos}`;
    }
  });

  return rows;
}

/** Net table: same rows re-sorted by cumulative net (§5 — separate table). */
export function netLeaderboard(input: LbInput[]): LbRow[] {
  const rows = grossLeaderboard(input).filter((r) => r.net != null);
  rows.sort((a, b) => (a.net ?? 0) - (b.net ?? 0));
  let lastVal: number | null = null;
  let lastPos = 0;
  rows.forEach((r, i) => {
    if (r.net === lastVal) {
      r.position = `T${lastPos}`;
      const prev = rows[i - 1];
      if (prev && !prev.position.startsWith('T')) prev.position = `T${lastPos}`;
    } else {
      lastPos = i + 1;
      lastVal = r.net;
      r.position = `${lastPos}`;
    }
  });
  return rows;
}
