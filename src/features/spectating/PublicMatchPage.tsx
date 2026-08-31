/**
 * Public, shareable match page (route /m/:id) — works for non-competitors. Shows
 * both players with their frozen indexes and verification, the round, the
 * scheduling deadline, and the result once it lands. A spectator can follow
 * either player from here (spec §5). This is a read-only view; no actions that
 * change the match.
 */
import { useParams } from 'react-router-dom';
import { formatIndex } from '@/lib/handicap';
import { Badge, Card, Num, Rule, Spinner } from '@/components/ui';
import { roundLabel } from '@/lib/education';
import { formatTeeTime, relativeDays } from '@/lib/format';
import {
  bracketSize,
  entriesRemainingAt,
  entryDisplay,
  useMatch,
  useTournament,
  useTournamentEntries,
  useUsers,
  type EntryWithId,
} from '@/features/tournaments/useTournaments';
import type { User } from '@/types/models';
import { FollowButton } from './FollowButton';

function PlayerBlock({
  entry,
  users,
  won,
}: {
  entry: EntryWithId | undefined;
  users: Record<string, User>;
  won: boolean;
}) {
  if (!entry) return <div className="text-ink-faint">TBD</div>;
  const info = entryDisplay(entry, users);
  return (
    <div className={`flex-1 ${won ? 'text-tournament' : 'text-ink'}`}>
      <p className="font-display uppercase tracking-wide text-lg">{info.name}</p>
      <p className="mt-1 text-sm text-ink-faint">
        Index <Num>{formatIndex(info.index)}</Num>
        {entry.flight ? ` · Flight ${entry.flight}` : ''}
      </p>
      {won && <Badge tone="tournament">Winner</Badge>}
      {/* Follow works only for singles entries (one userId). */}
      {entry.userIds.length === 1 && (
        <div className="mt-2">
          <FollowButton targetId={entry.userIds[0]} />
        </div>
      )}
    </div>
  );
}

export function PublicMatchPage() {
  const { id } = useParams();
  const { match, loading } = useMatch(id);
  const { tournament } = useTournament(match?.tournamentId);
  const entryList = useTournamentEntries(match?.tournamentId);
  const users = useUsers((entryList ?? []).flatMap((e) => e.userIds));

  if (loading) return <Spinner />;
  if (!match) {
    return (
      <div className="mx-auto max-w-sheet px-4 py-10 text-center text-ink-soft">
        <p>This match link is no longer valid.</p>
      </div>
    );
  }

  const twoEntries = (entryList ?? []).filter((e) => match.entryIds.includes(e.id));
  const e0 = twoEntries.find((e) => e.id === match.entryIds[0]);
  const e1 = twoEntries.find((e) => e.id === match.entryIds[1]);
  const size = bracketSize(entryList?.length ?? 2);
  const remaining = entriesRemainingAt(match.round, size);
  const winner = match.result.winnerEntryId;

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <div className="text-center">
        <p className="font-display uppercase tracking-widest text-xs text-ink-faint">
          The Draw{tournament ? ` · ${tournament.name}` : ''}
        </p>
        <h1 className="mt-1 text-2xl text-tournament">{roundLabel(remaining)}</h1>
      </div>

      <Card className="mt-6 p-5">
        <div className="flex items-start gap-3">
          <PlayerBlock entry={e0} users={users} won={winner === match.entryIds[0]} />
          <div className="px-2 pt-2 font-display text-ink-faint">vs</div>
          <PlayerBlock entry={e1} users={users} won={winner === match.entryIds[1]} />
        </div>

        <Rule className="my-4" />

        {match.status === 'complete' ? (
          <p className="text-center text-ink">
            <span className="font-display uppercase tracking-wide text-tournament">
              {winner ? entryDisplay(twoEntries.find((e) => e.id === winner)!, users).name : ''}
            </span>{' '}
            won <Num>{match.result.margin}</Num>
          </p>
        ) : match.status === 'scheduled' ? (
          <p className="text-center text-sm text-ink-soft">
            Tees off {formatTeeTime(match.scheduling.agreedTime)}
          </p>
        ) : match.status === 'scheduling' ? (
          <p className="text-center text-sm text-ink-soft">
            Scheduling · deadline {relativeDays(match.scheduling.deadline)}
          </p>
        ) : (
          <p className="text-center text-sm text-ink-faint">{match.status}</p>
        )}
      </Card>
    </div>
  );
}
