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
  /** True while a round is being scored live (partial holes, not yet final). */
  live: boolean;
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
  const tournamentPlaceId = (tournament as { placeId?: string } | null)?.placeId ?? null;
  const courses = useCourses([...(format?.designatedCourses ?? []), tournamentPlaceId ?? ''].filter(Boolean));

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

  const courseForRound = (i: number): Course | undefined => {
    const placeId = format?.designatedCourses?.[i] ?? tournamentPlaceId ?? undefined;
    return placeId ? courses[placeId] : undefined;
  };

  const pars = Array.from({ length: roundCount }, (_, i) => {
    const c = courseForRound(i);
    return c?.teeSets?.[0]?.par ?? c?.holePars?.reduce((a, b) => a + b, 0) ?? 72;
  });

  const built: BuiltInput[] = entries
    .filter((e) => e.status !== 'withdrawn')
    .map((e) => {
      const cards = scorecards.filter((s) => s.entryId === e.id);
      // Per-entry par per round: usually the full round par, but for a round
      // being scored LIVE it's the par of the holes played so far (so to-par is
      // honest at "thru 7"). Needs the course's holePars; without them the live
      // round contributes no to-par (we still show Thru).
      const entryPars = [...pars];
      let liveHoles = 0;
      let isLive = false;
      const rounds = Array.from({ length: roundCount }, (_, i) => {
        const card = cards.find((s) => s.round === i + 1);
        if (!card) return null;
        if (counts(card.status)) return card.gross;
        // Live: partial holes entered but not yet finalized.
        const holes = Array.isArray(card.holes) ? card.holes : [];
        const played = holes.map((s, idx) => ({ s, idx })).filter((x) => x.s > 0);
        if (played.length === 0) return null;
        const hp = courseForRound(i)?.holePars ?? null;
        if (i === roundCount - 1 || liveHoles === 0) {
          liveHoles = played.length;
          isLive = true;
        }
        if (hp && hp.length >= holes.length) {
          entryPars[i] = played.reduce((a, x) => a + (hp[x.idx] ?? 4), 0);
          return played.reduce((a, x) => a + x.s, 0);
        }
        return null; // no per-hole par → can't score to-par live; Thru still shows
      });
      const ch = cards.find((s) => s.courseHandicap != null)?.courseHandicap ?? null;
      const playedRounds = rounds.filter((r) => r != null).length;
      const diffs = rounds.map((g, i) =>
        g != null && ch != null ? differential(g, ch, entryPars[i]) : null,
      );
      const allFinal = cards.length > 0 && cards.every((s) => counts(s.status));
      const thru = allFinal
        ? 'F'
        : isLive && liveHoles > 0
          ? String(liveHoles)
          : playedRounds === 0
            ? '–'
            : playedRounds === roundCount
              ? 'F'
              : String(playedRounds);
      return {
        entryId: e.id,
        name:
          entryDisplay(e, users).name +
          ((e as { flight?: string | null }).flight ? ` · Flt ${(e as { flight?: string | null }).flight}` : ''),
        index: e.combinedIndex,
        rounds,
        courseHandicap: ch,
        pars: entryPars,
        thru,
        diffs,
        provisional: cards.some((s) => s.status === 'awaitingConfirmation'),
        live: isLive,
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
