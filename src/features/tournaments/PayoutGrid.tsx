/**
 * The payout grid — published before entries close (§7). Purses are a PERCENTAGE
 * of the prize fund, so every row shows its share; when a projected pool is known
 * we also project the dollar figure using the integer-cents largest-remainder
 * split from money.ts (no penny invented or lost). Shares across the whole table
 * must sum to 100 — we surface a loud warning if they don't.
 */
import { Num } from '@/components/ui';
import { formatCents, splitPurse } from '@/lib/money';
import type { Cents, PayoutRow } from '@/types/models';

const ORD: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };
function place(n: number): string {
  return ORD[n] ?? `${n}th`;
}

export function sharesSum(rows: PayoutRow[]): number {
  return rows.reduce((a, r) => a + r.sharePercent, 0);
}

export function PayoutGrid({
  rows,
  poolCents,
}: {
  rows: PayoutRow[];
  /** Projected prize fund; when given, each row projects a dollar figure. */
  poolCents?: Cents;
}) {
  const sum = sharesSum(rows);
  const off = Math.abs(sum - 100) > 0.001;
  const cents =
    poolCents != null ? splitPurse(poolCents, rows.map((r) => r.sharePercent)) : null;

  const divisions = Array.from(new Set(rows.map((r) => r.division)));

  return (
    <div>
      {divisions.map((div) => {
        const divRows = rows
          .map((r, i) => ({ r, i }))
          .filter((x) => x.r.division === div)
          .sort((a, b) => a.r.place - b.r.place);
        return (
          <div key={div} className="mb-4">
            <p className="mb-1 font-display uppercase tracking-wide text-xs text-ink-faint">
              {div} division
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink text-left font-display uppercase tracking-wide text-xs text-ink-soft">
                  <th className="py-1">Place</th>
                  <th className="py-1 text-right">Share</th>
                  {cents && <th className="py-1 text-right">Projected</th>}
                </tr>
              </thead>
              <tbody>
                {divRows.map(({ r, i }) => (
                  <tr key={`${div}-${r.place}`} className="border-b border-rule">
                    <td className="py-1.5 text-ink">{place(r.place)}</td>
                    <td className="py-1.5 text-right">
                      <Num>{r.sharePercent}%</Num>
                    </td>
                    {cents && (
                      <td className="py-1.5 text-right">
                        <Num>{formatCents(cents[i])}</Num>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-faint">Shares total</span>
        <Num className={off ? 'text-tournament' : 'text-pine'}>{sum}%</Num>
      </div>
      {off && (
        <p className="mt-1 rounded-sm border border-tournament/30 bg-tournament/10 p-2 text-xs text-tournament">
          Payout shares sum to {sum}%, not 100%. This table is invalid and would
          be rejected at publish.
        </p>
      )}
    </div>
  );
}
