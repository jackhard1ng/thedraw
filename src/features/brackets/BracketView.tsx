/**
 * Single-elimination bracket, rendered from `matches` docs in draw-sheet style
 * (spec §8): ruled rails, columns per round, each competitor line carrying the
 * player's name and their FROZEN index — shown every round, permanently, so a
 * later-round upset still reads at a glance. The winner's line is tournament red
 * and the margin ("3&2") sits at the end of it. Horizontally scrollable on
 * mobile. Round headers come from roundLabel().
 */
import { Num, Spinner } from '@/components/ui';
import { roundLabel } from '@/lib/education';
import {
  bracketSize,
  entriesRemainingAt,
  entryDisplay,
  useTournamentEntries,
  useTournamentMatches,
  useUsers,
  type EntryWithId,
  type MatchWithId,
} from '@/features/tournaments/useTournaments';
import type { User } from '@/types/models';

function Competitor({
  entryId,
  entries,
  users,
  isWinner,
  margin,
}: {
  entryId: string | null;
  entries: Record<string, EntryWithId>;
  users: Record<string, User>;
  isWinner: boolean;
  margin: string | null;
}) {
  const entry = entryId ? entries[entryId] : undefined;
  const info = entry ? entryDisplay(entry, users) : { name: 'TBD', index: NaN };
  return (
    <div
      className={`flex items-baseline justify-between gap-2 px-2 py-1 ${
        isWinner ? 'text-tournament font-semibold' : 'text-ink'
      }`}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm">{info.name}</span>
        {Number.isFinite(info.index) && (
          <Num className="shrink-0 text-xs text-ink-faint">
            {info.index.toFixed(1)}
          </Num>
        )}
      </span>
      {isWinner && margin && (
        <Num className="shrink-0 text-xs text-tournament">{margin}</Num>
      )}
    </div>
  );
}

function MatchCell({
  match,
  entries,
  users,
}: {
  match: MatchWithId;
  entries: Record<string, EntryWithId>;
  users: Record<string, User>;
}) {
  const winner = match.result.winnerEntryId;
  return (
    <div className="my-3 w-52 rounded-sm border border-rule bg-paper-raised">
      <Competitor
        entryId={match.entryIds[0]}
        entries={entries}
        users={users}
        isWinner={winner === match.entryIds[0]}
        margin={match.result.margin}
      />
      <div className="border-t border-rule" />
      <Competitor
        entryId={match.entryIds[1]}
        entries={entries}
        users={users}
        isWinner={winner === match.entryIds[1]}
        margin={match.result.margin}
      />
    </div>
  );
}

export function BracketView({ tournamentId }: { tournamentId: string }) {
  const matches = useTournamentMatches(tournamentId);
  const entryList = useTournamentEntries(tournamentId);
  const userIds = (entryList ?? []).flatMap((e) => e.userIds);
  const users = useUsers(userIds);

  if (matches === null || entryList === null) return <Spinner />;

  const entries: Record<string, EntryWithId> = {};
  entryList.forEach((e) => {
    entries[e.id] = e;
  });

  const size = bracketSize(entryList.length);
  const rounds = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b);

  if (rounds.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-rule-strong p-6 text-center text-sm text-ink-faint">
        The bracket hasn't been drawn yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-6">
        {rounds.map((round) => {
          const remaining = entriesRemainingAt(round, size);
          const roundMatches = matches
            .filter((m) => m.round === round)
            .sort((a, b) => a.id.localeCompare(b.id));
          return (
            <div key={round} className="flex min-w-52 flex-col justify-around">
              <p className="border-b border-ink pb-1 font-display uppercase tracking-wide text-xs text-ink-soft">
                {roundLabel(remaining)}
              </p>
              <div className="flex flex-1 flex-col justify-around">
                {roundMatches.map((m) => (
                  <MatchCell key={m.id} match={m} entries={entries} users={users} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
