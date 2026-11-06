/**
 * Route host for a tournament's bracket (/tournaments/:id/bracket).
 */
import { useNavigate, useParams } from 'react-router-dom';
import { SectionHeader } from '@/components/ui';
import { BracketView } from '@/features/brackets/BracketView';

export function TournamentBracketPage() {
  const { id } = useParams();
  const nav = useNavigate();
  if (!id) return null;
  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav(`/tournaments/${id}`)} className="btn-quiet mb-4 px-0">
        ← Tournament
      </button>
      <SectionHeader>Bracket</SectionHeader>
      <BracketView tournamentId={id} />
    </div>
  );
}
