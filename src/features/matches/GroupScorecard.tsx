/**
 * Live group scorecard (stroke play). The group's scorekeeper enters everyone's
 * gross hole-by-hole; the rest of the group watches it fill and can take over
 * scoring with one tap. "Finish" posts each card into the normal confirm flow.
 *
 * Shown on /tournaments/:id/scorecard above the viewer's personal card.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Num } from '@/components/ui';
import {
  useScoreGroups,
  useTournamentEntries,
  useTournamentScorecards,
  useUsers,
  entryDisplay,
} from '@/features/tournaments/useTournaments';
import { claimScorekeeper, saveStrokeHole, finalizeGroup, postGroupTotals } from '@/lib/callable';

export function GroupScorecard({ tournamentId }: { tournamentId: string }) {
  const { fbUser } = useAuth();
  const uid = fbUser?.uid;
  const groups = useScoreGroups(tournamentId);
  const entries = useTournamentEntries(tournamentId);
  const cards = useTournamentScorecards(tournamentId);
  const users = useUsers((entries ?? []).flatMap((e) => e.userIds));

  const myEntryId = useMemo(
    () => (entries ?? []).find((e) => uid && e.userIds.includes(uid))?.id ?? null,
    [entries, uid],
  );
  const group = useMemo(
    () => (groups ?? []).find((g) => myEntryId && g.entryIds.includes(myEntryId)) ?? null,
    [groups, myEntryId],
  );

  const [hole, setHole] = useState(1);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [paper, setPaper] = useState(false);
  const [totals, setTotals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!group) return null; // no live group (e.g. match-play event, or not closed yet)

  const isKeeper = group.scorekeeperUid === uid;
  const holesOf = (entryId: string): number[] =>
    cards?.find((c) => c.entryId === entryId && c.round === group.round)?.holes ?? [];
  const nameOf = (entryId: string) => {
    const e = (entries ?? []).find((x) => x.id === entryId);
    return e ? entryDisplay(e, users).name : 'Player';
  };
  const grossOf = (entryId: string) => holesOf(entryId).filter((s) => s > 0).reduce((a, b) => a + b, 0);
  const thruOf = (entryId: string) => holesOf(entryId).filter((s) => s > 0).length;

  async function saveHole() {
    setBusy(true);
    setError(null);
    try {
      const scores: Record<string, number> = {};
      for (const eid of group!.entryIds) {
        const v = Number(vals[eid]);
        if (vals[eid] && Number.isInteger(v) && v > 0) scores[eid] = v;
      }
      if (Object.keys(scores).length === 0) {
        setError('Enter at least one score for this hole.');
        setBusy(false);
        return;
      }
      await saveStrokeHole({ groupId: group!.id, hole, scores });
      setVals({});
      if (hole < group!.holeCount) setHole(hole + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (group.status === 'closed') {
    return (
      <Card className="p-4">
        <p className="font-display uppercase tracking-wide text-xs text-ink-faint">Your group</p>
        <p className="mt-1 text-sm text-ink-soft">
          Cards are posted — confirm yours below. Final scores:
        </p>
        <div className="mt-2 divide-y divide-rule text-sm">
          {group.entryIds.map((eid) => (
            <div key={eid} className="flex justify-between py-1.5">
              <span className="text-ink">{nameOf(eid)}</span>
              <Num className="text-ink">{grossOf(eid) || '–'}</Num>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="font-display uppercase tracking-wide text-xs text-tournament">
          ● Live · your group
        </p>
        {!isKeeper && (
          <button
            className="text-xs text-ink-faint underline underline-offset-2"
            onClick={async () => {
              try {
                await claimScorekeeper({ scope: 'group', id: group.id });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Take over scoring
          </button>
        )}
      </div>

      {/* Running totals — everyone sees these update live. */}
      <div className="mt-3 divide-y divide-rule text-sm">
        {group.entryIds.map((eid) => (
          <div key={eid} className="flex items-center justify-between py-1.5">
            <span className="text-ink">{nameOf(eid)}</span>
            <span className="flex items-center gap-3 text-ink-faint">
              <span>
                thru <Num>{thruOf(eid)}</Num>
              </span>
              <Num className="text-ink">{grossOf(eid) || '–'}</Num>
            </span>
          </div>
        ))}
      </div>

      {isKeeper ? (
        <div className="mt-4 border-t border-rule pt-3">
          <div className="mb-3 flex gap-2 text-xs">
            <button
              className={`flex-1 rounded-sm border px-2 py-1 font-display uppercase tracking-wide ${!paper ? 'border-ink bg-ink text-paper' : 'border-rule-strong text-ink-soft'}`}
              onClick={() => setPaper(false)}
            >
              Hole by hole
            </button>
            <button
              className={`flex-1 rounded-sm border px-2 py-1 font-display uppercase tracking-wide ${paper ? 'border-ink bg-ink text-paper' : 'border-rule-strong text-ink-soft'}`}
              onClick={() => setPaper(true)}
            >
              Paper (totals)
            </button>
          </div>

          {!paper ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-display uppercase tracking-wide text-xs text-ink-soft">
                  Enter hole
                </span>
                <div className="flex items-center gap-2 text-sm">
                  <button
                    className="btn-quiet px-2"
                    onClick={() => setHole(Math.max(1, hole - 1))}
                    disabled={hole <= 1}
                  >
                    −
                  </button>
                  <span className="tnum w-6 text-center text-ink">{hole}</span>
                  <button
                    className="btn-quiet px-2"
                    onClick={() => setHole(Math.min(group.holeCount, hole + 1))}
                    disabled={hole >= group.holeCount}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {group.entryIds.map((eid) => {
                  const existing = holesOf(eid)[hole - 1];
                  return (
                    <div key={eid} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-ink">{nameOf(eid)}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={20}
                        className="field-input tnum w-16 px-2 py-1 text-center"
                        placeholder={existing ? String(existing) : '–'}
                        value={vals[eid] ?? ''}
                        onChange={(e) => setVals((v) => ({ ...v, [eid]: e.target.value }))}
                      />
                    </div>
                  );
                })}
              </div>
              {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
              <div className="mt-3 flex gap-2">
                <Button variant="primary" className="flex-1" disabled={busy} onClick={saveHole}>
                  {busy ? 'Saving…' : `Save hole ${hole}`}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm('Post everyone’s card? Players then confirm their own.')) return;
                    setBusy(true);
                    setError(null);
                    try {
                      await finalizeGroup({ groupId: group.id });
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Finish
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-faint">
                Played on paper? Enter each player’s final total — they confirm it
                the same way.
              </p>
              <div className="space-y-2">
                {group.entryIds.map((eid) => (
                  <div key={eid} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink">{nameOf(eid)}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="field-input tnum w-20 px-2 py-1 text-center"
                      placeholder="total"
                      value={totals[eid] ?? ''}
                      onChange={(e) => setTotals((v) => ({ ...v, [eid]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
              <Button
                variant="primary"
                className="mt-3 w-full"
                disabled={busy}
                onClick={async () => {
                  const t: Record<string, number> = {};
                  for (const eid of group.entryIds) {
                    const n = Number(totals[eid]);
                    if (totals[eid] && Number.isInteger(n) && n > 0) t[eid] = n;
                  }
                  if (Object.keys(t).length === 0) {
                    setError('Enter at least one total.');
                    return;
                  }
                  if (!confirm('Post these totals? Players then confirm their own.')) return;
                  setBusy(true);
                  setError(null);
                  try {
                    await postGroupTotals({ groupId: group.id, totals: t });
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Posting…' : 'Post totals'}
              </Button>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 border-t border-rule pt-3 text-xs text-ink-faint">
          {nameOf((entries ?? []).find((e) => e.userIds.includes(group.scorekeeperUid))?.id ?? '') ||
            'The scorekeeper'}{' '}
          is keeping score. Watch it update, or take over above.
        </p>
      )}
    </Card>
  );
}
