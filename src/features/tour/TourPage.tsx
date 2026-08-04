/**
 * The Tour (addendum §7) — the season's spine. Each series renders as a printed
 * schedule: week number, course, date, field, and the winner once it's in.
 * Stops are real tournaments, so tapping through lands on the standard
 * registration/leaderboard page and results feed the order of merit.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Badge, Card, Live, Num, SectionHeader, Skeleton } from '@/components/ui';
import { formatTeeTime } from '@/lib/format';
import { useTournaments } from '@/features/tournaments/useTournaments';
import type { Ts } from '@/types/models';

interface Series {
  id: string;
  name: string;
  season: string;
  status: string;
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
        return (
          <div key={s.id} className="mb-8">
            <SectionHeader right={<Badge tone="neutral">{s.season}</Badge>}>
              {s.name}
            </SectionHeader>
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
          </div>
        );
      })}
    </div>
  );
}
