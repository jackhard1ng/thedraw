/**
 * Stroke-play scorecard actions (gross foursome, multi-round stroke play).
 * Submit your own round score, and confirm a playing partner's — mirroring the
 * match-result confirmation flow, where silence auto-confirms (§P1). Writes go
 * through the submitRoundScore / confirmRoundScore callables.
 *
 * Cards are PRE-CREATED at the draw (that's where the stroke rule freezes), so
 * "may I submit?" is a question about the card's STATUS — awaitingResult means
 * the form; anything later means the read-only view.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Num, Rule } from '@/components/ui';
import { relativeDays } from '@/lib/format';
import { submitRoundScore, confirmRoundScore, disputeRoundScore } from '@/lib/callable';
import { useTournamentEntries, useTournamentScorecards } from '@/features/tournaments/useTournaments';

const CARD_STATUS_LABEL: Record<string, string> = {
  awaitingResult: 'Waiting on your score',
  awaitingConfirmation: 'Submitted — awaiting a partner’s confirmation',
  complete: 'Official',
  disputed: 'Disputed — on hold until an organizer rules',
  dnf: 'Did not finish',
};

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
  const entries = useTournamentEntries(tournamentId);

  const [rnd, setRnd] = useState(round);
  const [gross, setGross] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "My card" is the TEAM's card — matched by entry membership, not by the
  // card's userId (which is just the captain). The partner submits too.
  const myEntryId = useMemo(
    () => (entries ?? []).find((e) => uid && e.userIds.includes(uid))?.id ?? null,
    [entries, uid],
  );
  const myCard = useMemo(
    () => cards?.find((c) => c.entryId === myEntryId && c.round === rnd) ?? null,
    [cards, myEntryId, rnd],
  );

  const nameForEntry = (entryId: string) => {
    const e = (entries ?? []).find((x) => x.id === entryId);
    return e?.teamName || (e as { displayNames?: string[] } | undefined)?.displayNames?.join(' / ') || 'A partner';
  };

  // Cards I can vouch for: anyone else's card I didn't post, plus MY OWN card
  // when my group's scorekeeper (someone off my team) posted it — that's me
  // attesting the marker's numbers. Mirrors the server's canAttestCard.
  const myTeam = useMemo(
    () => (entries ?? []).find((e) => e.id === myEntryId)?.userIds ?? [],
    [entries, myEntryId],
  );
  const toConfirm = useMemo(
    () =>
      (cards ?? []).filter((c) => {
        if (c.status !== 'awaitingConfirmation' || !uid || c.submittedBy === uid) return false;
        if (c.entryId !== myEntryId) return true;
        const by = c.submittedBy as string | null | undefined;
        return !!by && by !== 'auto' && !myTeam.includes(by);
      }),
    [cards, uid, myEntryId, myTeam],
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

  const submittable = myCard != null && myCard.status === 'awaitingResult';

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

        {myCard == null ? (
          <p className="text-sm text-ink-faint">No scorecard for this round.</p>
        ) : submittable ? (
          <div className="space-y-3">
            {myCard.courseHandicap != null && (
              <p className="text-xs text-ink-soft">
                Your playing handicap for this round is{' '}
                <Num>{myCard.courseHandicap}</Num> (frozen at the draw) — submit
                gross; net is computed for you.
              </p>
            )}
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
        ) : (
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
              <span className="text-ink">{CARD_STATUS_LABEL[myCard.status] ?? myCard.status}</span>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
      </Card>

      {toConfirm.length > 0 && (
        <div>
          <p className="mb-2 font-display uppercase tracking-wide text-xs text-ink-soft">
            Confirm a card
          </p>
          <p className="mb-2 text-xs text-ink-faint">
            You're vouching that the score is right — you watched it happen, or
            it's your own card as your scorekeeper posted it.
          </p>
          <div className="space-y-2">
            {toConfirm.map((c) => (
              <ConfirmRow
                key={`${c.entryId}_${c.round}`}
                scorecardId={`${c.tournamentId}_${c.entryId}_${c.round}`}
                playerName={nameForEntry(c.entryId)}
                gross={c.gross}
                round={c.round}
                deadline={c.confirmDeadline?.toMillis() ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmRow({
  scorecardId,
  playerName,
  gross,
  round,
  deadline,
}: {
  scorecardId: string;
  playerName: string;
  gross: number;
  round: number;
  deadline: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="text-ink">
            {playerName} — R<Num>{round}</Num> · gross <Num>{gross}</Num>
          </span>
          {deadline && (
            <span className="ml-2 text-xs text-ink-faint">
              auto-confirms {relativeDays(new Date(deadline))}
            </span>
          )}
          {error && <p className="text-xs text-tournament">{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-ink-faint underline underline-offset-2"
            onClick={() => setDisputing((d) => !d)}
          >
            {disputing ? 'Cancel' : 'Dispute'}
          </button>
          <Button
            variant="ghost"
            disabled={busy || disputing}
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
        </div>
      </div>
      {disputing && (
        <div className="mt-3 space-y-2 border-t border-rule pt-3">
          <p className="text-xs text-ink-faint">
            Only flag a card you believe is wrong — it holds the event (and any
            payout) until an organizer rules. Say what's off.
          </p>
          <input
            className="field-input text-sm"
            placeholder="e.g. I had him at 6 on the 9th, not 5"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || !note.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await disputeRoundScore({ scorecardId, note: note.trim() });
                setDisputing(false);
                setNote('');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Filing…' : 'Flag this card for review'}
          </Button>
        </div>
      )}
    </Card>
  );
}
