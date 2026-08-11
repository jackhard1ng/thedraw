/**
 * Single-elimination bracket in draw-sheet style (spec §8): ruled rails carry
 * the structure, columns per round, each competitor line printing the player's
 * name and their FROZEN index — shown every round, permanently, so a later-round
 * upset still reads at a glance. The winner's line is tournament red and the
 * margin ("3&2") sits at the end of it. Horizontally scrollable on mobile.
 *
 * The data component (`BracketView`) resolves matches/entries/users; the
 * presentational board (`BracketBoard`) is pure so it can be previewed with mock
 * data. Matches are ordered numerically by their `_m{index}` id (not
 * lexically — otherwise m10 sorts before m2), and adjacent matches are paired so
 * the rails connect each pair into the next round.
 */
import { Link } from 'react-router-dom';
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

function matchIndex(id: string): number {
  const m = id.match(/_m(\d+)$/);
  return m ? Number(m[1]) : 0;
}

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
      className={`flex items-baseline justify-between gap-2 px-2 py-1.5 ${
        isWinner ? 'font-semibold text-tournament' : entry ? 'text-ink' : 'text-ink-faint'
      }`}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm">{info.name}</span>
        {Number.isFinite(info.index) && (
          <Num className="shrink-0 text-xs text-ink-faint">{info.index.toFixed(1)}</Num>
        )}
      </span>
      {isWinner && margin && <Num className="shrink-0 text-xs text-tournament">{margin}</Num>}
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
  // Every cell is a door to the match page — scheduling, chat, and results all
  // live there, and a bracket you can't tap is a bracket nobody can act on.
  return (
    <Link
      to={`/matches/${match.id}`}
      className="block w-56 rounded-sm border border-rule-strong bg-paper-raised shadow-sm transition-colors hover:border-tournament"
    >
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
    </Link>
  );
}

/** Pure, presentational — feed it matches + resolved entries/users. */
export function BracketBoard({
  matches,
  entries,
  users,
  size,
}: {
  matches: MatchWithId[];
  entries: Record<string, EntryWithId>;
  users: Record<string, User>;
  size: number;
}) {
  const rounds = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b);
  if (rounds.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-rule-strong p-6 text-center text-sm text-ink-faint">
        The bracket hasn't been drawn yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex items-stretch">
        {rounds.map((round, ri) => {
          const isLast = ri === rounds.length - 1;
          const roundMatches = matches
            .filter((m) => m.round === round)
            .sort((a, b) => matchIndex(a.id) - matchIndex(b.id));
          // Pair adjacent matches — each pair feeds one match in the next round.
          const pairs: MatchWithId[][] = [];
          for (let i = 0; i < roundMatches.length; i += 2) {
            pairs.push(roundMatches.slice(i, i + 2));
          }

          return (
            <div key={round} className="flex flex-col">
              <p className="mb-2 border-b border-ink pb-1 pl-2 font-display uppercase tracking-widest text-xs text-ink-soft">
                {roundLabel(entriesRemainingAt(round, size))}
              </p>
              <div className="flex flex-1 flex-col justify-around">
                {pairs.map((pair, pi) => (
                  <div
                    key={pi}
                    className={
                      // The pair wrapper reserves a 40px gutter and draws the
                      // vertical spine (25%–75%) plus the horizontal line from the
                      // spine's midpoint into the next round. Skipped in the final.
                      isLast
                        ? 'relative flex flex-col justify-around'
                        : 'relative flex flex-col justify-around pr-10 ' +
                          'after:absolute after:right-[20px] after:top-1/4 after:bottom-1/4 after:w-px after:bg-rule-strong ' +
                          'before:absolute before:right-0 before:top-1/2 before:h-px before:w-[20px] before:bg-rule-strong'
                    }
                  >
                    {pair.map((m) => (
                      <div
                        key={m.id}
                        className={
                          isLast
                            ? 'py-3'
                            : // horizontal stub from each match's center to the spine
                              'relative py-3 after:absolute after:left-full after:top-1/2 after:h-px after:w-[20px] after:bg-rule-strong'
                        }
                      >
                        <MatchCell match={m} entries={entries} users={users} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BracketView({ tournamentId }: { tournamentId: string }) {
  const matches = useTournamentMatches(tournamentId);
  const entryList = useTournamentEntries(tournamentId);
  const users = useUsers((entryList ?? []).flatMap((e) => e.userIds));

  if (matches === null || entryList === null) return <Spinner />;

  const entries: Record<string, EntryWithId> = {};
  entryList.forEach((e) => {
    entries[e.id] = e;
  });

  return (
    <BracketBoard
      matches={matches}
      entries={entries}
      users={users}
      size={bracketSize(entryList.length)}
    />
  );
}
