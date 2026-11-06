/**
 * Review member-initiated event requests (spec §7 Path B). Organizers approve or
 * decline; approval typically seeds a createTournament with fromRequestId. Reads
 * `eventRequests` scoped to the organizer's market; the decision runs through the
 * reviewEventRequest callable.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Num, SectionHeader, Spinner } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { reviewEventRequest } from '@/lib/callable';
import { useFormats } from '@/features/tournaments/useTournaments';
import type { EventRequestDoc } from './OrganizerConsole';

export function ReviewRequests() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const formats = useFormats();
  const [rows, setRows] = useState<(EventRequestDoc & { id: string })[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function decide(requestId: string, decision: 'approved' | 'declined') {
    setBusy(requestId);
    setError(null);
    try {
      await reviewEventRequest({ requestId, decision });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav('/organizer')} className="btn-quiet mb-4 px-0">
        ← Organizer
      </button>
      <SectionHeader>Event requests</SectionHeader>

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">No pending requests.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="p-4">
              <p className="font-display uppercase tracking-wide text-ink">
                {formats[r.formatId]?.name ?? r.formatId}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                <span>
                  Entry{' '}
                  {r.proposedEntryCents === 0 ? (
                    <span className="text-pine">Free</span>
                  ) : (
                    <Num className="text-ink">{formatCents(r.proposedEntryCents)}</Num>
                  )}
                </span>
                <span>
                  Field <Num>{r.proposedField}</Num>
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'approved')}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'declined')}
                >
                  Decline
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-tournament">{error}</p>}
    </div>
  );
}
