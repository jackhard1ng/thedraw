/**
 * The board — Phase 1's killer feature (spec §4). An empty board is a dead
 * product, so posting is one tap away and filters default to "show me joinable
 * rounds" rather than an empty strict query.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useBlockedIds } from '@/features/moderation/useBlocks';
import { Button, Spinner } from '@/components/ui';
import { RoundPostCard } from './RoundPostCard';
import { DrawCard } from './DrawCard';
import {
  applyFilters,
  DEFAULT_FILTERS,
  useMyRounds,
  useRoundPosts,
  type BoardFilters,
} from './useRoundPosts';

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-display uppercase tracking-wide transition-colors ${
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-rule-strong text-ink-soft hover:border-ink'
      }`}
    >
      {children}
    </button>
  );
}

export function BoardPage() {
  const { profile, fbUser } = useAuth();
  // profile is guaranteed non-null on this route (see App gating).
  const marketId = profile?.marketId ?? 'kc';
  const blockedIds = useBlockedIds(fbUser?.uid);

  const posts = useRoundPosts(marketId, blockedIds);
  const myRounds = useMyRounds(fbUser?.uid);
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS);

  const visible = useMemo(
    () => (posts ? applyFilters(posts, filters) : []),
    [posts, filters],
  );

  return (
    <div className="mx-auto max-w-sheet px-4 pb-28 pt-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl">The Board</h1>
      </div>

      {/* Your own upcoming rounds — a drawn group is created FULL, and the
          board's default filter hides full posts, so without this section your
          own Saturday game would be invisible. */}
      {myRounds && myRounds.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 font-display uppercase tracking-wide text-xs text-ink-soft">
            Your upcoming rounds
          </p>
          <div className="space-y-3">
            {myRounds.map((p) => (
              <RoundPostCard key={p.id} post={p} />
            ))}
          </div>
        </div>
      )}

      <DrawCard />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <FilterChip
          active={filters.bookedOnly}
          onClick={() => setFilters((f) => ({ ...f, bookedOnly: !f.bookedOnly }))}
        >
          Booked only
        </FilterChip>
        <FilterChip
          active={filters.vibe === 'competitive'}
          onClick={() =>
            setFilters((f) => ({
              ...f,
              vibe: f.vibe === 'competitive' ? 'all' : 'competitive',
            }))
          }
        >
          Competitive
        </FilterChip>
        <FilterChip
          active={filters.vibe === 'casual'}
          onClick={() =>
            setFilters((f) => ({ ...f, vibe: f.vibe === 'casual' ? 'all' : 'casual' }))
          }
        >
          Casual
        </FilterChip>
        <FilterChip
          active={filters.stakes === 'money'}
          onClick={() =>
            setFilters((f) => ({
              ...f,
              stakes: f.stakes === 'money' ? 'all' : 'money',
            }))
          }
        >
          Stakes
        </FilterChip>
        <FilterChip
          active={filters.openSlotsOnly}
          onClick={() =>
            setFilters((f) => ({ ...f, openSlotsOnly: !f.openSlotsOnly }))
          }
        >
          Open slots
        </FilterChip>
      </div>

      {posts === null ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <div className="rounded-sm border border-dashed border-rule-strong p-8 text-center">
          <p className="font-display uppercase tracking-wide text-ink-soft">
            Nothing on the board yet
          </p>
          <p className="mt-1 text-sm text-ink-faint">
            Post a tee time and someone will fill it.
          </p>
          <Link to="/post/new" className="mt-4 inline-block">
            <Button variant="primary">Post a round</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((p) => (
            <RoundPostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      {/* Floats ABOVE the bottom nav (nav is ~49px + safe-area at z-30) —
          the primary day-one action must never be half-covered by chrome. */}
      <Link
        to="/post/new"
        className="fixed inset-x-0 z-40 mx-auto block w-fit"
        style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      >
        <Button variant="primary" className="shadow-lg">
          + Post a round
        </Button>
      </Link>
    </div>
  );
}
