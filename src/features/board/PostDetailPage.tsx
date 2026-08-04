/**
 * A single round post. Join/leave runs through a Cloud Function so slotsFilled
 * and joinedUserIds stay authoritative and blocks are enforced (§3, §5). Once a
 * player has joined they get the chat thread to coordinate.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { usePost } from './useRoundPosts';
import { joinRound, leaveRound } from '@/lib/callable';
import { ChatThread } from '@/features/chat/ChatThread';
import { ReportBlockMenu } from '@/features/moderation/ReportBlockMenu';
import { Badge, Button, Card, Num, Rule, Spinner } from '@/components/ui';
import { formatTeeTime, relativeDays } from '@/lib/format';

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
      </Card>

      {(isJoined || isOwner) && (
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
