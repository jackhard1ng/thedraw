/**
 * Stroke-play leaderboard (grossFoursome, multiRoundStrokePlay). Rows are built
 * by useLeaderboard() from `entries` + `scorecards` and the pure helpers in
 * lib/leaderboard.ts, which return scores relative to par and T-prefixed ties.
 *
 * Two SEPARATE tables (spec §5): gross always, net when the tournament's
 * divisionMode includes net — never merged columns. Everything numeric is
 * monospace/tabular and right-aligned; the leader is bold. A THRU column shows
 * progress for events still underway, and each row carries its per-round
 * differential to index — the leaderboard's most interesting number and the
 * sandbagging signal (§4).
 */
import { Num, Spinner } from '@/components/ui';
import type { LbRow } from '@/lib/leaderboard';
import { useLeaderboard, type BuiltInput } from './useLeaderboard';

export function LbTable({
  rows,
  inputs,
  roundCount,
}: {
  rows: LbRow[];
  inputs: Map<string, BuiltInput>;
  roundCount: number;
}) {
  const rn = Array.from({ length: roundCount }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink text-left font-display uppercase tracking-wide text-xs text-ink-soft">
            <th className="py-1 pr-2">Pos</th>
            <th className="py-1 pr-2">Player</th>
            <th className="py-1 pr-2 text-right">Hcp</th>
            {rn.map((r) => (
              <th key={r} className="py-1 pr-2 text-right">
                R{r}
              </th>
            ))}
            <th className="py-1 pr-2 text-right">Thru</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inp = inputs.get(row.entryId);
            const leader = row.position === '1';
            return (
              <tr
                key={row.entryId}
                className={`border-b border-rule ${leader ? 'font-semibold text-ink' : 'text-ink'}`}
              >
                <td className="py-1.5 pr-2">
                  <Num>{row.position}</Num>
                </td>
                <td className="py-1.5 pr-2">
                  {row.name}
                  {inp?.provisional && (
                    <span className="ml-1 align-super text-[0.6rem] text-ink-faint" title="Includes a score awaiting confirmation">
                      *
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right align-top">
                  <Num>{row.index.toFixed(1)}</Num>
                </td>
                {rn.map((r) => {
                  const diff = inp?.diffs[r - 1];
                  return (
                    <td key={r} className="py-1.5 pr-2 text-right align-top">
                      <Num className="block leading-tight">{row.roundsToPar[r - 1] ?? '–'}</Num>
                      {/* differential to index — the sandbagging signal (§4) */}
                      {diff && (
                        <Num className="block text-[0.65rem] leading-tight text-ink-faint">
                          {diff}
                        </Num>
                      )}
                    </td>
                  );
                })}
                <td className="py-1.5 pr-2 text-right text-ink-faint">
                  <Num>{inp?.thru ?? '–'}</Num>
                </td>
                <td className="py-1.5 text-right">
                  <Num className={leader ? 'text-tournament' : ''}>{row.totalLabel}</Num>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Leaderboard({ tournamentId }: { tournamentId: string }) {
  const { ready, gross, net, showNet, roundCount, inputs } = useLeaderboard(tournamentId);
  if (!ready) return <Spinner />;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-2 border-b border-ink pb-1 text-lg">Gross</h2>
        <LbTable rows={gross} inputs={inputs} roundCount={roundCount} />
      </div>
      <p className="text-xs text-ink-faint">
        The small figure under each round is your differential — strokes above or
        below your index that round. An asterisk marks a score still awaiting a
        partner's confirmation.
      </p>
      {showNet && (
        <div>
          <h2 className="mb-2 border-b border-ink pb-1 text-lg">Net</h2>
          {net.length === 0 ? (
            <p className="text-sm text-ink-faint">
              No net scores yet — needs course handicaps from a supported course.
            </p>
          ) : (
            <LbTable rows={net} inputs={inputs} roundCount={roundCount} />
          )}
        </div>
      )}
    </div>
  );
}
