/**
 * Organizer console (route /organizer) — rendered only for role organizer/admin.
 * A dashboard over the organizer's market: their tournaments, open reports
 * (organizers may read `reports` for their market per rules), pending event
 * requests, and disputed matches that need a ruling. It links out to the
 * create-tournament form, the handicap/verification panel, and the request
 * review screen; those are the action surfaces.
 *
 * `matches` carry no marketId, so disputed matches are resolved by fanning out
 * across the market's tournaments (§P7 scoping).
 */
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Badge, Card, Num, SectionHeader, Spinner } from '@/components/ui';
import { relativeDays } from '@/lib/format';
import { useTournaments } from '@/features/tournaments/useTournaments';
import type { Match, Report } from '@/types/models';

export interface EventRequestDoc {
  formatId: string;
  proposedEntryCents: number;
  proposedField: number;
  status: string;
  marketId: string;
  requestedBy?: string;
}

function useOpenReports(marketId: string): Report[] | null {
  const [rows, setRows] = useState<Report[] | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, 'reports'),
      where('marketId', '==', marketId),
      where('status', '==', 'open'),
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => d.data() as Report)),
      () => setRows([]),
    );
  }, [marketId]);
  return rows;
}

function usePendingRequests(marketId: string): (EventRequestDoc & { id: string })[] | null {
  const [rows, setRows] = useState<(EventRequestDoc & { id: string })[] | null>(null);
  useEffect(() => {
    const q = query(collection(db, 'eventRequests'), where('marketId', '==', marketId));
    return onSnapshot(
      q,
      (snap) =>
        setRows(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as EventRequestDoc) }))
            .filter((r) => r.status !== 'approved' && r.status !== 'declined'),
        ),
      () => setRows([]),
    );
  }, [marketId]);
  return rows;
}

export function OrganizerConsole() {
  const { profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const tournaments = useTournaments(marketId);
  const reports = useOpenReports(marketId);
  const requests = usePendingRequests(marketId);
  const [disputed, setDisputed] = useState<(Match & { id: string })[] | null>(null);

  const tKey = (tournaments ?? []).map((t) => t.id).sort().join(',');
  useEffect(() => {
    const ids = tKey ? tKey.split(',') : [];
    if (ids.length === 0) {
      setDisputed([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const out: (Match & { id: string })[] = [];
      for (let i = 0; i < ids.length; i += 30) {
        const snap = await getDocs(
          query(collection(db, 'matches'), where('tournamentId', 'in', ids.slice(i, i + 30))),
        );
        snap.docs.forEach((d) => {
          const m = d.data() as Match;
          if (m.result.disputed && m.status !== 'complete') out.push({ id: d.id, ...m });
        });
      }
      if (!cancelled) setDisputed(out);
    })().catch(() => {
      if (!cancelled) setDisputed([]);
    });
    return () => {
      cancelled = true;
    };
  }, [tKey]);

  // Guard: this screen is organizer/admin only.
  if (profile && profile.role !== 'organizer' && profile.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto max-w-sheet px-4 pb-28 pt-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl">Organizer</h1>
        <span className="text-xs uppercase tracking-widest text-ink-faint">
          {marketId.toUpperCase()}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2">
        <Link to="/organizer/new" className="btn btn-primary">
          + New tournament
        </Link>
        <Link to="/organizer/verify" className="btn btn-ghost">
          Verify / rule
        </Link>
      </div>

      {/* Queues */}
      <div className="mb-6 grid grid-cols-3 gap-2 text-center">
        <QueueTile label="Reports" n={reports?.length ?? null} to="#reports" tone="tournament" />
        <QueueTile label="Requests" n={requests?.length ?? null} to="/organizer/requests" tone="neutral" />
        <QueueTile label="Disputes" n={disputed?.length ?? null} to="/organizer/verify" tone="tournament" />
      </div>

      <SectionHeader>Tournaments</SectionHeader>
      {tournaments === null ? (
        <Spinner />
      ) : tournaments.length === 0 ? (
        <p className="text-sm text-ink-faint">No tournaments yet. Create the first.</p>
      ) : (
        <div className="space-y-2">
          {tournaments
            .slice()
            .sort((a, b) => b.registrationCloses.toMillis() - a.registrationCloses.toMillis())
            .map((t) => (
              <Link key={t.id} to={`/tournaments/${t.id}`}>
                <Card className="flex items-center justify-between p-3">
                  <div>
                    <p className="font-display uppercase tracking-wide text-ink">{t.name}</p>
                    <p className="text-xs text-ink-faint">
                      <Num>{t.entryIds?.length ?? 0}</Num>/<Num>{t.maxEntries}</Num> · closes{' '}
                      {relativeDays(t.registrationCloses)}
                    </p>
                  </div>
                  <Badge tone={t.status === 'inProgress' ? 'tournament' : 'neutral'}>{t.status}</Badge>
                </Card>
              </Link>
            ))}
        </div>
      )}

      <div id="reports" className="mt-6">
        <SectionHeader>Open reports</SectionHeader>
        {reports === null ? (
          <Spinner />
        ) : reports.length === 0 ? (
          <p className="text-sm text-ink-faint">No open reports.</p>
        ) : (
          <div className="space-y-2">
            {reports.map((r, i) => (
              <Card key={i} className="p-3 text-sm">
                <p className="text-ink">
                  <span className="font-display uppercase tracking-wide">{r.targetType}</span> ·{' '}
                  {r.reason}
                </p>
                {r.context && <p className="mt-1 text-ink-faint">{r.context}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueTile({
  label,
  n,
  to,
  tone,
}: {
  label: string;
  n: number | null;
  to: string;
  tone: 'tournament' | 'neutral';
}) {
  return (
    <Link to={to}>
      <Card className="p-3">
        <p className={`text-2xl ${tone === 'tournament' && n ? 'text-tournament' : 'text-ink'}`}>
          <Num>{n ?? '–'}</Num>
        </p>
        <p className="font-display uppercase tracking-wide text-xs text-ink-faint">{label}</p>
      </Card>
    </Link>
  );
}
