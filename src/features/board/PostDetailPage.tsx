/**
 * A single round post. Join/leave runs through a Cloud Function so slotsFilled
 * and joinedUserIds stay authoritative and blocks are enforced (§3, §5). Once a
 * player has joined they get the chat thread to coordinate.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { usePost } from './useRoundPosts';
import { attestRound, confirmTeeTime, joinRound, leaveRound } from '@/lib/callable';
import type { Round } from '@/types/models';
import { PlacesAutocomplete, type CoursePick } from '@/features/courses/PlacesAutocomplete';
import { ChatThread } from '@/features/chat/ChatThread';
import { ReportBlockMenu } from '@/features/moderation/ReportBlockMenu';
import { Badge, Button, Card, Num, Rule, Spinner } from '@/components/ui';
import { formatTeeTime, relativeDays } from '@/lib/format';

/**
 * After the tee time passes, the post completes and this section runs the
 * attestation funnel (§P3): each player logs a score; a groupmate attests it.
 * Attested rounds count toward money-event eligibility.
 */
function GroupScores({
  postId,
  placeId,
  uid,
  inGroup,
}: {
  postId: string;
  placeId: string | null;
  uid: string | undefined;
  inGroup: boolean;
}) {
  const [rounds, setRounds] = useState<(Round & { id: string })[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query(collection(db, 'rounds'), where('roundPostId', '==', postId));
    return onSnapshot(q, (snap) =>
      setRounds(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Round) }))),
    );
  }, [postId]);

  const mine = rounds.find((r) => r.userId === uid);

  return (
    <Card className="p-4">
      <p className="mb-1 font-display uppercase tracking-wide text-sm text-ink">
        Group scores
      </p>
      <p className="mb-3 text-xs text-ink-faint">
        Attested rounds count toward money-event eligibility — vouch for the
        scores you watched happen.
      </p>
      {rounds.length === 0 && (
        <p className="text-sm text-ink-faint">No scores logged yet.</p>
      )}
      <div className="divide-y divide-rule">
        {rounds.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-ink">
              <Num className="text-lg">{r.totalScore}</Num>
              <span className="ml-2 text-ink-faint">({r.holes} holes)</span>
            </span>
            {r.source === 'attested' ? (
              <Badge tone="fresh">Attested</Badge>
            ) : inGroup && r.userId !== uid ? (
              <Button
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={async () => {
                  setError(null);
                  try {
                    await attestRound({ roundId: r.id });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Attest
              </Button>
            ) : (
              <Badge tone="expired">Unattested</Badge>
            )}
          </div>
        ))}
      </div>
      {inGroup && !mine && (
        <Link
          to={`/rounds/new?postId=${postId}${placeId ? `&placeId=${placeId}` : ''}`}
          className="mt-3 block"
        >
          <Button variant="primary" className="w-full">
            Log my score
          </Button>
        </Link>
      )}
      {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
    </Card>
  );
}

/**
 * The booker locks in the real tee time. Flips the post to booked/fixed and
 * SMS-notifies everyone in the group — "chat says 7:40" becomes official.
 */
function ConfirmTeeTime({ postId, hasCourse }: { postId: string; hasCourse: boolean }) {
  const [openForm, setOpenForm] = useState(false);
  const [when, setWhen] = useState('');
  const [course, setCourse] = useState<CoursePick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!openForm) {
    return (
      <Button variant="primary" className="mt-4 w-full" onClick={() => setOpenForm(true)}>
        Confirm the tee time
      </Button>
    );
  }

  async function submit() {
    const ms = new Date(when).getTime();
    if (!when || Number.isNaN(ms)) {
      setError('Pick a date and time.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmTeeTime({
        postId,
        teeTime: ms,
        placeId: course?.placeId ?? null,
        courseName: course?.name ?? null,
      });
      setOpenForm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-sm border border-rule bg-paper-sunken p-3">
      <p className="mb-2 text-sm text-ink">
        Lock it in — everyone in the group gets a text.
      </p>
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="w-full rounded-sm border border-rule-strong bg-paper px-3 py-2 text-sm text-ink"
      />
      {!hasCourse && (
        <div className="mt-2">
          <PlacesAutocomplete onSelect={setCourse} />
          {course && <p className="mt-1 text-sm text-pine">Selected: {course.name}</p>}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" className="flex-1" disabled={busy} onClick={submit}>
          {busy ? '…' : 'Confirm tee time'}
        </Button>
        <Button variant="ghost" onClick={() => setOpenForm(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
    </div>
  );
}

export function PostDetailPage() {
  const { postId } = useParams();
  const { fbUser } = useAuth();
  const nav = useNavigate();
  const { post, loading } = usePost(postId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Spinner />;
  if (!post) {
    return (
      <div className="mx-auto max-w-sheet px-4 py-10 text-center text-ink-soft">
        <p>This round is no longer on the board.</p>
        <Button variant="ghost" className="mt-4" onClick={() => nav('/')}>
          Back to the board
        </Button>
      </div>
    );
  }

  const uid = fbUser?.uid;
  const isOwner = post.createdBy === uid;
  const isJoined = !!uid && post.joinedUserIds.includes(uid);
  const full = post.slotsFilled >= post.slotsTotal;

  async function toggleJoin() {
    if (!postId) return;
    setBusy(true);
    setError(null);
    try {
      if (isJoined) await leaveRound({ postId });
      else await joinRound({ postId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const timing =
    post.timing.mode === 'fixed'
      ? formatTeeTime(post.timing.fixedTime)
      : post.timing.mode === 'window'
        ? `From ${formatTeeTime(post.timing.windowStart)}`
        : `Flexible · ${post.timing.flexibleDays?.join(', ') ?? ''}`;

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav('/')} className="btn-quiet mb-4 px-0">
        ← Board
      </button>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl">{post.title || timing}</h1>
            {post.title && <p className="mt-1 text-ink-soft">{timing}</p>}
          </div>
          {!isOwner && (
            <ReportBlockMenu
              targetType="post"
              targetId={post.id}
              subjectUserId={post.createdBy}
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {post.booking === 'booked' ? (
            <Badge tone="tournament">Booked</Badge>
          ) : (
            <Badge tone="neutral">Needs booking</Badge>
          )}
          {post.vibe !== 'open' && <Badge>{post.vibe}</Badge>}
          {post.stakes === 'money' && <Badge tone="neutral">Stakes welcome</Badge>}
          {post.format !== 'open' && <Badge>{post.format}</Badge>}
          {post.hosting?.isMemberHosted && <Badge tone="neutral">Member-hosted</Badge>}
        </div>

        {post.description && (
          <p className="mt-4 whitespace-pre-wrap text-ink-soft">{post.description}</p>
        )}

        {post.stakes === 'money' && (
          <p className="mt-4 rounded-sm border border-rule bg-paper-sunken p-3 text-xs text-ink-soft">
            This game has player-arranged stakes — settled between players, The
            Draw touches none of it. Want it guaranteed?{' '}
            <Link to="/tournaments/new-game" className="text-tournament underline underline-offset-2">
              Make it an official match
            </Link>{' '}
            — entries collected up front, winner paid automatically.
          </p>
        )}

        <Rule className="my-4" />

        <div className="flex items-center justify-between">
          <div className="text-sm text-ink-soft">
            <Num className="text-lg text-ink">{post.slotsFilled}</Num>
            <span className="text-ink-faint"> / </span>
            <Num className="text-lg text-ink">{post.slotsTotal}</Num> filled
            <p className="text-xs text-ink-faint">Posted {relativeDays(post.createdAt)}</p>
          </div>
          {isOwner ? (
            <Badge tone="neutral">Your post</Badge>
          ) : (
            <Button
              variant={isJoined ? 'ghost' : 'primary'}
              disabled={busy || (!isJoined && full)}
              onClick={toggleJoin}
            >
              {isJoined ? 'Leave' : full ? 'Full' : busy ? '…' : 'Join this round'}
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-tournament">{error}</p>}

        {isOwner &&
          post.booking === 'needsBooking' &&
          (post.status === 'open' || post.status === 'full') && (
            <ConfirmTeeTime postId={post.id} hasCourse={!!post.course.placeId} />
          )}
      </Card>

      {post.status === 'completed' && (
        <div className="mt-6">
          <GroupScores
            postId={post.id}
            placeId={post.course.placeId}
            uid={uid}
            inGroup={isJoined || isOwner}
          />
        </div>
      )}

      {(isJoined || isOwner) && post.status !== 'completed' && (
        <div className="mt-6">
          <h2 className="mb-2 text-lg">Coordinate</h2>
          <Card className="p-4">
            <ChatThread threadId={post.id} />
          </Card>
        </div>
      )}
    </div>
  );
}
