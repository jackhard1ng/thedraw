/**
 * Live match-play scoring. The match's scorekeeper (default: the booker) enters
 * both players' gross hole-by-hole; everyone watches "2 up thru 7" (net) update.
 * "Finish" derives the net winner + margin and hands off to the existing confirm
 * flow (finalizeMatchScores → the opponent confirms or disputes). Any player can
 * claim scoring with one tap.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Num } from '@/components/ui';
import { useFormat, useTournament, type EntryWithId } from '@/features/tournaments/useTournaments';
import { claimScorekeeper, saveMatchHole, finalizeMatchScores } from '@/lib/callable';
import { netMatchState } from '@/lib/matchplay';
import type { Course, Match } from '@/types/models';

type MatchWithId = Match & { id: string };

export function MatchLiveScore({
  match,
  entries,
  course,
  nameOf,
}: {
  match: MatchWithId;
  entries: EntryWithId[];
  course: Course | null;
  nameOf: (entryId: string) => string;
}) {
  const { fbUser } = useAuth();
  const uid = fbUser?.uid;
  const { tournament } = useTournament(match.tournamentId);
  const format = useFormat(tournament?.formatId);

  const [a, b] = match.entryIds;
  const scratch = useMemo(() => {
    const ha = format?.handicapAllowance as { type?: string } | null | undefined;
    return !!ha && typeof ha === 'object' && ha.type === 'none';
  }, [format]);
  const totalHoles = format?.holes ?? course?.holePars?.length ?? 18;

  const chByEntry = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of entries) out[e.id] = scratch ? 0 : Math.round(e.combinedIndex ?? 0);
    return out;
  }, [entries, scratch]);

  const holes = (match.result?.holes as { hole: number; scores: Record<string, number> }[] | null) ?? [];
  const state = netMatchState(
    holes,
    match.entryIds,
    chByEntry,
    scratch ? null : course?.holeHandicapOrder ?? null,
    totalHoles,
  );

  const isKeeper = match.scorekeeperUid === uid;
  const inMatch = entries.some((e) => uid && e.userIds.includes(uid));

  const [hole, setHole] = useState(1);
  const [va, setVa] = useState('');
  const [vb, setVb] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leadLine =
    state.up === 0
      ? state.thru === 0
        ? 'Not started'
        : `All square thru ${state.thru}`
      : `${nameOf(state.up > 0 ? a : b)} ${Math.abs(state.up)} up thru ${state.thru}`;

  const grossThru = (eid: string) => holes.filter((h) => h.scores[eid] != null).length;
  const existingA = holes.find((h) => h.hole === hole)?.scores[a];
  const existingB = holes.find((h) => h.hole === hole)?.scores[b];

  async function saveHole() {
    setBusy(true);
    setError(null);
    try {
      const scores: Record<string, number> = {};
      if (va && Number(va) > 0) scores[a] = Number(va);
      if (vb && Number(vb) > 0) scores[b] = Number(vb);
      if (Object.keys(scores).length < 2) {
        setError('Enter both players for this hole.');
        setBusy(false);
        return;
      }
      await saveMatchHole({ matchId: match.id, hole, scores });
      setVa('');
      setVb('');
      if (hole < totalHoles) setHole(hole + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="font-display uppercase tracking-wide text-xs text-tournament">● Live scoring</p>
        {inMatch && !isKeeper && (
          <button
            className="text-xs text-ink-faint underline underline-offset-2"
            onClick={async () => {
              try {
                await claimScorekeeper({ scope: 'match', id: match.id });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Keep score
          </button>
        )}
      </div>

      <p className="mt-2 text-lg text-ink">{leadLine}</p>
      <div className="mt-2 flex gap-4 text-sm text-ink-faint">
        <span>
          {nameOf(a)} · thru <Num>{grossThru(a)}</Num>
        </span>
        <span>
          {nameOf(b)} · thru <Num>{grossThru(b)}</Num>
        </span>
      </div>

      {isKeeper && (
        <div className="mt-4 border-t border-rule pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-display uppercase tracking-wide text-xs text-ink-soft">Enter hole</span>
            <div className="flex items-center gap-2 text-sm">
              <button className="btn-quiet px-2" onClick={() => setHole(Math.max(1, hole - 1))} disabled={hole <= 1}>
                −
              </button>
              <span className="tnum w-6 text-center text-ink">{hole}</span>
              <button
                className="btn-quiet px-2"
                onClick={() => setHole(Math.min(totalHoles, hole + 1))}
                disabled={hole >= totalHoles}
              >
                +
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink">{nameOf(a)}</span>
              <input
                type="number"
                inputMode="numeric"
                className="field-input tnum w-16 px-2 py-1 text-center"
                placeholder={existingA ? String(existingA) : '–'}
                value={va}
                onChange={(e) => setVa(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink">{nameOf(b)}</span>
              <input
                type="number"
                inputMode="numeric"
                className="field-input tnum w-16 px-2 py-1 text-center"
                placeholder={existingB ? String(existingB) : '–'}
                value={vb}
                onChange={(e) => setVb(e.target.value)}
              />
            </div>
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
                setBusy(true);
                setError(null);
                try {
                  const r = await finalizeMatchScores({ matchId: match.id });
                  if (r.data?.margin) window.alert(`Result: ${r.data.margin}. Sent to your opponent to confirm.`);
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
          <p className="mt-2 text-xs text-ink-faint">
            Finish derives the net result and sends it to your opponent to confirm.
          </p>
        </div>
      )}
      {!isKeeper && (
        <p className="mt-3 border-t border-rule pt-3 text-xs text-ink-faint">
          {match.scorekeeperUid ? 'The scorekeeper is entering holes.' : 'No scorekeeper yet.'} Watch it update live.
        </p>
      )}
    </Card>
  );
}
