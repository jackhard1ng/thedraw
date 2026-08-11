/**
 * The Tour (addendum §7) — the season's spine. Each series renders as a printed
 * schedule: week number, course, date, field, and the winner once it's in.
 * Stops are real tournaments, so tapping through lands on the standard
 * registration/leaderboard page and results feed the order of merit.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Badge, Card, Live, Num, SectionHeader, Skeleton } from '@/components/ui';
import { formatTeeTime } from '@/lib/format';
import { useTournaments } from '@/features/tournaments/useTournaments';
import { ChatThread } from '@/features/chat/ChatThread';
import type { Ts } from '@/types/models';

interface Series {
  id: string;
  name: string;
  season: string;
  status: string;
  schedule?: { weeks: number; countBest: number } | null;
}

/** Points per week: showing up counts, winning counts more. */
const PLACEMENT_POINTS: Record<string, number> = {
  champion: 25,
  runnerUp: 15,
  semifinalist: 10,
  quarterfinalist: 5,
  flightWinner: 15,
  podWinner: 15,
};
const PARTICIPATION_POINTS = 5;

interface StandingRow {
  userId: string;
  name: string;
  weeksPlayed: number;
  points: number; // best-N total
}

/**
 * Season standings for one series — best `countBest` weeks per player, so a
 * missed Tuesday costs a counting slot, never the season. Derived client-side
 * from the stops' public entries + awards; nothing is stored (§4).
 */
function SeriesStandings({
  stopIds,
  countBest,
  weeks,
}: {
  stopIds: string[];
  countBest: number;
  weeks: number;
}) {
  const [rows, setRows] = useState<StandingRow[] | null>(null);

  const key = [...stopIds].sort().join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Weekly points per player: participation for entering, bonus per award.
      const weekly = new Map<string, Map<string, number>>(); // uid → (stopId → pts)
      const names = new Map<string, string>();
      const bump = (uid: string, stopId: string, pts: number) => {
        if (!weekly.has(uid)) weekly.set(uid, new Map());
        const m = weekly.get(uid)!;
        m.set(stopId, (m.get(stopId) ?? 0) + pts);
      };
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const [entrySnap, awardSnap] = await Promise.all([
          getDocs(query(collection(db, 'entries'), where('tournamentId', 'in', chunk))),
          getDocs(query(collection(db, 'awards'), where('tournamentId', 'in', chunk))),
        ]);
        entrySnap.docs.forEach((d) => {
          const e = d.data() as { tournamentId: string; userIds: string[]; displayNames?: string[]; status: string };
          if (e.status === 'withdrawn') return;
          e.userIds.forEach((u, j) => {
            bump(u, e.tournamentId, PARTICIPATION_POINTS);
            if (e.displayNames?.[j]) names.set(u, e.displayNames[j]);
          });
        });
        awardSnap.docs.forEach((d) => {
          const a = d.data() as { tournamentId: string; userId: string; placement: string };
          bump(a.userId, a.tournamentId, PLACEMENT_POINTS[a.placement] ?? 0);
        });
      }
      const out: StandingRow[] = [...weekly.entries()].map(([uid, byStop]) => {
        const scores = [...byStop.values()].sort((a, b) => b - a);
        return {
          userId: uid,
          name: names.get(uid) ?? 'Player',
          weeksPlayed: byStop.size,
          points: scores.slice(0, countBest).reduce((a, b) => a + b, 0),
        };
      });
      out.sort((a, b) => b.points - a.points || b.weeksPlayed - a.weeksPlayed);
      if (!cancelled) setRows(out);
    })().catch(() => {
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [key, countBest]);

  if (rows === null) return <Skeleton className="h-24" />;
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 font-display uppercase tracking-wide text-xs text-ink-soft">
        Season standings — best {countBest} of {weeks} weeks count
      </p>
      <div className="divide-y divide-rule">
        {rows.slice(0, 20).map((r, i) => (
          <Link
            key={r.userId}
            to={`/players/${r.userId}`}
            className="flex items-center justify-between py-1.5 text-sm"
          >
            <span className="min-w-0 truncate text-ink">
              <Num className="mr-2 text-ink-faint">{i + 1}.</Num>
              {r.name}
            </span>
            <span className="shrink-0 text-ink-faint">
              <Num className="text-ink">{r.points}</Num> pts ·{' '}
              <Num>{r.weeksPlayed}</Num> wks
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** League chat is member-gated by rules; reading the thread doc is the test. */
function SeriesChat({ seriesId }: { seriesId: string }) {
  const [member, setMember] = useState(false);
  useEffect(() => {
    return onSnapshot(
      doc(db, 'threads', seriesId),
      (snap) => setMember(snap.exists()),
      () => setMember(false), // permission denied = not in the league yet
    );
  }, [seriesId]);
  if (!member) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 font-display uppercase tracking-wide text-xs text-ink-soft">
        League chat — all season, one room
      </p>
      <Card className="p-4">
        <ChatThread threadId={seriesId} />
      </Card>
    </div>
  );
}
interface Stop {
  id: string; // == tournamentId
  seriesId: string;
  weekNumber: number;
  placeId: string;
  teeTimesHeld: number;
  startsAt: Ts;
}

export function TourPage() {
  const { profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const [series, setSeries] = useState<Series[] | null>(null);
  const [stops, setStops] = useState<Stop[] | null>(null);
  const tournaments = useTournaments(marketId);

  useEffect(() => {
    const q = query(
      collection(db, 'tourSeries'),
      where('marketId', '==', marketId),
      where('status', '==', 'active'),
    );
    return onSnapshot(
      q,
      (snap) => setSeries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Series, 'id'>) }))),
      () => setSeries([]),
    );
  }, [marketId]);

  useEffect(() => {
    return onSnapshot(
      collection(db, 'tourStops'),
      (snap) => setStops(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Stop, 'id'>) }))),
      () => setStops([]),
    );
  }, []);

  if (series === null || stops === null) {
    return (
      <div className="mx-auto max-w-sheet space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const tById = new Map((tournaments ?? []).map((t) => [t.id, t]));

  return (
    <div className="mx-auto max-w-sheet px-4 pb-28 pt-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl">The Tour</h1>
      </div>
      <p className="mb-5 text-sm text-ink-soft">
        A stop every week, a different course every time. Results feed the season
        order of merit.
      </p>

      {series.length === 0 && (
        <Card className="p-8 text-center">
          <p className="font-display uppercase tracking-wide text-ink-soft">
            No tour running yet
          </p>
          <p className="mt-1 text-sm text-ink-faint">
            When a season series starts, the weekly schedule lives here.
          </p>
        </Card>
      )}

      {series.map((s) => {
        const mine = stops
          .filter((st) => st.seriesId === s.id)
          .sort((a, b) => a.weekNumber - b.weekNumber);
        const weeks = s.schedule?.weeks ?? mine.length;
        const countBest = s.schedule?.countBest ?? weeks;
        return (
          <div key={s.id} className="mb-8">
            <SectionHeader right={<Badge tone="neutral">{s.season}</Badge>}>
              {s.name}
            </SectionHeader>
            {s.schedule && (
              <p className="mb-2 text-xs text-ink-faint">
                {weeks}-week season · miss a week, no problem — your best{' '}
                <Num>{countBest}</Num> count.
              </p>
            )}
            {mine.length === 0 ? (
              <p className="text-sm text-ink-faint">Schedule coming soon.</p>
            ) : (
              <div className="divide-y divide-rule">
                {mine.map((st) => {
                  const t = tById.get(st.id);
                  const live = t?.status === 'inProgress';
                  const done = t?.status === 'complete';
                  return (
                    <Link
                      key={st.id}
                      to={`/tournaments/${st.id}`}
                      className="flex items-center gap-3 py-3 transition-colors hover:bg-paper-sunken/60"
                    >
                      <div className="w-10 shrink-0 text-center">
                        <span className="block font-display text-[0.6rem] uppercase tracking-widest text-ink-faint">
                          Wk
                        </span>
                        <Num className="text-lg text-ink">{st.weekNumber}</Num>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">
                          {formatTeeTime(st.startsAt)}
                        </p>
                        <p className="text-xs text-ink-faint">
                          <Num>{st.teeTimesHeld}</Num> tee times held
                          {t && (
                            <>
                              {' '}· <Num>{t.entryIds.length}</Num>/<Num>{t.maxEntries}</Num> in
                            </>
                          )}
                        </p>
                      </div>
                      {live && (
                        <Badge tone="tournament">
                          <Live />
                          Live
                        </Badge>
                      )}
                      {done && <Badge tone="fresh">Final</Badge>}
                      {t?.status === 'open' && <Badge tone="neutral">Open</Badge>}
                    </Link>
                  );
                })}
              </div>
            )}
            <SeriesStandings
              stopIds={mine.map((st) => st.id)}
              countBest={countBest}
              weeks={weeks}
            />
            <SeriesChat seriesId={s.id} />
          </div>
        );
      })}
    </div>
  );
}
