/**
 * A single board listing. Dense, scannable, draw-sheet aligned (§8). The card
 * leads with when + where + slots — the three things that decide a join.
 */
import { Link } from 'react-router-dom';
import { Badge, Card, Num } from '@/components/ui';
import { formatTeeTime, relativeDays } from '@/lib/format';
import type { PostWithId } from './useRoundPosts';

const VIBE_LABEL: Record<string, string> = {
  casual: 'Casual',
  competitive: 'Competitive',
  open: 'Any vibe',
};
const FORMAT_LABEL: Record<string, string> = {
  justGolf: 'Just golf',
  singlesMatch: 'Singles match',
  twoVTwo: '2v2',
  skins: 'Skins',
  open: 'Open format',
};

function timingLabel(p: PostWithId): string {
  const { mode, fixedTime, windowStart, flexibleDays } = p.timing;
  if (mode === 'fixed') return formatTeeTime(fixedTime);
  if (mode === 'window') return `Window from ${formatTeeTime(windowStart)}`;
  if (mode === 'flexible' && flexibleDays?.length) {
    return `Flexible · ${flexibleDays.map((d) => d[0].toUpperCase() + d.slice(1, 3)).join(', ')}`;
  }
  return 'Flexible timing';
}

export function RoundPostCard({ post }: { post: PostWithId }) {
  const full = post.slotsFilled >= post.slotsTotal;
  return (
    <Card className="p-4">
      <Link to={`/post/${post.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display uppercase tracking-wide text-ink">
              {post.title || timingLabel(post)}
            </p>
            {post.title && (
              <p className="text-sm text-ink-soft">{timingLabel(post)}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {post.booking === 'booked' ? (
              <Badge tone="tournament">Booked</Badge>
            ) : (
              <Badge tone="neutral">Needs booking</Badge>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>
            <Num>{post.slotsFilled}</Num>/<Num>{post.slotsTotal}</Num> filled
          </span>
          {post.vibe !== 'open' && <span>{VIBE_LABEL[post.vibe]}</span>}
          {post.format !== 'open' && post.format !== 'justGolf' && (
            <span>{FORMAT_LABEL[post.format]}</span>
          )}
          {post.stakes === 'money' && <span className="text-pine">Stakes welcome</span>}
          {post.hosting?.isMemberHosted && <Badge tone="neutral">Member-hosted</Badge>}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-rule pt-2 text-xs text-ink-faint">
          <span>Posted {relativeDays(post.createdAt)}</span>
          {full ? (
            <span className="font-display uppercase tracking-wide text-ink-faint">
              Full
            </span>
          ) : (
            <span className="font-display uppercase tracking-wide text-tournament">
              {post.slotsTotal - post.slotsFilled} open →
            </span>
          )}
        </div>
      </Link>
    </Card>
  );
}
