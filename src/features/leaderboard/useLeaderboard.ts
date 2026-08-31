/**
 * Builds leaderboard rows for a stroke-play tournament from `entries` +
 * `scorecards`, resolving round pars from the format's designated courses. Pure
 * assembly around the helpers in lib/leaderboard.ts; shared by both the table
 * and the shareable image so they never drift.
 */
import { useEffect, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { grossLeaderboard, netLeaderboard, type LbInput, type LbRow } from '@/lib/leaderboard';
import { differential } from '@/lib/format';
import {
  entryDisplay,
  useFormat,
  useTournament,
  useTournamentEntries,
  useTournamentScorecards,
  useUsers,
  type TournamentWithId,
} from '@/features/tournaments/useTournaments';
import type { Course } from '@/types/models';

export interface BuiltInput extends LbInput {
  thru: string;
  diffs: (string | null)[];
  /** True while any counted round is still awaiting a partner's confirmation. */
  provisional: boolean;
}

export interface LeaderboardData {
  ready: boolean;
  tournament: TournamentWithId | null;
  roundCount: number;
  gross: LbRow[];
  net: LbRow[];
  showNet: boolean;
  inputs: Map<string, BuiltInput>;
}

function useCourses(placeIds: string[]): Record<string, Course> {
  const [map, setMap] = useState<Record<string, Course>>({});
  const key = [...new Set(placeIds.filter(Boolean))].sort().join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      const out: Record<string, Course> = {};
      for (let i = 0; i < ids.length; i += 30) {
        const snap = await getDocs(
          query(collection(db, 'courses'), where(documentId(), 'in', ids.slice(i, i + 30))),
        );
        snap.docs.forEach((d) => {
          out[d.id] = d.data() as Course;
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

const counts = (status: string) =>
  status === 'complete' || status === 'awaitingConfirmation';

export function useLeaderboard(tournamentId: string): LeaderboardData {
  const { tournament } = useTournament(tournamentId);
  const format = useFormat(tournament?.formatId);
  const entries = useTournamentEntries(tournamentId);
  const scorecards = useTournamentScorecards(tournamentId);
  const users = useUsers((entries ?? []).flatMap((e) => e.userIds));
  const courses = useCourses(format?.designatedCourses ?? []);

  const ready = !!tournament && entries !== null && scorecards !== null;

  if (!ready || !tournament || entries === null || scorecards === null) {
    return {
      ready: false,
      tournament: tournament ?? null,
      roundCount: 1,
      gross: [],
      net: [],
      showNet: false,
      inputs: new Map(),
    };
  }

  const roundCount = format?.rounds ?? Math.max(1, ...scorecards.map((s) => s.round), 1);

  const pars = Array.from({ length: roundCount }, (_, i) => {
    const placeId = format?.designatedCourses?.[i];
    const c = placeId ? courses[placeId] : undefined;
    return c?.teeSets?.[0]?.par ?? c?.holePars?.reduce((a, b) => a + b, 0) ?? 72;
  });

  const built: BuiltInput[] = entries
    .filter((e) => e.status !== 'withdrawn')
    .map((e) => {
      const cards = scorecards.filter((s) => s.entryId === e.id);
      const rounds = Array.from({ length: roundCount }, (_, i) => {
        const card = cards.find((s) => s.round === i + 1 && counts(s.status));
        return card ? card.gross : null;
      });
      // courseHandicap can differ per round; the helper takes one, so use the
      // first frozen value on record for this entry (best-effort for net).
      const ch = cards.find((s) => s.courseHandicap != null)?.courseHandicap ?? null;
      const played = rounds.filter((r) => r != null).length;
      const diffs = rounds.map((g, i) =>
        g != null && ch != null ? differential(g, ch, pars[i]) : null,
      );
      return {
        entryId: e.id,
        // Flight rides the name — "Vogel, M. · Flt B" — so a flighted field
        // reads who you're actually competing against at a glance.
        name:
          entryDisplay(e, users).name +
          ((e as { flight?: string | null }).flight ? ` · Flt ${(e as { flight?: string | null }).flight}` : ''),
        index: e.combinedIndex,
        rounds,
        courseHandicap: ch,
        pars,
        thru: played === 0 ? '–' : played === roundCount ? 'F' : String(played),
        diffs,
        provisional: cards.some((s) => s.status === 'awaitingConfirmation'),
      } satisfies BuiltInput;
    });

  const showNet = tournament.divisionMode !== 'grossOnly';
  return {
    ready: true,
    tournament,
    roundCount,
    gross: grossLeaderboard(built),
    net: showNet ? netLeaderboard(built) : [],
    showNet,
    inputs: new Map(built.map((i) => [i.entryId, i])),
  };
}
