/**
 * Stroke-play scorecard actions (gross foursome, multi-round stroke play).
 * Submit your own round score, and confirm a playing partner's — mirroring the
 * match-result confirmation flow, where silence auto-confirms (§P1). Writes go
 * through the submitRoundScore / confirmRoundScore callables.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Num, Rule } from '@/components/ui';
import { relativeDays } from '@/lib/format';
import { submitRoundScore, confirmRoundScore } from '@/lib/callable';
import { useTournamentScorecards } from '@/features/tournaments/useTournaments';

export function StrokePlayScoreCard({
  tournamentId,
  round = 1,
}: {
  tournamentId: string;
  round?: number;
}) {
  const { fbUser } = useAuth();
  const uid = fbUser?.uid;
  const cards = useTournamentScorecards(tournamentId);

  const [rnd, setRnd] = useState(round);
  const [gross, setGross] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myCard = useMemo(
    () => cards?.find((c) => c.userId === uid && c.round === rnd) ?? null,
    [cards, uid, rnd],
  );

  // Partners' cards awaiting confirmation that I didn't submit.
  const toConfirm = useMemo(
    () =>
      (cards ?? []).filter(
        (c) => c.status === 'awaitingConfirmation' && c.userId !== uid && c.submittedBy !== uid,
      ),
    [cards, uid],
  );

  async function submit() {
    const g = Number(gross);
    if (!Number.isInteger(g) || g <= 0) {
      setError('Enter your gross strokes as a whole number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitRoundScore({
        tournamentId,
        round: rnd,
        gross: g,
        ...(photo.trim() ? { scorecardPhotoUrl: photo.trim() } : {}),
      });
      setGross('');
      setPhoto('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="font-display uppercase tracking-wide text-ink">Your card</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-faint">Round</span>
            <input
              type="number"
              min={1}
              className="field-input tnum w-16 px-2 py-1"
              value={rnd}
              onChange={(e) => setRnd(Math.max(1, Number(e.target.value)))}
            />
          </div>
        </div>

        <Rule className="my-3" />

        {myCard ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-soft">Gross</span>
              <Num className="text-lg text-ink">{myCard.gross}</Num>
            </div>
            {myCard.net != null && (
              <div className="flex justify-between">
                <span className="text-ink-soft">Net</span>
                <Num className="text-ink">{myCard.net}</Num>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-ink-soft">Status</span>
              <span className="text-ink">{myCard.status}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="number"
              className="field-input tnum"
              placeholder="Gross strokes, e.g. 84"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
            />
            <input
              className="field-input"
              placeholder="Scorecard photo URL (optional)"
              value={photo}
              onChange={(e) => setPhoto(e.target.value)}
            />
            <Button variant="primary" className="w-full" disabled={busy} onClick={submit}>
              {busy ? 'Submitting…' : `Submit round ${rnd} score`}
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
      </Card>

      {toConfirm.length > 0 && (
        <div>
          <p className="mb-2 font-display uppercase tracking-wide text-xs text-ink-soft">
            Confirm a partner's card
          </p>
          <div className="space-y-2">
            {toConfirm.map((c) => (
              <ConfirmRow key={`${c.entryId}_${c.round}`} scorecardId={`${c.tournamentId}_${c.entryId}_${c.round}`} gross={c.gross} round={c.round} deadline={c.confirmDeadline?.toMillis() ?? null} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmRow({
  scorecardId,
  gross,
  round,
  deadline,
}: {
  scorecardId: string;
  gross: number;
  round: number;
  deadline: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="flex items-center justify-between p-3">
      <div className="text-sm">
        <span className="text-ink">
          R<Num>{round}</Num> · gross <Num>{gross}</Num>
        </span>
        {deadline && (
          <span className="ml-2 text-xs text-ink-faint">
            auto-confirms {relativeDays(new Date(deadline))}
          </span>
        )}
        {error && <p className="text-xs text-tournament">{error}</p>}
      </div>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await confirmRoundScore({ scorecardId });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Confirm
      </Button>
    </Card>
  );
}
