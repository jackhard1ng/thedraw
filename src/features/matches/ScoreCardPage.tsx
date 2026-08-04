/**
 * Route host for a competitor's stroke-play scorecard
 * (/tournaments/:id/scorecard).
 */
import { useNavigate, useParams } from 'react-router-dom';
import { SectionHeader } from '@/components/ui';
import { StrokePlayScoreCard } from './StrokePlayScoreCard';

export function ScoreCardPage() {
  const { id } = useParams();
  const nav = useNavigate();
  if (!id) return null;
  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav(`/tournaments/${id}/leaderboard`)} className="btn-quiet mb-4 px-0">
        ← Leaderboard
      </button>
      <SectionHeader>Your scorecard</SectionHeader>
      <StrokePlayScoreCard tournamentId={id} />
    </div>
  );
}
