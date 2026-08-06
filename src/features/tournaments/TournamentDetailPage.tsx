/**
 * Tournament detail — the registration page. Everything a player needs to make
 * an informed decision is shown BEFORE any payment (spec §5/§7):
 *   - the format + scoring in plain language, glossary terms tappable inline,
 *   - the FULL payout grid by division/place (with a sum-to-100 guard),
 *   - the itemized entry fee, verbatim: "$X entry — $Y prize fund, $Z admin",
 *   - eligibility, with the ineligibility reasons listed word-for-word.
 *
 * Reads come straight from Firestore; the entry itself goes through the
 * enterTournament callable, which is the authoritative eligibility + money gate.
 * The client eligibility check here is a courtesy that greys out the button.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
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
  Term,
} from '@/components/ui';
import { formatCents, itemizeEntry } from '@/lib/money';
import { relativeDays, formatTeeTime } from '@/lib/format';
import { GLOSSARY, strokesRule } from '@/lib/education';
import {
  checkEligibility,
  type DerivedStats,
} from '@/lib/eligibility';
import { enterTournament, withdrawEntry } from '@/lib/callable';
import type { Format, Scoring } from '@/types/models';
import {
  useFormat,
  useTournament,
  useTournamentEntries,
} from './useTournaments';
import { PayoutGrid } from './PayoutGrid';
import { RegistrationForm, type RegistrationValue } from './RegistrationForm';

const DAY = 86_400_000;

const SCORING_BLURB: Record<Scoring, string> = {
  matchPlay: 'Played hole by hole against one opponent — win more holes than they do, not fewer total strokes. Ties on a hole are halved.',
  strokePlay: 'Every stroke counts toward a total over the round; the lowest total wins.',
  stableford: 'Points per hole against a target, rewarding aggressive play — highest points wins.',
  scramble: 'A team format: everyone hits, you play the best ball, and repeat until holed.',
};

/** Format explanation with the load-bearing words made tappable (§5). */
function FormatExplainer({
  format,
  indexRange,
}: {
  format: Format;
  indexRange: [number, number] | null;
}) {
  const gross = format.scoring !== 'matchPlay' && !format.handicapAllowance;
  return (
    <div className="space-y-2 text-sm text-ink-soft">
      <p>
        <span className="font-display uppercase tracking-wide text-ink">
          {format.name}
        </span>{' '}
        · {format.teamSize > 1 ? `${format.teamSize}-player teams` : 'singles'} ·{' '}
        {format.advancement === 'bracket' ? (
          <>single-elimination <Term word="bracket" def={GLOSSARY['match play']} /></>
        ) : (
          format.advancement
        )}
      </p>
      <p>{SCORING_BLURB[format.scoring]}</p>

      {/* The stroke rule, stated before anyone pays — never buried (§5). */}
      <p
        className={`rounded-md border p-2.5 ${
          gross
            ? 'border-tournament/30 bg-tournament/5 text-ink'
            : 'border-rule bg-paper-sunken text-ink'
        }`}
      >
        <span className="mr-1.5 font-display uppercase tracking-wide text-xs text-ink-soft">
          {gross ? 'Gross' : 'Strokes'}
        </span>
        {strokesRule(format)}
      </p>
      {indexRange && (
        <p className="text-xs text-ink-soft">
          Open to indexes{' '}
          <span className="tnum">
            {indexRange[0].toFixed(1)}–{indexRange[1] >= 40 ? 'up' : indexRange[1].toFixed(1)}
          </span>{' '}
          — enforced at entry, frozen when the draw is made.
        </p>
      )}
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        {format.scoring === 'matchPlay' && (
          <Term word="match play" def={GLOSSARY['match play']} />
        )}
        {format.scoring === 'strokePlay' && (
          <Term word="stroke play" def={GLOSSARY['stroke play']} />
        )}
        {format.scoring === 'scramble' && (
          <Term word="scramble" def={GLOSSARY.scramble} />
        )}
        {(format.scoringMode === 'net' || format.scoringMode === 'both') && (
          <Term word="net" def={GLOSSARY.net} />
        )}
        {(format.scoringMode === 'gross' ||
          format.scoringMode === 'both' ||
          format.scoringMode == null) && (
          <Term word="gross" def={GLOSSARY.gross} />
        )}
        {format.flightBy !== 'none' && (
          <Term word="flight" def={GLOSSARY.flight} />
        )}
      </p>
    </div>
  );
}

export function TournamentDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile, fbUser } = useAuth();
  const { tournament, loading } = useTournament(id);
  const format = useFormat(tournament?.formatId);
  const entries = useTournamentEntries(id);

  const [reg, setReg] = useState<RegistrationValue>({ partnerId: '', teamName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  // Best-effort derived stats for the courtesy eligibility check. The Cloud
  // Function recomputes these authoritatively; here we approximate and lean
  // permissive on anything we cannot compute client-side (spec note).
  const [attestedRounds, setAttestedRounds] = useState<number | null>(null);
  useEffect(() => {
    const uid = fbUser?.uid;
    if (!uid) return;
    getDocs(
      query(
        collection(db, 'rounds'),
        where('userId', '==', uid),
        where('source', '==', 'attested'),
      ),
    )
      .then((snap) => setAttestedRounds(snap.size))
      .catch(() => setAttestedRounds(0));
  }, [fbUser?.uid]);

  if (loading || !tournament) {
    return loading ? (
      <Spinner />
    ) : (
      <div className="mx-auto max-w-sheet px-4 py-10 text-center text-ink-soft">
        <p>This tournament could not be found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => nav('/tournaments')}>
          Back to tournaments
        </Button>
      </div>
    );
  }

  const uid = fbUser?.uid;
  const myEntry = entries?.find((e) => uid && e.userIds.includes(uid) && e.status !== 'withdrawn');
  const free = tournament.entryFeeCents === 0;
  const item = itemizeEntry(tournament.entryFeeCents, tournament.adminFeePercent);
  const field = tournament.entryIds?.length ?? 0;
  const full = field >= tournament.maxEntries;
  const projectedPool = item.prizeCents * Math.max(field, tournament.minEntries);

  // Derived stats — real where cheap, permissive otherwise (courtesy only).
  const derived: DerivedStats | null = profile
    ? {
        // Count the user's non-withdrawn entries as a proxy for completed events.
        eventsCompleted: (entries ?? []).filter(
          (e) => uid && e.userIds.includes(uid) && e.status !== 'withdrawn',
        ).length,
        attestedRounds: attestedRounds ?? 0,
        // Attendance can't be reconstructed client-side — pass a permissive 1.
        attendanceRate: 1,
        accountAgeDays: profile.createdAt
          ? (Date.now() - profile.createdAt.toMillis()) / DAY
          : 9999,
        hasPaymentMethod: profile.stripeCustomerId != null,
      }
    : null;

  const elig =
    profile && derived
      ? checkEligibility(profile, tournament, derived)
      : { eligible: false, reasons: ['Sign in to check eligibility.'] };

  const teamSize = format?.teamSize ?? 1;
  const regValid = teamSize <= 1 || reg.partnerId.length > 0;

  async function onEnter() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await enterTournament({
        tournamentId: id,
        ...(teamSize > 1
          ? { partnerId: reg.partnerId, teamName: reg.teamName || undefined }
          : {}),
      });
      // Phase 3: if a clientSecret comes back, this is where Stripe Elements
      // would confirm the PaymentIntent. For now we surface that payment was
      // authorized. (Elements wiring is deferred to Phase 3.)
      setClientSecret(res.data.clientSecret);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw() {
    if (!myEntry) return;
    if (!window.confirm('Withdraw your entry?')) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawEntry({ entryId: myEntry.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav('/tournaments')} className="btn-quiet mb-4 px-0">
        ← Tournaments
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{tournament.name}</h1>
          <p className="mt-1 text-sm text-ink-faint">
            <Num>{field}</Num>/<Num>{tournament.maxEntries}</Num> entered · min{' '}
            <Num>{tournament.minEntries}</Num>
          </p>
        </div>
        <Badge tone={tournament.status === 'open' ? 'fresh' : 'neutral'}>
          {tournament.status}
        </Badge>
      </div>

      {tournament.description && (
        <p className="mt-3 whitespace-pre-wrap text-ink-soft">
          {tournament.description}
        </p>
      )}

      {(tournament.status === 'inProgress' || tournament.status === 'complete') && (
        <div className="mt-4 flex gap-2">
          {tournament.structure === 'bracket' ? (
            <Button variant="ghost" className="flex-1" onClick={() => nav(`/tournaments/${tournament.id}/bracket`)}>
              View bracket
            </Button>
          ) : (
            <Button variant="ghost" className="flex-1" onClick={() => nav(`/tournaments/${tournament.id}/leaderboard`)}>
              Leaderboard
            </Button>
          )}
        </div>
      )}

      {/* Format + scoring, plain language */}
      <div className="mt-6">
        <SectionHeader>Format</SectionHeader>
        {format ? (
          <FormatExplainer format={format} indexRange={tournament.eligibility.indexRange} />
        ) : (
          <p className="text-sm text-ink-faint">Loading format…</p>
        )}
      </div>

      {/* Payout grid */}
      <div className="mt-6">
        <SectionHeader
          right={
            <span className="text-xs text-ink-faint">
              {tournament.prizeType === 'cashPurse' ? 'Cash purse' : 'Sponsored'}
            </span>
          }
        >
          Payouts
        </SectionHeader>
        <PayoutGrid
          rows={tournament.payoutTable}
          poolCents={free ? undefined : projectedPool}
        />
        {!free && (
          <p className="mt-1 text-xs text-ink-faint">
            Projected at the current field of <Num>{Math.max(field, tournament.minEntries)}</Num>.
            Purses are a percentage of the prize fund and grow with the field.
          </p>
        )}
        {tournament.prizeType === 'sponsoredPrizes' && tournament.sponsoredPrizes && (
          <div className="mt-2 divide-y divide-rule text-sm">
            {tournament.sponsoredPrizes.map((p) => (
              <div key={p.place} className="flex justify-between py-1.5">
                <span className="text-ink">
                  {p.place}. {p.description}
                </span>
                <span className="text-ink-faint">{p.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Entry fee itemization (§7) — skipped for free events */}
      <div className="mt-6">
        <SectionHeader>Entry fee</SectionHeader>
        {free ? (
          <p className="text-lg text-pine">Free event — no entry fee.</p>
        ) : (
          <Card className="p-4">
            <p className="text-ink">
              <Num className="text-lg">{item.line}</Num>
            </p>
            <Rule className="my-3" />
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-soft">Entry</span>
                <Num>{formatCents(item.entryFeeCents)}</Num>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">Prize fund</span>
                <Num className="text-pine">{formatCents(item.prizeCents)}</Num>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">
                  Tournament administration ({tournament.adminFeePercent}%)
                </span>
                <Num>{formatCents(item.adminCents)}</Num>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Registration window */}
      <div className="mt-6">
        <SectionHeader>Registration</SectionHeader>
        <div className="space-y-1 text-sm text-ink-soft">
          <div className="flex justify-between">
            <span>Opens</span>
            <span className="text-ink">{formatTeeTime(tournament.registrationOpens)}</span>
          </div>
          <div className="flex justify-between">
            <span>Closes</span>
            <span className="text-ink">
              {formatTeeTime(tournament.registrationCloses)} ·{' '}
              {relativeDays(tournament.registrationCloses)}
            </span>
          </div>
        </div>
      </div>

      <Rule className="my-8" />

      {/* Eligibility + enter */}
      {myEntry ? (
        <div className="space-y-3">
          <div className="rounded-sm border border-pine/40 bg-pine/10 p-3 text-sm text-pine">
            You are entered ({myEntry.paymentStatus}). Seed{' '}
            <Num>{myEntry.seed || '—'}</Num>.
          </div>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onWithdraw}>
            {busy ? '…' : 'Withdraw entry'}
          </Button>
        </div>
      ) : clientSecret !== null ? (
        <div className="rounded-sm border border-pine/40 bg-pine/10 p-4 text-sm text-pine">
          <p className="font-display uppercase tracking-wide">Payment authorized</p>
          <p className="mt-1 text-ink-soft">
            {free
              ? 'You are entered.'
              : 'Your card was authorized for the entry fee (not yet captured). Real Stripe Elements confirmation is wired in Phase 3.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {!elig.eligible && (
            <div className="rounded-sm border border-tournament/30 bg-tournament/10 p-3">
              <p className="font-display uppercase tracking-wide text-xs text-tournament">
                Not eligible yet
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {elig.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {teamSize > 1 && (
            <RegistrationForm teamSize={teamSize} value={reg} onChange={setReg} />
          )}

          <Button
            variant="primary"
            className="w-full"
            disabled={busy || full || !elig.eligible || !regValid || tournament.status !== 'open'}
            onClick={onEnter}
          >
            {busy
              ? 'Entering…'
              : full
                ? 'Field full'
                : tournament.status !== 'open'
                  ? 'Registration closed'
                  : free
                    ? 'Enter — free'
                    : `Enter — ${formatCents(tournament.entryFeeCents)}`}
          </Button>
          {error && <p className="text-sm text-tournament">{error}</p>}
        </div>
      )}
    </div>
  );
}
