/**
 * Tournament / entry / user data hooks (Phase 2–3). Every market-scoped query
 * filters on `marketId` (spec §P7). Reads are realtime via onSnapshot, matching
 * the board's pattern (see features/board/useRoundPosts.ts). Writes never happen
 * here — those go through the callables in src/lib/callable.ts.
 *
 * `matches` and `scorecards` are keyed by `tournamentId` (they carry no
 * marketId of their own), so their hooks scope by tournament, and any
 * market-wide view first resolves the market's tournaments and fans out.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  documentId,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type {
  Entry,
  Format,
  Match,
  Scorecard,
  Tournament,
  TournamentStatus,
  User,
} from '@/types/models';

export interface TournamentWithId extends Tournament {
  id: string;
}
export interface EntryWithId extends Entry {
  id: string;
}
export interface MatchWithId extends Match {
  id: string;
}
export interface ScorecardWithId extends Scorecard {
  id: string;
}

/** List a market's tournaments, optionally filtered to a set of statuses. */
export function useTournaments(
  marketId: string,
  statuses?: TournamentStatus[],
): TournamentWithId[] | null {
  const [rows, setRows] = useState<TournamentWithId[] | null>(null);
  // Serialize the status list so the effect key is stable across renders.
  const statusKey = statuses ? statuses.join(',') : '';
  useEffect(() => {
    const list = statusKey ? statusKey.split(',') : [];
    const q =
      list.length > 0
        ? query(
            collection(db, 'tournaments'),
            where('marketId', '==', marketId),
            where('status', 'in', list),
          )
        : query(collection(db, 'tournaments'), where('marketId', '==', marketId));
    return onSnapshot(
      q,
      (snap) =>
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Tournament) }))),
      () => setRows([]),
    );
  }, [marketId, statusKey]);
  return rows;
}

/** A single tournament, realtime. */
export function useTournament(id: string | undefined): {
  tournament: TournamentWithId | null;
  loading: boolean;
} {
  const [tournament, setTournament] = useState<TournamentWithId | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    return onSnapshot(doc(db, 'tournaments', id), (snap) => {
      setTournament(
        snap.exists() ? { id: snap.id, ...(snap.data() as Tournament) } : null,
      );
      setLoading(false);
    });
  }, [id]);
  return { tournament, loading };
}

/** All entries for one tournament. */
export function useTournamentEntries(
  tournamentId: string | undefined,
): EntryWithId[] | null {
  const [rows, setRows] = useState<EntryWithId[] | null>(null);
  useEffect(() => {
    if (!tournamentId) return;
    const q = query(
      collection(db, 'entries'),
      where('tournamentId', '==', tournamentId),
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Entry) }))),
      () => setRows([]),
    );
  }, [tournamentId]);
  return rows;
}

/** Every entry a user is part of (singles or team). */
export function useUserEntries(userId: string | undefined): EntryWithId[] | null {
  const [rows, setRows] = useState<EntryWithId[] | null>(null);
  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'entries'),
      where('userIds', 'array-contains', userId),
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Entry) }))),
      () => setRows([]),
    );
  }, [userId]);
  return rows;
}

/** All matches for one tournament, realtime. */
export function useTournamentMatches(
  tournamentId: string | undefined,
): MatchWithId[] | null {
  const [rows, setRows] = useState<MatchWithId[] | null>(null);
  useEffect(() => {
    if (!tournamentId) return;
    const q = query(
      collection(db, 'matches'),
      where('tournamentId', '==', tournamentId),
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Match) }))),
      () => setRows([]),
    );
  }, [tournamentId]);
  return rows;
}

/** A single match, realtime. */
export function useMatch(id: string | undefined): {
  match: MatchWithId | null;
  loading: boolean;
} {
  const [match, setMatch] = useState<MatchWithId | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    return onSnapshot(doc(db, 'matches', id), (snap) => {
      setMatch(snap.exists() ? { id: snap.id, ...(snap.data() as Match) } : null);
      setLoading(false);
    });
  }, [id]);
  return { match, loading };
}

/** All scorecards for a stroke-play tournament, realtime. */
export function useTournamentScorecards(
  tournamentId: string | undefined,
): ScorecardWithId[] | null {
  const [rows, setRows] = useState<ScorecardWithId[] | null>(null);
  useEffect(() => {
    if (!tournamentId) return;
    const q = query(
      collection(db, 'scorecards'),
      where('tournamentId', '==', tournamentId),
    );
    return onSnapshot(
      q,
      (snap) =>
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Scorecard) }))),
      () => setRows([]),
    );
  }, [tournamentId]);
  return rows;
}

/**
 * Resolve a set of user ids to their `users` docs. Names on entries are only
 * denormalized for teams (`teamName`); singles competitors are resolved here so
 * brackets and leaderboards can print real names beside frozen indexes.
 *
 * Firestore `in` queries cap at 30, so we chunk and getDocs each batch. Names
 * change rarely, so a one-shot fetch per id-set (not a live listener) is fine.
 */
export function useUsers(ids: string[]): Record<string, User> {
  const [map, setMap] = useState<Record<string, User>>({});
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    const unique = key ? key.split(',') : [];
    if (unique.length === 0) {
      setMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      const out: Record<string, User> = {};
      for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30);
        const snap = await getDocs(
          query(collection(db, 'users'), where(documentId(), 'in', chunk)),
        );
        snap.docs.forEach((d) => {
          out[d.id] = d.data() as User;
        });
      }
      if (!cancelled) setMap(out);
    })().catch(() => {
      if (!cancelled) setMap({});
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return map;
}

// ---------------------------------------------------------------------------
// Bracket geometry — shared by BracketView, MatchPage and the results feed so
// a match's `round` number maps to a human round name ("Quarterfinal").
// ---------------------------------------------------------------------------

/** Smallest power of two ≥ the field size (the padded bracket size). */
export function bracketSize(entryCount: number): number {
  let n = 1;
  while (n < Math.max(2, entryCount)) n *= 2;
  return n;
}

/** Competitors still alive entering `round` (1-indexed) of a `size` bracket. */
export function entriesRemainingAt(round: number, size: number): number {
  return Math.max(2, Math.round(size / 2 ** (round - 1)));
}

/** All formats (formats are data, not code — one doc per format). */
export function useFormats(): Record<string, Format> {
  const [map, setMap] = useState<Record<string, Format>>({});
  useEffect(() => {
    return onSnapshot(
      collection(db, 'formats'),
      (snap) => {
        const out: Record<string, Format> = {};
        snap.docs.forEach((d) => {
          out[d.id] = { ...(d.data() as Format), id: d.id };
        });
        setMap(out);
      },
      () => setMap({}),
    );
  }, []);
  return map;
}

/** A single format doc, realtime. */
export function useFormat(id: string | undefined): Format | null {
  const [fmt, setFmt] = useState<Format | null>(null);
  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      doc(db, 'formats', id),
      (snap) => setFmt(snap.exists() ? { ...(snap.data() as Format), id: snap.id } : null),
      () => setFmt(null),
    );
  }, [id]);
  return fmt;
}

/** Display name + frozen index for an entry. Prefers the denormalized names
 * (public-page safe); falls back to a users lookup for legacy entries. */
export function entryDisplay(
  entry: EntryWithId | Entry,
  users: Record<string, User>,
): { name: string; index: number } {
  if (entry.teamName) return { name: entry.teamName, index: entry.combinedIndex };
  if (entry.displayNames?.length) {
    return { name: entry.displayNames.join(' / '), index: entry.combinedIndex };
  }
  const names = entry.userIds.map((uid) => users[uid]?.displayName ?? '—');
  return { name: names.join(' / '), index: entry.combinedIndex };
}
