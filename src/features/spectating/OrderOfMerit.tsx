/**
 * Order of Merit — season-long standings across a market, persistent across
 * events (spec §5 / Phase 4). DERIVED from `entries` (showing up) and `awards`
 * (advancing + placing); nothing is stored on the user.
 *
 * Points formula (documented so it's auditable, never a black box):
 *   +1  per event entered                         (rewards showing up)
 *   +1  per match won        — from award.path.length (rewards advancing)
 *   placement bonus:
 *        champion 20 · runnerUp 12 · semifinalist 8 · quarterfinalist 4
 *        flightWinner 6 · podWinner 6
 * A player who enters and loses round one still scores; a champion is paid for
 * every rung climbed, not only the trophy.
 *
 * `entries`/`awards` carry no marketId, so we scope by resolving the market's
 * tournaments first and fanning out (same pattern as the results feed).
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
import { Num, Spinner } from '@/components/ui';
import { useTournaments } from '@/features/tournaments/useTournaments';
import type { Award, Entry, Placement, User } from '@/types/models';

const PLACEMENT_BONUS: Record<Placement, number> = {
  champion: 20,
  runnerUp: 12,
  semifinalist: 8,
  quarterfinalist: 4,
  flightWinner: 6,
  podWinner: 6,
};

interface Standing {
  userId: string;
  name: string;
  events: number;
  wins: number;
  points: number;
}

async function chunkedIn<T>(
  coll: string,
  field: string | ReturnType<typeof documentId>,
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

export function OrderOfMerit() {
  const { profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const tournaments = useTournaments(marketId);
  const [rows, setRows] = useState<Standing[] | null>(null);

  const tKey = (tournaments ?? []).map((t) => t.id).sort().join(',');

  useEffect(() => {
    const ids = tKey ? tKey.split(',') : [];
    if (ids.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const acc = new Map<string, { events: number; wins: number; points: number }>();
      const bump = (uid: string, d: Partial<{ events: number; wins: number; points: number }>) => {
        const cur = acc.get(uid) ?? { events: 0, wins: 0, points: 0 };
        acc.set(uid, {
          events: cur.events + (d.events ?? 0),
          wins: cur.wins + (d.wins ?? 0),
          points: cur.points + (d.points ?? 0),
        });
      };

      const entries = await chunkedIn<Entry>('entries', 'tournamentId', ids);
      entries.forEach((e) => {
        if (e.data.status === 'withdrawn') return;
        e.data.userIds.forEach((uid) => bump(uid, { events: 1, points: 1 }));
      });

      const awards = await chunkedIn<Award>('awards', 'tournamentId', ids);
      awards.forEach((a) => {
        const wins = a.data.path?.length ?? 0;
        bump(a.data.userId, {
          wins,
          points: wins + (PLACEMENT_BONUS[a.data.placement] ?? 0),
        });
      });

      const userIds = [...acc.keys()];
      const userDocs = await chunkedIn<User>('users', documentId(), userIds);
      const names: Record<string, string> = {};
      userDocs.forEach((u) => (names[u.id] = u.data.displayName));

      const standings: Standing[] = userIds.map((uid) => {
        const s = acc.get(uid)!;
        return { userId: uid, name: names[uid] ?? '—', ...s };
      });
      standings.sort((a, b) => b.points - a.points);
      if (!cancelled) setRows(standings);
    })().catch(() => {
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [tKey]);

  return (
    <div className="mx-auto max-w-sheet px-4 pb-28 pt-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl">Order of Merit</h1>
        <span className="text-xs uppercase tracking-widest text-ink-faint">
          {marketId.toUpperCase()}
        </span>
      </div>

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="rounded-sm border border-dashed border-rule-strong p-8 text-center text-ink-faint">
          No standings yet this season.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink text-left font-display uppercase tracking-wide text-xs text-ink-soft">
                <th className="py-1 pr-2">Pos</th>
                <th className="py-1 pr-2">Player</th>
                <th className="py-1 pr-2 text-right">Events</th>
                <th className="py-1 pr-2 text-right">Wins</th>
                <th className="py-1 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.userId} className={`border-b border-rule ${i === 0 ? 'font-semibold' : ''}`}>
                  <td className="py-1.5 pr-2">
                    <Num>{i + 1}</Num>
                  </td>
                  <td className="py-1.5 pr-2 text-ink">{r.name}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <Num>{r.events}</Num>
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Num>{r.wins}</Num>
                  </td>
                  <td className="py-1.5 text-right">
                    <Num className={i === 0 ? 'text-tournament' : ''}>{r.points}</Num>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
