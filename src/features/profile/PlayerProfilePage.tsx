/**
 * Another player's public card (/players/:uid) — the trust story's missing
 * page. Everything here is the data the product WANTS public between members:
 * name, handicap tier + source badge, reliability, and the competitive record.
 * Nothing contact-related lives on the users doc anymore, so this page cannot
 * leak what it never receives.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge, Card, Num, SectionHeader, Spinner } from '@/components/ui';
import { FollowButton } from '@/features/spectating/FollowButton';
import { ReportBlockMenu } from '@/features/moderation/ReportBlockMenu';
import { useAuth } from '@/context/AuthContext';
import { freshness, indexLine, sourceBadge, tierFor } from '@/lib/handicap';
import { formatTeeTime } from '@/lib/format';
import { formatCents } from '@/lib/money';
import type { ReputationEvent, User } from '@/types/models';

function Reliability({ userId }: { userId: string }) {
  const [events, setEvents] = useState<ReputationEvent[] | null>(null);
  useEffect(() => {
    const q = query(collection(db, 'reputationEvents'), where('userId', '==', userId));
    return onSnapshot(
      q,
      (snap) => setEvents(snap.docs.map((d) => d.data() as ReputationEvent)),
      () => setEvents([]),
    );
  }, [userId]);
  if (events === null) return null;
  const committed = events.filter((e) => e.type === 'committed').length;
  const played = events.filter((e) => e.type === 'played').length;
  const forfeits = events.filter((e) => e.type === 'forfeitNonResponse').length;
  if (committed === 0) return <p className="text-sm text-ink-faint">No committed rounds yet.</p>;
  return (
    <p className="text-ink">
      Played <Num>{played}</Num> of <Num>{committed}</Num> committed rounds
      {forfeits > 0 && (
        <span className="text-ink-soft">
          {' '}· <Num>{forfeits}</Num> forfeit{forfeits === 1 ? '' : 's'} in the last year
        </span>
      )}
      .
    </p>
  );
}

interface AwardRow {
  id: string;
  tournamentName: string;
  season: string;
  placement: string;
  flight: string | null;
  amountCents: number | null;
}

const PLACEMENT_LABEL: Record<string, string> = {
  champion: 'Champion',
  runnerUp: 'Runner-up',
  semifinalist: 'Semifinalist',
  quarterfinalist: 'Quarterfinalist',
  podWinner: 'Pod winner',
  flightWinner: 'Flight winner',
};

function Record({ userId }: { userId: string }) {
  const [awards, setAwards] = useState<AwardRow[] | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, 'awards'),
      where('userId', '==', userId),
      orderBy('awardedAt', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => setAwards(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AwardRow, 'id'>) }))),
      () => setAwards([]),
    );
  }, [userId]);
  if (awards === null) return <Spinner />;
  if (awards.length === 0) return <p className="text-sm text-ink-faint">No placements yet.</p>;
  return (
    <div className="divide-y divide-rule">
      {awards.map((w) => (
        <div key={w.id} className="flex items-center justify-between py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate text-ink">
              {PLACEMENT_LABEL[w.placement] ?? w.placement}
              {w.flight ? ` · ${w.flight}` : ''}
            </p>
            <p className="text-xs text-ink-faint">
              {w.tournamentName} · {w.season}
            </p>
          </div>
          {w.amountCents != null && w.amountCents > 0 && (
            <Num className="shrink-0 text-pine">{formatCents(w.amountCents)}</Num>
          )}
        </div>
      ))}
    </div>
  );
}

export function PlayerProfilePage() {
  const { uid } = useParams();
  const nav = useNavigate();
  const { fbUser } = useAuth();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => setUser(snap.exists() ? (snap.data() as User) : null),
      () => setUser(null),
    );
  }, [uid]);

  if (user === undefined) return <Spinner />;
  if (user === null || !uid) {
    return (
      <div className="mx-auto max-w-sheet px-4 py-10 text-center text-ink-soft">
        <p>Player not found.</p>
      </div>
    );
  }

  const badge = sourceBadge(user.handicap);
  const fresh = freshness(user.handicap.verifiedAt);

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav(-1)} className="btn-quiet mb-4 px-0">
        ← Back
      </button>

      <div className="flex items-center gap-4">
        {user.photoUrl ? (
          <img src={user.photoUrl} alt="" className="h-16 w-16 rounded-full border border-rule object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-rule bg-paper-sunken font-display text-xl text-ink-soft">
            {user.displayName.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl">{user.displayName}</h1>
          <p className="text-sm text-ink-faint">{user.marketId.toUpperCase()}</p>
        </div>
        {/* Follow = "tell me when they play again" — alerts on their posts. */}
        <div className="flex shrink-0 items-center gap-2">
          <FollowButton targetId={uid} />
          {fbUser && fbUser.uid !== uid && (
            <ReportBlockMenu
              targetType="user"
              targetId={uid}
              subjectUserId={uid}
              subjectName={user.displayName}
            />
          )}
        </div>
      </div>

      <Card className="mt-6 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display uppercase tracking-wide text-xs text-ink-faint">Handicap</p>
            <p className="mt-1 text-xl">
              <Num>{indexLine(user.handicap)}</Num>
            </p>
            <p className="mt-1">
              <Badge tone="tournament">Tier {tierFor(user.handicap.index).label}</Badge>
              <span className="ml-2 text-xs text-ink-faint">{tierFor(user.handicap.index).range}</span>
            </p>
          </div>
          <div className="text-right">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {user.handicap.verifiedAt && (
              <p className={`mt-1 text-xs ${fresh === 'fresh' ? 'text-fresh' : fresh === 'stale' ? 'text-stale' : 'text-ink-faint'}`}>
                Verified {formatTeeTime(user.handicap.verifiedAt)}
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <SectionHeader>Reliability</SectionHeader>
        <Reliability userId={uid} />
      </div>

      <div className="mt-6">
        <SectionHeader>Record</SectionHeader>
        <Record userId={uid} />
      </div>
    </div>
  );
}
