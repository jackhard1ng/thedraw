/**
 * Create a tournament (organizer). The UI enforces the legal hard lines (§7):
 *   - the purse is a PERCENTAGE — payout shares must sum to 100 (blocks submit),
 *   - the admin fee is itemized and shown before anything is saved,
 *   - at least two places must be paid (loud warning if only one row),
 *   - the organizer cannot also be a competitor (stated on the form).
 * Paid events prefill DEFAULT_PAID_ELIGIBILITY. Submit creates then publishes.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button, Field, Rule, SectionHeader } from '@/components/ui';
import { dollarsToCents, itemizeEntry } from '@/lib/money';
import { DEFAULT_PAID_ELIGIBILITY } from '@/lib/eligibility';
import { createTournament, publishTournament } from '@/lib/callable';
import { useFormats } from '@/features/tournaments/useTournaments';
import { PayoutGrid, sharesSum } from '@/features/tournaments/PayoutGrid';
import type {
  Division,
  DivisionMode,
  DoubleDipRule,
  PayoutRow,
  PrizeType,
  TournamentStructure,
} from '@/types/models';

const toMs = (local: string) => (local ? new Date(local).getTime() : 0);

export function CreateTournamentForm() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const formats = useFormats();
  const formatList = Object.values(formats);

  const [formatId, setFormatId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entryFee, setEntryFee] = useState('0');
  const [adminFeePercent, setAdminFeePercent] = useState(25);
  const [divisionMode, setDivisionMode] = useState<DivisionMode>('grossOnly');
  const [doubleDipRule, setDoubleDipRule] = useState<DoubleDipRule>('onePrizePerPlayer');
  const [prizeType, setPrizeType] = useState<PrizeType>('cashPurse');
  const [structure, setStructure] = useState<TournamentStructure>('bracket');
  const [minEntries, setMinEntries] = useState(8);
  const [maxEntries, setMaxEntries] = useState(32);
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [roundDeadlineDays, setRoundDeadlineDays] = useState(7);
  const [rows, setRows] = useState<PayoutRow[]>([
    { division: 'gross', place: 1, sharePercent: 60 },
    { division: 'gross', place: 2, sharePercent: 40 },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let feeCents = 0;
  let feeError = false;
  try {
    feeCents = dollarsToCents(entryFee);
  } catch {
    feeError = true;
  }
  const free = feeCents === 0;
  const item = itemizeEntry(feeCents, adminFeePercent);

  const sum = sharesSum(rows);
  const sharesValid = Math.abs(sum - 100) < 0.001;
  const tooFewPlaces = rows.length < 2;

  const valid =
    !!formatId &&
    name.trim().length > 0 &&
    !feeError &&
    sharesValid &&
    minEntries >= 2 &&
    maxEntries >= minEntries &&
    !!opens &&
    !!closes &&
    toMs(closes) > toMs(opens);

  function setRow(i: number, patch: Partial<PayoutRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createTournament({
        formatId,
        name: name.trim(),
        description: description.trim(),
        entryFeeCents: feeCents,
        adminFeePercent,
        payoutTable: rows,
        divisionMode,
        doubleDipRule,
        prizeType,
        minEntries,
        maxEntries,
        registrationOpens: toMs(opens),
        registrationCloses: toMs(closes),
        // Paid events carry the standard money-event gate (§5).
        ...(free ? {} : { eligibility: DEFAULT_PAID_ELIGIBILITY }),
        structure,
        roundDeadlineDays,
      });
      await publishTournament({ tournamentId: res.data.tournamentId });
      nav(`/tournaments/${res.data.tournamentId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <SectionHeader>New tournament</SectionHeader>

      <p className="mb-4 rounded-sm border border-rule bg-paper-sunken p-3 text-xs text-ink-soft">
        As the organizer you cannot also compete in this event (§7). Purses are a
        percentage of the prize fund and must be published before entries close.
      </p>

      <div className="space-y-5">
        <Field label="Format">
          <select className="field-input" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
            <option value="">Select a format…</option>
            {formatList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name">
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Description">
          <textarea
            className="field-input min-h-20"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Entry fee ($)" hint="0 for a free event.">
            <input
              className="field-input tnum"
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value)}
            />
          </Field>
          <Field label="Admin fee (%)">
            <input
              type="number"
              className="field-input tnum"
              value={adminFeePercent}
              onChange={(e) => setAdminFeePercent(Number(e.target.value))}
            />
          </Field>
        </div>

        {!free && (
          <p className="rounded-sm border border-rule bg-paper-raised p-3 text-sm text-ink">
            {item.line}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Min entries" hint="Below this, all entries refunded.">
            <input
              type="number"
              className="field-input tnum"
              value={minEntries}
              onChange={(e) => setMinEntries(Number(e.target.value))}
            />
          </Field>
          <Field label="Max entries">
            <input
              type="number"
              className="field-input tnum"
              value={maxEntries}
              onChange={(e) => setMaxEntries(Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Registration opens">
            <input
              type="datetime-local"
              className="field-input tnum"
              value={opens}
              onChange={(e) => setOpens(e.target.value)}
            />
          </Field>
          <Field label="Registration closes">
            <input
              type="datetime-local"
              className="field-input tnum"
              value={closes}
              onChange={(e) => setCloses(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Structure">
            <select
              className="field-input"
              value={structure}
              onChange={(e) => setStructure(e.target.value as TournamentStructure)}
            >
              <option value="bracket">Bracket</option>
              <option value="pods">Pods</option>
            </select>
          </Field>
          <Field label="Round deadline (days)">
            <input
              type="number"
              className="field-input tnum"
              value={roundDeadlineDays}
              onChange={(e) => setRoundDeadlineDays(Number(e.target.value))}
            />
          </Field>
          <Field label="Divisions">
            <select
              className="field-input"
              value={divisionMode}
              onChange={(e) => setDivisionMode(e.target.value as DivisionMode)}
            >
              <option value="grossOnly">Gross only</option>
              <option value="netOnly">Net only</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <Field label="Prize type">
            <select
              className="field-input"
              value={prizeType}
              onChange={(e) => setPrizeType(e.target.value as PrizeType)}
            >
              <option value="cashPurse">Cash purse</option>
              <option value="sponsoredPrizes">Sponsored prizes</option>
            </select>
          </Field>
          <Field label="Double-dip rule">
            <select
              className="field-input"
              value={doubleDipRule}
              onChange={(e) => setDoubleDipRule(e.target.value as DoubleDipRule)}
            >
              <option value="onePrizePerPlayer">One prize per player</option>
              <option value="exclusiveDivisions">Exclusive divisions</option>
            </select>
          </Field>
        </div>

        <Rule />

        {/* Payout editor */}
        <div>
          <SectionHeader
            right={
              <button
                type="button"
                className="text-xs text-tournament underline"
                onClick={() =>
                  setRows((r) => [
                    ...r,
                    { division: 'gross', place: r.length + 1, sharePercent: 0 },
                  ])
                }
              >
                + Row
              </button>
            }
          >
            Payout table
          </SectionHeader>

          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="field-input py-2"
                  value={row.division}
                  onChange={(e) => setRow(i, { division: e.target.value as Division })}
                >
                  <option value="gross">Gross</option>
                  <option value="net">Net</option>
                </select>
                <input
                  type="number"
                  className="field-input tnum w-20 py-2"
                  value={row.place}
                  onChange={(e) => setRow(i, { place: Number(e.target.value) })}
                />
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="number"
                    className="field-input tnum py-2"
                    value={row.sharePercent}
                    onChange={(e) => setRow(i, { sharePercent: Number(e.target.value) })}
                  />
                  <span className="text-ink-faint">%</span>
                </div>
                <button
                  type="button"
                  className="text-tournament"
                  onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <PayoutGrid rows={rows} poolCents={free ? undefined : item.prizeCents * maxEntries} />
          </div>

          {tooFewPlaces && (
            <p className="mt-1 rounded-sm border border-stale/40 bg-stale/10 p-2 text-xs text-stale">
              At least two places should be paid (§7). Add another payout row.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-tournament">{error}</p>}

        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => nav('/organizer')}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Creating…' : 'Create & publish'}
          </Button>
        </div>
        {profile && profile.role !== 'organizer' && profile.role !== 'admin' && (
          <p className="text-xs text-tournament">
            Only organizers can create tournaments — the server will reject this.
          </p>
        )}
      </div>
    </div>
  );
}
