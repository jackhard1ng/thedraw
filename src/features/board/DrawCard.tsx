/**
 * Enter the Draw — the board's headline act. One tap puts you in a day's draw;
 * the hourly sweep groups you with players near your index and names a booker.
 * The card shows live "N in the draw" counts so entering feels like joining
 * something already moving.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Num } from '@/components/ui';
import { enterDraw, leaveDraw } from '@/lib/callable';
import { PushNudge } from '@/features/notifications/PushNudge';
import { areaLabel } from '@/lib/areas';
import type { PlayRequest } from '@/types/models';
import { Link } from 'react-router-dom';

const DAYS: { key: string; label: string }[] = [
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];

export function DrawCard() {
  const { fbUser, profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const [open, setOpen] = useState<(PlayRequest & { id: string })[]>([]);
  const [day, setDay] = useState('saturday');
  const [willingToBook, setWillingToBook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'playRequests'),
      where('marketId', '==', marketId),
      where('status', '==', 'open'),
    );
    return onSnapshot(
      q,
      (snap) => setOpen(snap.docs.map((d) => ({ id: d.id, ...(d.data() as PlayRequest) }))),
      () => setOpen([]),
    );
  }, [marketId]);

  const mine = open.find((r) => r.userId === fbUser?.uid && r.day === day);
  // Count only entrants matchable WITH HIM (±8 index) — "5 in for Sat" would
  // over-promise when all five are scratch players he can never group with.
  const myIndex = profile?.handicap.index ?? 0;
  const countForDay = open.filter(
    (r) => r.day === day && Math.abs(r.index - myIndex) <= 8,
  ).length;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (mine) await leaveDraw({ day });
      else await enterDraw({ day, willingToBook });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 border-tournament/30 p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-display uppercase tracking-wide text-ink">
          Enter the draw
        </p>
        <span className="text-xs text-ink-faint">
          <Num>{countForDay}</Num> near your level in for {day.slice(0, 3)}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        One tap. We group you with players near your level and name who books.
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        {(profile?.areas?.length ?? 0) > 0 ? (
          <>Matching in: {profile!.areas!.map((a) => areaLabel(marketId, a)).join(', ')} · </>
        ) : (
          <>Matching anywhere in the metro · </>
        )}
        <Link to="/profile" className="text-tournament underline underline-offset-2">
          set your areas
        </Link>
      </p>

      <div className="mt-3 flex items-center gap-2">
        {DAYS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDay(d.key)}
            className={`rounded-full border px-3 py-1 text-xs font-display uppercase tracking-wide transition-colors ${
              day === d.key
                ? 'border-tournament bg-tournament text-paper'
                : 'border-rule-strong text-ink-soft'
            }`}
          >
            {d.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={willingToBook}
            onChange={(e) => setWillingToBook(e.target.checked)}
            disabled={!!mine}
            className="h-4 w-4 accent-tournament"
          />
          I can book
        </label>
      </div>

      <Button
        variant={mine ? 'ghost' : 'primary'}
        className="mt-3 w-full"
        disabled={busy}
        onClick={toggle}
      >
        {busy
          ? '…'
          : mine
            ? `You're in ${day.slice(0, 3)}'s draw — tap to withdraw`
            : `Put me in ${day.slice(0, 3)}'s draw`}
      </Button>
      {mine && (
        <p className="mt-2 text-xs text-ink-faint">
          The draw runs every hour as players enter. We'll notify you the moment
          you're grouped; an entry that finds no group expires after 7 days.
        </p>
      )}
      {mine && (
        <PushNudge context="Turn on notifications so you know the moment you're drawn." />
      )}
      {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
    </Card>
  );
}
