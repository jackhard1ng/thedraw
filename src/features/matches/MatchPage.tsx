/**
 * The competitor's match hub. The auto-generated PRE-MATCH EDUCATION CARD sits at
 * the top (spec §5 — the highest-leverage retention feature): who, the indexes,
 * how many strokes fall and where, and the match-play primer. Below it the
 * scheduling / result state machine is driven entirely by `match.status`:
 *
 *   scheduling         → multi-date availability + 48h deadline + extension
 *   scheduled          → agreed time/place, then submit the result
 *   awaitingResult     → submit the result
 *   awaitingConfirmation → the other party confirms or disputes (silence = auto)
 *   complete/forfeited/voidedWeather → the outcome
 *
 * Reads are realtime; every state transition goes through a callable so the
 * ladder stays deterministic and authoritative (§5).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import {
  Badge,
  Button,
  Card,
  Num,
  Rule,
  SectionHeader,
  Spinner,
} from '@/components/ui';
import { preMatchCard } from '@/lib/education';
import { formatTeeTime, relativeDays } from '@/lib/format';
import {
  submitAvailability,
  requestExtension,
  setAgreedTime,
  submitResult,
  confirmResult,
  disputeResult,
  cancelScheduledMatch,
  collectGreenFees,
} from '@/lib/callable';
import { dollarsToCents, formatCents } from '@/lib/money';
import { ChatThread } from '@/features/chat/ChatThread';
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
import type { Course } from '@/types/models';

/** The committee copy (spec §4 disputes) — shown wherever a result is in play. */
function CommitteeNote() {
  return (
    <p className="rounded-sm border border-rule bg-paper-sunken p-3 text-xs text-ink-soft">
      You and your opponent are the committee. Agree the result between you. If you
      can't, either of you can dispute it and an organizer rules — but a disputed
      result costs both players time, so settle it on the course when you can.
    </p>
  );
}

function AvailabilityPicker({
  matchId,
  onError,
}: {
  matchId: string;
  onError: (m: string | null) => void;
}) {
  const [dates, setDates] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (dates.length === 0) return;
    setBusy(true);
    onError(null);
    try {
      await submitAvailability({ matchId, dates: dates.map((d) => new Date(d).getTime()) });
      setDates([]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="datetime-local"
          className="field-input tnum"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          variant="ghost"
          onClick={() => {
            if (draft && !dates.includes(draft)) setDates((d) => [...d, draft].sort());
            setDraft('');
          }}
        >
          Add
        </Button>
      </div>
      {dates.length > 0 && (
        <ul className="space-y-1">
          {dates.map((d) => (
            <li key={d} className="flex items-center justify-between text-sm">
              <span className="text-ink">{formatTeeTime(new Date(d))}</span>
              <button
                className="text-tournament underline"
                onClick={() => setDates((x) => x.filter((v) => v !== d))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="primary" className="w-full" disabled={busy || dates.length === 0} onClick={submit}>
        {busy ? 'Submitting…' : 'Submit availability'}
      </Button>
    </div>
  );
}

function ResultForm({
  matchId,
  entries,
  nameOf,
  onError,
}: {
  matchId: string;
  entries: EntryWithId[];
  nameOf: (entryId: string) => string;
  onError: (m: string | null) => void;
}) {
  const [winner, setWinner] = useState<string>('');
  const [margin, setMargin] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!winner || !margin) return;
    setBusy(true);
    onError(null);
    try {
      await submitResult({
        matchId,
        winnerEntryId: winner,
        margin: margin.trim(),
        ...(photo.trim() ? { scorecardPhotoUrl: photo.trim() } : {}),
      });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setWinner(e.id)}
            className={`btn ${
              winner === e.id ? 'bg-tournament text-paper' : 'border border-rule-strong text-ink'
            }`}
          >
            {nameOf(e.id)}
          </button>
        ))}
      </div>
      <input
        className="field-input tnum"
        placeholder='Margin, e.g. "3&2" or "1 up"'
        value={margin}
        onChange={(e) => setMargin(e.target.value)}
      />
      <input
        className="field-input"
        placeholder="Scorecard photo URL (optional)"
        value={photo}
        onChange={(e) => setPhoto(e.target.value)}
      />
      <Button variant="primary" className="w-full" disabled={busy || !winner || !margin} onClick={submit}>
        {busy ? 'Submitting…' : 'Submit result'}
      </Button>
    </div>
  );
}

function ConfirmDispute({ matchId, onError }: { matchId: string; onError: (m: string | null) => void }) {
  const [note, setNote] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Your opponent submitted the result. Confirm it, or dispute it. Silence
        auto-confirms in 48 hours.
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            onError(null);
            try {
              await confirmResult({ matchId });
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm
        </Button>
        <Button variant="ghost" className="flex-1" onClick={() => setShowDispute((s) => !s)}>
          Dispute
        </Button>
      </div>
      {showDispute && (
        <div className="space-y-2">
          <textarea
            className="field-input min-h-20"
            placeholder="What's wrong with this result?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="ghost"
            className="w-full"
            disabled={busy || !note.trim()}
            onClick={async () => {
              setBusy(true);
              onError(null);
              try {
                await disputeResult({ matchId, note: note.trim() });
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Submit dispute
          </Button>
        </div>
      )}
    </div>
  );
}

export function MatchPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { fbUser } = useAuth();
  const { match, loading } = useMatch(id);
  const { tournament } = useTournament(match?.tournamentId);
  const entryList = useTournamentEntries(match?.tournamentId);
  const users = useUsers((entryList ?? []).flatMap((e) => e.userIds));
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);

  const placeId = match?.scheduling.placeId ?? null;
  useEffect(() => {
    if (!placeId) {
      setCourse(null);
      return;
    }
    getDoc(doc(db, 'courses', placeId))
      .then((s) => setCourse(s.exists() ? (s.data() as Course) : null))
      .catch(() => setCourse(null));
  }, [placeId]);

  if (loading || !match) {
    return loading ? (
      <Spinner />
    ) : (
      <div className="mx-auto max-w-sheet px-4 py-10 text-center text-ink-soft">
        <p>Match not found.</p>
      </div>
    );
  }

  const uid = fbUser?.uid;
  const twoEntries = (entryList ?? []).filter((e) => match.entryIds.includes(e.id));
  const myEntry = twoEntries.find((e) => uid && e.userIds.includes(uid));
  const youEntry = myEntry ?? twoEntries[0];
  const oppEntry = twoEntries.find((e) => e.id !== youEntry?.id) ?? twoEntries[1];

  const you = youEntry ? entryDisplay(youEntry, users) : { name: 'You', index: 0 };
  const opp = oppEntry ? entryDisplay(oppEntry, users) : { name: 'Opponent', index: 0 };

  const size = bracketSize(entryList?.length ?? 2);
  const remaining = entriesRemainingAt(match.round, size);

  const card = preMatchCard({
    entriesRemaining: remaining,
    youName: you.name,
    oppName: opp.name,
    youIndex: you.index,
    oppIndex: opp.index,
    courseName: course?.name ?? null,
    holeHandicapOrder: course?.holeHandicapOrder ?? null,
    teeSets: course?.teeSets ?? null,
  });

  const log = match.scheduling.availabilityLog;
  const submittedEntryIds = new Set(log.map((l) => l.entryId));
  const quiet = match.entryIds.filter((eid) => !submittedEntryIds.has(eid));
  // The server gates ONE extension per tournament (on the entry), not per
  // match — mirroring that here keeps the button from appearing in round 2
  // only to error on tap.
  const myExtensionUsed = youEntry
    ? ((youEntry as { extensionUsed?: boolean }).extensionUsed ?? false)
    : true;

  // Overlapping days between the two availability logs → candidate agreed times.
  const overlapTimes: number[] = (() => {
    if (log.length < 2) return [];
    const byEntry = new Map<string, number[]>();
    log.forEach((l) => byEntry.set(l.entryId, l.dates.map((d) => d.toMillis())));
    const [a, b] = match.entryIds;
    const av = byEntry.get(a) ?? [];
    const bv = byEntry.get(b) ?? [];
    const dayKey = (ms: number) => new Date(ms).toDateString();
    const bDays = new Set(bv.map(dayKey));
    return av.filter((ms) => bDays.has(dayKey(ms)));
  })();

  const entryName = (eid: string) => {
    const e = twoEntries.find((x) => x.id === eid);
    return e ? entryDisplay(e, users).name : eid.slice(0, 6);
  };

  const outcome =
    match.status === 'complete'
      ? `${entryName(match.result.winnerEntryId ?? '')} won ${match.result.margin ?? ''}`.trim()
      : match.status === 'forfeited'
        ? `${match.forfeitedBy ? `${entryName(match.forfeitedBy)} forfeited` : 'Forfeited'} — ${entryName(match.result.winnerEntryId ?? '')} advances${match.forfeitReason ? `. ${match.forfeitReason}` : ''}`
        : 'Voided — weather';

  const STATUS_LABEL: Record<string, string> = {
    pendingOpponent: 'Waiting on an opponent',
    scheduling: 'Scheduling',
    scheduled: 'Scheduled',
    awaitingResult: 'Awaiting result',
    awaitingConfirmation: match.result?.disputed ? 'Disputed — on hold' : 'Awaiting confirmation',
    complete: 'Final',
    forfeited: 'Forfeited',
    voidedWeather: 'Voided — weather',
  };

  // submittedBy is an ENTRY id, not a uid — compare against my entry.
  const iSubmitted = !!youEntry && match.result.submittedBy === youEntry.id;

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav(-1)} className="btn-quiet mb-4 px-0">
        ← Back
      </button>

      {/* Pre-match education card — only once BOTH competitors exist. Against a
          TBD slot it would invent "Opponent: 0.0 — you get 8 strokes". */}
      {match.status === 'pendingOpponent' || twoEntries.length < 2 ? (
        <Card className="p-5">
          <p className="font-display uppercase tracking-wide text-ink">
            Waiting on your opponent
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            The other side of the draw hasn't finished. You'll get a text the
            moment your opponent is set — the 48-hour scheduling clock starts
            then, not before.
          </p>
        </Card>
      ) : (
      <Card className="border-tournament/40 p-5">
        <p className="font-display uppercase tracking-wide text-tournament">
          {card.heading}
        </p>
        <p className="mt-2">
          <Num className="text-ink">{card.indexes}</Num>
        </p>
        <p className="mt-2 text-ink">{card.strokes}</p>
        {card.strokeHoles && <p className="mt-1 text-sm text-ink-soft">{card.strokeHoles}</p>}
        {card.teeAlternative && (
          <p className="mt-2 rounded-md border border-pine/40 bg-pine/10 p-2.5 text-sm text-ink-soft">
            {card.teeAlternative} Agree it in chat before you tee off.
          </p>
        )}
        <Rule className="my-3" />
        <p className="text-sm text-ink-soft">{card.primer}</p>
      </Card>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Badge tone={match.status === 'complete' ? 'tournament' : 'neutral'}>
          {STATUS_LABEL[match.status] ?? match.status}
        </Badge>
        {tournament && (
          <span className="text-xs text-ink-faint">{tournament.name}</span>
        )}
      </div>

      <div className="mt-6">
        <SectionHeader>Match</SectionHeader>

        {match.status === 'scheduling' && (
          <div className="space-y-5">
            <div className="rounded-sm border border-rule bg-paper-sunken p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-soft">Deadline</span>
                <span className="text-ink">
                  {formatTeeTime(match.scheduling.deadline)} ·{' '}
                  {relativeDays(match.scheduling.deadline)}
                </span>
              </div>
              {/* The ladder, stated BEFORE it bites (§P1): what the deadline
                  does, spelled out where the deadline is shown. */}
              <p className="mt-2 border-t border-rule pt-2 text-xs text-ink-faint">
                Post at least 3 dates you can play. At the deadline: no response
                = forfeit; both silent = higher seed advances; overlapping dates
                = the match locks in automatically. One 3-day extension per
                tournament.
              </p>
            </div>

            <div>
              <p className="mb-2 font-display uppercase tracking-wide text-xs text-ink-soft">
                Availability log
              </p>
              <ul className="space-y-1 text-sm">
                {log.map((l) => (
                  <li key={l.entryId} className="flex justify-between">
                    <span className="text-ink">{entryName(l.entryId)}</span>
                    <span className="text-ink-faint">
                      <Num>{l.dates.length}</Num> dates · {relativeDays(l.submittedAt)}
                    </span>
                  </li>
                ))}
                {quiet.map((eid) => (
                  <li key={eid} className="flex justify-between text-ink-faint">
                    <span>{entryName(eid)}</span>
                    <span>gone quiet</span>
                  </li>
                ))}
              </ul>
            </div>

            {overlapTimes.length > 0 && myEntry && (
              <div>
                <p className="mb-2 font-display uppercase tracking-wide text-xs text-pine">
                  Overlapping times — lock one in
                </p>
                <p className="mb-2 text-xs text-ink-faint">
                  Tapping Set commits both players immediately — your opponent
                  gets a text with the time.
                </p>
                <div className="space-y-2">
                  {overlapTimes.map((ms) => (
                    <Button
                      key={ms}
                      variant="ghost"
                      className="w-full justify-between"
                      onClick={async () => {
                        setError(null);
                        try {
                          await setAgreedTime({
                            matchId: match.id,
                            agreedTime: ms,
                            placeId,
                            bookedBy: uid ?? null,
                          });
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <span>{formatTeeTime(new Date(ms))}</span>
                      <span>Set →</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {myEntry && <AvailabilityPicker matchId={match.id} onError={setError} />}

            {myEntry && !myExtensionUsed && (
              <Button
                variant="quiet"
                className="w-full"
                onClick={async () => {
                  setError(null);
                  try {
                    await requestExtension({ matchId: match.id });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Use my one extension (+3 days, once per tournament)
              </Button>
            )}
          </div>
        )}

        {match.status === 'scheduled' && (
          <div className="space-y-4">
            <div className="rounded-sm border border-pine/40 bg-pine/10 p-3 text-sm">
              <p className="text-pine">
                Agreed: {formatTeeTime(match.scheduling.agreedTime)}
                {course ? ` · ${course.name}` : ''}
              </p>
            </div>

            {/* Green fees: default is pay-at-the-course — the app touches
                nothing. The prepaid split is a quiet opt-in for the booker. */}
            {match.greenFees?.collectedAt ? (
              <p className="text-xs text-ink-faint">
                Green fees collected —{' '}
                <Num>{formatCents(match.greenFees.perPlayerCents)}</Num> each from{' '}
                <Num>{match.greenFees.chargedUserIds.length}</Num> player
                {match.greenFees.chargedUserIds.length === 1 ? '' : 's'}, reimbursed
                to the booker.
              </p>
            ) : (
              <p className="text-xs text-ink-faint">
                Green fees are paid at the course.
                {uid && match.scheduling.bookedBy === uid && (
                  <>
                    {' '}
                    <button
                      className="underline underline-offset-2 hover:text-tournament"
                      onClick={async () => {
                        const raw = window.prompt(
                          'You prepaid the whole group? Enter each player\'s share in dollars (minimum $10) and their saved cards are charged — you get reimbursed automatically.',
                        );
                        if (!raw) return;
                        setError(null);
                        try {
                          await collectGreenFees({
                            matchId: match.id,
                            perPlayerCents: dollarsToCents(raw),
                          });
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Prepaid the group? Split it.
                    </button>
                  </>
                )}
              </p>
            )}

            <CommitteeNote />
            {myEntry && (
              <>
                <p className="font-display uppercase tracking-wide text-xs text-ink-soft">
                  Report the result
                </p>
                <ResultForm matchId={match.id} entries={twoEntries} nameOf={entryName} onError={setError} />
                {/* The published cancellation ladder (§5) — deterministic. */}
                <button
                  className="w-full py-2 text-center text-xs text-ink-faint underline underline-offset-2 hover:text-tournament"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        'Cancel this tee time?\n\n· More than 72h out: full refund, back to scheduling (one free per season)\n· 24–72h out: refund only if the slot re-fills\n· Under 24h: no refund — the match is forfeited',
                      )
                    )
                      return;
                    setError(null);
                    try {
                      await cancelScheduledMatch({ matchId: match.id });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Need to cancel?
                </button>
              </>
            )}
          </div>
        )}

        {match.status === 'awaitingResult' && (
          <div className="space-y-4">
            <CommitteeNote />
            {myEntry ? (
              <ResultForm matchId={match.id} entries={twoEntries} nameOf={entryName} onError={setError} />
            ) : (
              <p className="text-sm text-ink-faint">Waiting on the competitors to report.</p>
            )}
          </div>
        )}

        {match.status === 'awaitingConfirmation' && (
          <div className="space-y-4">
            <div className="rounded-sm border border-rule bg-paper-sunken p-3 text-sm text-ink">
              Reported: {entryName(match.result.winnerEntryId ?? '')} won{' '}
              <Num>{match.result.margin}</Num>.
            </div>
            {match.result.disputed ? (
              // A filed dispute HOLDS the result — the 48h auto-confirm copy
              // would be a lie here, and the disputer needs to see it landed.
              <div className="rounded-sm border border-tournament/30 bg-tournament/10 p-3 text-sm">
                <p className="font-display uppercase tracking-wide text-xs text-tournament">
                  Disputed — on hold
                </p>
                <p className="mt-1 text-ink-soft">
                  The dispute went to the market organizer with both players'
                  records attached. Nothing auto-confirms while they review;
                  you'll both be notified of the ruling.
                </p>
              </div>
            ) : (
              <>
                <CommitteeNote />
                {myEntry && !iSubmitted ? (
                  <ConfirmDispute matchId={match.id} onError={setError} />
                ) : (
                  <p className="text-sm text-ink-faint">
                    Waiting for your opponent to confirm. Silence auto-confirms in 48h.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {(match.status === 'complete' ||
          match.status === 'forfeited' ||
          match.status === 'voidedWeather') && (
          <div className="rounded-sm border border-tournament/30 bg-tournament/10 p-4">
            <p className="font-display uppercase tracking-wide text-tournament">{outcome}</p>
            {match.result.scorecardPhotoUrl && (
              <a
                href={match.result.scorecardPhotoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-tournament underline"
              >
                View scorecard
              </a>
            )}
            {(match.result.disputed || (match.result as { resolvedByOrganizer?: boolean }).resolvedByOrganizer) && (
              <p className="mt-2 text-xs text-ink-soft">This result was disputed and ruled by an organizer.</p>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-tournament">{error}</p>}
      </div>

      {/* The coordination surface (Jack's rule: organizing a tee time needs a
          conversation, not just an availability log). Competitors only. */}
      {myEntry && match.status !== 'complete' && match.status !== 'forfeited' && (
        <div className="mt-6">
          <SectionHeader>Coordinate</SectionHeader>
          <Card className="p-4">
            <ChatThread threadId={match.id} />
          </Card>
        </div>
      )}
    </div>
  );
}
