/**
 * Route host for a stroke-play tournament's leaderboard and its shareable card
 * (/tournaments/:id/leaderboard).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, SectionHeader } from '@/components/ui';
import { Leaderboard } from '@/features/leaderboard/Leaderboard';
import { ShareableLeaderboard } from '@/features/leaderboard/ShareableLeaderboard';

export function TournamentLeaderboardPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [showShare, setShowShare] = useState(false);
  if (!id) return null;
  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav(`/tournaments/${id}`)} className="btn-quiet mb-4 px-0">
        ← Tournament
      </button>
      <SectionHeader
        right={
          <Button variant="quiet" onClick={() => setShowShare((s) => !s)}>
            {showShare ? 'Hide card' : 'Share card'}
          </Button>
        }
      >
        Leaderboard
      </SectionHeader>

      {showShare && (
        <div className="mb-6">
          <ShareableLeaderboard tournamentId={id} />
        </div>
      )}

      <Leaderboard tournamentId={id} />
    </div>
  );
}
