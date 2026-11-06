/**
 * Another player's public card (/players/:uid) — built for one decision: "do I
 * want to play this person?" Everything here is the data the product WANTS
 * public between members: the number they play off and how well-sourced it is,
 * how they've actually played lately and for what, whether they show up, and
 * your own history with them. Nothing contact-related lives on the users doc,
 * so this page cannot leak what it never receives.
 *
 * Facts, never ratings: no star scores, no "sandbagger" labels (§8). A stranger
 * gets enough to judge for themselves.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge, Card, Num, SectionHeader, Spinner } from '@/components/ui';
import { FollowButton } from '@/features/spectating/FollowButton';
import { ReportBlockMenu } from '@/features/moderation/ReportBlockMenu';
import { useAuth } from '@/context/AuthContext';
import { formatIndex, freshness, indexLine, sourceBadge, tierFor } from '@/lib/handicap';
import { formatTeeTime } from '@/lib/format';
import { formatCents } from '@/lib/money';
import type { PlayerResult, ReputationEvent, Ts, User } from '@/types/models';

const shortDate = (ts: Ts | null | undefined) =>
  ts ? new Date(ts.toMillis()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const monthYear = (ts: Ts | null | undefined) =>
  ts ? new Date(ts.toMillis()).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';

/** One plain sentence on what the handicap badge actually means to a stranger. */
function sourceExplainer(user: User): string {
  const h = user.handicap;
  if (h.source === 'self') {
    return `Self-declared — they entered this number themselves; nobody has checked it. Updated ${shortDate(h.updatedAt ?? user.createdAt)}.`;
  }
  if (!h.verifiedAt) {
    return `${h.source === 'ghin' ? 'GHIN' : 'Linked record'} claimed, not yet checked by an organizer. Updated ${shortDate(h.updatedAt ?? user.createdAt)}.`;
  }
  return h.source === 'ghin'
    ? `An organizer matched this to their GHIN record on ${shortDate(h.verifiedAt)}.`
    : `An organizer checked their linked handicap record on ${shortDate(h.verifiedAt)}.`;
}

function Reliability({ user, userId }: { user: User; userId: string }) {
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
  // Everything shown is the last year — old flakes shouldn't follow forever.
  const now = Date.now();
  const live = events.filter((e) => !e.expiresAt || e.expiresAt.toMillis() > now);
  const count = (t: string) => live.filter((e) => e.type === t).length;
  const committed = count('committed');
  const played = count('played');
  const forfeits = count('forfeitNonResponse');
  const late = count('lateCancel');

  return (
    <div className="space-y-1 text-sm">
      {committed === 0 ? (
        <p className="text-ink-faint">New to The Draw — no committed rounds yet.</p>
      ) : (
        <p className="text-ink">
          Played <Num>{played}</Num> of <Num>{committed}</Num> committed rounds
        </p>
      )}
      <p className="text-ink-soft">
        <Num>{forfeits}</Num> forfeit{forfeits === 1 ? '' : 's'} · <Num>{late}</Num> late cancel
        {late === 1 ? '' : 's'} <span className="text-ink-faint">· last 12 months</span>
      </p>
      <p className="text-xs text-ink-faint">Member since {monthYear(user.createdAt)}</p>
    </div>
  );
}

function stakesLine(rs: PlayerResult[]): string | null {
  if (rs.length === 0) return null;
  const paid = rs.map((r) => r.perPlayerCents).filter((c) => c > 0).sort((a, b) => a - b);
  if (paid.length === 0) return 'Free games so far';
  const lo = paid[0];
  const hi = paid[paid.length - 1];
  const range = lo === hi ? formatCents(lo) : `${formatCents(lo)}–${formatCents(hi)}`;
  const free = rs.length - paid.length;
  if (free === 0) return `Usually plays for ${formatCents(paid[Math.floor(paid.length / 2)])}${lo !== hi ? ` (${range})` : ''}`;
  return `${paid.length} money game${paid.length === 1 ? '' : 's'} (${range}) · ${free} free`;
}

function RecentForm({ userId }: { userId: string }) {
  const [rows, setRows] = useState<PlayerResult[] | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, 'playerResults'),
      where('userId', '==', userId),
      orderBy('playedAt', 'desc'),
      limit(10),
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => d.data() as PlayerResult)),
      () => setRows([]),
    );
  }, [userId]);
  if (rows === null) return <Spinner />;
  if (rows.length === 0) return <p className="text-sm text-ink-faint">No completed games yet.</p>;
  const stakes = stakesLine(rows);
  return (
    <div>
      {stakes && <p className="mb-2 text-sm text-ink-soft">{stakes}</p>}
      <div className="divide-y divide-rule">
        {rows.slice(0, 5).map((r) => (
          <div key={r.tournamentId} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p
                className={`truncate ${
                  r.outcome === 'won' ? 'text-pine' : r.outcome === 'lost' ? 'text-tournament' : 'text-ink'
                }`}
              >
                {r.label}
                {r.gross != null && <span className="text-ink-faint"> · shot <Num>{r.gross}</Num></span>}
              </p>
              <p className="truncate text-xs text-ink-faint">
                {r.opponentNames.length > 0
                  ? `vs ${r.opponentNames
                      .map((n, i) => (r.opponentIndexes[i] != null ? `${n} (${formatIndex(r.opponentIndexes[i])})` : n))
                      .join(', ')}`
                  : r.tournamentName}{' '}
                · played off <Num>{formatIndex(r.indexAtEntry)}</Num> · {shortDate(r.playedAt)}
              </p>
            </div>
            <span className="shrink-0 text-right text-xs text-ink-faint">
              {r.perPlayerCents > 0 ? formatCents(r.perPlayerCents) : 'Free'}
              {r.wonCents != null && r.wonCents > 0 && (
                <span className="block text-pine">+{formatCents(r.wonCents)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "You're 2–1 against them" — only head-to-head matches count. */
function HeadToHead({ userId, viewerId }: { userId: string; viewerId: string }) {
  const [rows, setRows] = useState<PlayerResult[] | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, 'playerResults'),
      where('userId', '==', viewerId),
      where('opponentUserIds', 'array-contains', userId),
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => d.data() as PlayerResult)),
      () => setRows([]),
    );
  }, [userId, viewerId]);
  const record = useMemo(() => {
    const m = (rows ?? []).filter((r) => r.kind === 'match');
    return { w: m.filter((r) => r.outcome === 'won').length, l: m.filter((r) => r.outcome === 'lost').length, n: m.length };
  }, [rows]);
  if (!rows || record.n === 0) return null;
  return (
    <Card className="mt-4 p-3 text-sm">
      <span className="font-display uppercase tracking-wide text-xs text-ink-faint">You vs them</span>
      <span className="ml-2 text-ink">
        <Num>{record.w}</Num>–<Num>{record.l}</Num> in <Num>{record.n}</Num> match{record.n === 1 ? '' : 'es'}
      </span>
    </Card>
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

function Placements({ userId }: { userId: string }) {
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
  const tier = tierFor(user.tourIndex ?? user.handicap.index);
  const viewerId = fbUser?.uid ?? null;

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
          {viewerId && viewerId !== uid && (
            <ReportBlockMenu
              targetType="user"
              targetId={uid}
              subjectUserId={uid}
              subjectName={user.displayName}
            />
          )}
        </div>
      </div>

      {viewerId && viewerId !== uid && <HeadToHead userId={uid} viewerId={viewerId} />}

      <Card className="mt-6 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display uppercase tracking-wide text-xs text-ink-faint">Plays off</p>
            <p className="mt-1 text-xl">
              <Num>{indexLine(user.handicap, user.tourIndex)}</Num>
            </p>
            <p className="mt-1">
              <Badge tone="tournament">Tier {tier.label}</Badge>
              <span className="ml-2 text-xs text-ink-faint">{tier.range}</span>
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
        <p className="mt-3 border-t border-rule pt-2 text-xs text-ink-soft">{sourceExplainer(user)}</p>
        {user.tourIndex != null && (
          <p className="mt-1 text-xs text-ink-soft">
            Tour Index <Num>{formatIndex(user.tourIndex)}</Num> is set by an organizer from their play here —
            it's the number used when they enter competitions.
          </p>
        )}
      </Card>

      <div className="mt-6">
        <SectionHeader>Reliability</SectionHeader>
        <Reliability user={user} userId={uid} />
      </div>

      <div className="mt-6">
        <SectionHeader>Recent form</SectionHeader>
        <RecentForm userId={uid} />
      </div>

      <div className="mt-6">
        <SectionHeader>Placements</SectionHeader>
        <Placements userId={uid} />
      </div>
    </div>
  );
}
