/**
 * Market results feed — completed matches, newest first, as one-line results:
 *   "Kevin Doyle def. Jack Harding 3&2 · Round of 16."
 *
 * `matches` carry no marketId, so we resolve the market's tournaments first
 * (§P7 scoping) and fan out to their completed matches, then resolve entry names
 * (singles via `users`). Not a live listener — results are historical — so a
 * getDocs assembly keyed on the tournament set is the right cost.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Card, Num, Spinner } from '@/components/ui';
import { roundLabel } from '@/lib/education';
import { relativeDays } from '@/lib/format';
import {
  bracketSize,
  entriesRemainingAt,
  entryDisplay,
  useTournaments,
} from '@/features/tournaments/useTournaments';
import type { Entry, Match, User } from '@/types/models';

interface FeedItem {
  id: string;
  winner: string;
  loser: string;
  margin: string;
  round: string;
  at: number;
}

async function chunkedIn<T>(
  coll: string,
  field: ReturnType<typeof documentId> | string,
  values: string[],
): Promise<{ id: string; data: T }[]> {
  const out: { id: string; data: T }[] = [];
  for (let i = 0; i < values.length; i += 30) {
    const snap = await getDocs(
      query(collection(db, coll), where(field as string, 'in', values.slice(i, i + 30))),
    );
    snap.docs.forEach((d) => out.push({ id: d.id, data: d.data() as T }));
  }
  return out;
}

export function ResultsFeed() {
  const { profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const tournaments = useTournaments(marketId);
  const [items, setItems] = useState<FeedItem[] | null>(null);

  const tKey = (tournaments ?? [])
    .map((t) => t.id)
    .sort()
    .join(',');

  useEffect(() => {
    const ids = tKey ? tKey.split(',') : [];
    if (ids.length === 0) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Field size per tournament drives the round label.
      const sizeByTournament = new Map<string, number>();
      (tournaments ?? []).forEach((t) =>
        sizeByTournament.set(t.id, bracketSize(t.entryIds?.length ?? 2)),
      );

      const matches = await chunkedIn<Match>('matches', 'tournamentId', ids);
      const complete = matches.filter((m) => m.data.status === 'complete');

      const entryIds = [...new Set(complete.flatMap((m) => m.data.entryIds))];
      const entryDocs = await chunkedIn<Entry>('entries', documentId(), entryIds);
      const entries: Record<string, Entry> = {};
      entryDocs.forEach((e) => (entries[e.id] = e.data));

      const userIds = [...new Set(entryDocs.flatMap((e) => e.data.userIds))];
      const userDocs = await chunkedIn<User>('users', documentId(), userIds);
      const users: Record<string, User> = {};
      userDocs.forEach((u) => (users[u.id] = u.data));

      const feed: FeedItem[] = complete.map((m) => {
        const win = m.data.result.winnerEntryId;
        const loseId = m.data.entryIds.find((e) => e !== win) ?? '';
        const winEntry = win ? entries[win] : undefined;
        const loseEntry = entries[loseId];
        const size = sizeByTournament.get(m.data.tournamentId) ?? 2;
        return {
          id: m.id,
          winner: winEntry ? entryDisplay(winEntry, users).name : '—',
          loser: loseEntry ? entryDisplay(loseEntry, users).name : '—',
          margin: m.data.result.margin ?? '',
          round: roundLabel(entriesRemainingAt(m.data.round, size)),
          at: m.data.result.confirmedAt?.toMillis() ?? m.data.result.submittedAt?.toMillis() ?? 0,
        };
      });
      feed.sort((a, b) => b.at - a.at);
      if (!cancelled) setItems(feed);
    })().catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [tKey]);

  return (
    <div className="mx-auto max-w-sheet px-4 pb-28 pt-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl">Results</h1>
        <span className="text-xs uppercase tracking-widest text-ink-faint">
          {marketId.toUpperCase()}
        </span>
      </div>

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="rounded-sm border border-dashed border-rule-strong p-8 text-center text-ink-faint">
          No results in yet.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <Card key={it.id} className="p-3">
              <p className="text-ink">
                <span className="font-display uppercase tracking-wide text-tournament">
                  {it.winner}
                </span>{' '}
                def. {it.loser} <Num>{it.margin}</Num>
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {it.round} · {relativeDays(new Date(it.at))}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
