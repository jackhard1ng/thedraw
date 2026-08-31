/**
 * Round-robin pods (spec §4 structure "pods"; open question §10.2). Default pod
 * size 4 → each player plays 3 matches (a full round robin of 4 = 6 matches).
 * The pod winner is the best record; ties broken by head-to-head then by seed.
 */
export const DEFAULT_POD_SIZE = 4;

/** Split a seeded field into pods, snaking so pods are balanced by strength. */
export function makePods(entriesBySeed: string[], podSize = DEFAULT_POD_SIZE): string[][] {
  const n = entriesBySeed.length;
  const podCount = Math.max(1, Math.round(n / podSize));
  const pods: string[][] = Array.from({ length: podCount }, () => []);
  // Snake draft: 0,1,2,..,podCount-1,podCount-1,..,0 keeps pods even in strength.
  let dir = 1;
  let p = 0;
  for (const entry of entriesBySeed) {
    pods[p].push(entry);
    if (dir === 1 && p === podCount - 1) dir = -1;
    else if (dir === -1 && p === 0) dir = 1;
    else p += dir;
  }
  return pods;
}

export interface PodPairing {
  podIndex: number;
  index: number; // match index within the pod
  entryA: string;
  entryB: string;
}

/** All pairings within one pod (round robin). */
export function podPairings(pod: string[], podIndex: number): PodPairing[] {
  const out: PodPairing[] = [];
  let idx = 0;
  for (let i = 0; i < pod.length; i++) {
    for (let j = i + 1; j < pod.length; j++) {
      out.push({ podIndex, index: idx++, entryA: pod[i], entryB: pod[j] });
    }
  }
  return out;
}

export interface PodRecord {
  entryId: string;
  wins: number;
  losses: number;
}

/** Rank a pod by wins, then head-to-head, then seed order (input order). */
export function rankPod(
  pod: string[],
  results: { winnerEntryId: string; loserEntryId: string }[],
): PodRecord[] {
  const rec = new Map<string, PodRecord>(
    pod.map((e) => [e, { entryId: e, wins: 0, losses: 0 }]),
  );
  for (const r of results) {
    const w = rec.get(r.winnerEntryId);
    const l = rec.get(r.loserEntryId);
    if (w) w.wins++;
    if (l) l.losses++;
  }
  const seedOrder = new Map(pod.map((e, i) => [e, i]));
  return [...rec.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    // head-to-head
    const h2h = results.find(
      (r) =>
        (r.winnerEntryId === a.entryId && r.loserEntryId === b.entryId) ||
        (r.winnerEntryId === b.entryId && r.loserEntryId === a.entryId),
    );
    if (h2h) return h2h.winnerEntryId === a.entryId ? -1 : 1;
    return (seedOrder.get(a.entryId) ?? 0) - (seedOrder.get(b.entryId) ?? 0);
  });
}
