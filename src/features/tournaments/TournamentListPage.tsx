/**
 * The tournament board — open / in-progress / complete events for a market,
 * rendered as draw-sheet cards (spec §8). Each card leads with the three things
 * that decide an entry: what it is, what it costs, and how long you have to get
 * in. Everything numeric is tabular.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Badge, Card, Num, Spinner } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { formatTeeTime, relativeDays } from '@/lib/format';
import type { Tournament, TournamentStatus } from '@/types/models';
import {
  useFormats,
  useTournaments,
  useUserEntries,
  type TournamentWithId,
} from './useTournaments';

type Tab = 'open' | 'live' | 'past';

const TAB_STATUSES: Record<Tab, TournamentStatus[]> = {
  open: ['open', 'filled'],
  live: ['closing', 'inProgress', 'completing'],
  past: ['complete'],
};

const STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  filled: 'Filled',
  closing: 'Locking',
  inProgress: 'Live',
  completing: 'Settling',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

function statusTone(s: TournamentStatus): BadgeTone {
  if (s === 'inProgress') return 'tournament';
  if (s === 'open') return 'fresh';
  return 'neutral';
}

function TournamentCard({
  t,
  formatName,
}: {
  t: TournamentWithId;
  formatName: string;
}) {
  const field = t.entryIds?.length ?? 0;
  const free = t.entryFeeCents === 0;
  return (
    <Card className="p-4">
      <Link to={`/tournaments/${t.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display uppercase tracking-wide text-ink">
              {t.name}
            </p>
            <p className="text-sm text-ink-soft">{formatName}</p>
          </div>
          <Badge tone={statusTone(t.status)}>{STATUS_LABEL[t.status]}</Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>
            {free ? (
              <span className="text-pine">Free</span>
            ) : (
              <Num className="text-ink">{formatCents(t.entryFeeCents)}</Num>
            )}{' '}
            entry
          </span>
          <span>
            <Num>{field}</Num>/<Num>{t.maxEntries}</Num> entered
          </span>
          {t.startsAt && <span>Tees off {formatTeeTime(t.startsAt)}</span>}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-rule pt-2 text-xs text-ink-faint">
          <span>
            {t.status === 'open'
              ? `Registration closes ${relativeDays(t.registrationCloses)}`
              : `${STATUS_LABEL[t.status]}`}
          </span>
          {t.status === 'open' && (
            <span className="font-display uppercase tracking-wide text-tournament">
              View →
            </span>
          )}
        </div>
      </Link>
    </Card>
  );
}

/** The games you're in that aren't settled yet — the first thing you look for. */
function YourGames({ uid, formatName }: { uid: string; formatName: (id: string) => string }) {
  const entries = useUserEntries(uid);
  const ids = useMemo(
    () =>
      [...new Set((entries ?? []).filter((e) => e.status !== 'withdrawn').map((e) => e.tournamentId))]
        .sort()
        .join(','),
    [entries],
  );
  const [rows, setRows] = useState<TournamentWithId[]>([]);
  useEffect(() => {
    const list = ids ? ids.split(',') : [];
    if (list.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const out: TournamentWithId[] = [];
      for (let i = 0; i < list.length; i += 30) {
        const snap = await getDocs(
          query(collection(db, 'tournaments'), where(documentId(), 'in', list.slice(i, i + 30))),
        );
        snap.docs.forEach((d) => out.push({ id: d.id, ...(d.data() as Tournament) }));
      }
      if (!cancelled) setRows(out.filter((t) => !['complete', 'cancelled'].includes(t.status)));
    })().catch(() => {
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [ids]);
  if (rows.length === 0) return null;
  return (
    <div className="mb-6">
      <p className="mb-2 font-display uppercase tracking-wide text-xs text-ink-soft">Your games</p>
      <div className="space-y-3">
        {rows.map((t) => (
          <TournamentCard key={t.id} t={t} formatName={formatName(t.formatId)} />
        ))}
      </div>
    </div>
  );
}

export function TournamentListPage() {
  const { profile, fbUser } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const [tab, setTab] = useState<Tab>('open');
  const tournaments = useTournaments(marketId, TAB_STATUSES[tab]);
  const formats = useFormats();

  const sorted = useMemo(() => {
    if (!tournaments) return null;
    return [...tournaments].sort(
      (a, b) => a.registrationCloses.toMillis() - b.registrationCloses.toMillis(),
    );
  }, [tournaments]);

  return (
    <div className="mx-auto max-w-sheet px-4 pb-28 pt-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl">Tournaments</h1>
        <div className="flex items-baseline gap-4">
          <Link
            to="/tour"
            className="font-display uppercase tracking-wide text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
          >
            The Tour
          </Link>
          {/* Instant events (addendum §2) — self-serve template instantiation */}
          <Link
            to="/tournaments/new-game"
            className="font-display uppercase tracking-wide text-xs text-tournament underline underline-offset-2"
          >
            + Start a game
          </Link>
        </div>
      </div>

      {fbUser && <YourGames uid={fbUser.uid} formatName={(id) => formats[id]?.name ?? id} />}

      <div className="mb-4 flex gap-2">
        {(['open', 'live', 'past'] as Tab[]).map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`flex-1 rounded-sm border px-3 py-2 text-xs font-display uppercase tracking-wide transition-colors ${
              tab === tb
                ? 'border-ink bg-ink text-paper'
                : 'border-rule-strong text-ink-soft hover:border-ink'
            }`}
          >
            {tb === 'open' ? 'Open' : tb === 'live' ? 'Live' : 'Past'}
          </button>
        ))}
      </div>

      {sorted === null ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <div className="rounded-sm border border-dashed border-rule-strong p-8 text-center">
          <p className="font-display uppercase tracking-wide text-ink-soft">
            No {tab === 'open' ? 'open' : tab === 'live' ? 'live' : 'past'} events
          </p>
          {tab === 'open' && (
            <>
              <p className="mx-auto mt-2 max-w-xs text-sm text-ink-faint">
                Challenge someone to a heads-up match for a few bucks, or spin up
                a small tournament. Your stake is only held — never charged unless
                the game runs.
              </p>
              <Link
                to="/tournaments/new-game"
                className="mt-4 inline-block rounded-sm bg-ink px-4 py-2 font-display uppercase tracking-wide text-xs text-paper"
              >
                Start a game →
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((t) => (
            <TournamentCard
              key={t.id}
              t={t}
              formatName={formats[t.formatId]?.name ?? t.formatId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
