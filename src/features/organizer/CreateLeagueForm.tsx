/**
 * Set up a league season ONCE (organizer): pick the night, the length, the
 * course rotation, and the money — week 1 goes live immediately and the
 * scheduler creates every following week automatically. Rotating courses and
 * best-N-weeks scoring are first-class: a league without a home course, where
 * missing a week doesn't end your season.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, Num, SectionHeader } from '@/components/ui';
import { createTourSeries } from '@/lib/callable';
import { dollarsToCents } from '@/lib/money';
import { PlacesAutocomplete, type CoursePick } from '@/features/courses/PlacesAutocomplete';

export function CreateLeagueForm() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [firstTee, setFirstTee] = useState(''); // datetime-local — fixes the weeknight
  const [weeks, setWeeks] = useState(12);
  const [countBest, setCountBest] = useState(9);
  const [fee, setFee] = useState('');
  const [feePct, setFeePct] = useState(10);
  const [maxEntries, setMaxEntries] = useState(32);
  const [courses, setCourses] = useState<CoursePick[]>([]);
  const [flightCut, setFlightCut] = useState(''); // optional index split, e.g. "12"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim().length >= 3 && season.trim().length >= 2 && !!firstTee && courses.length >= 1;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const cut = flightCut ? Number(flightCut) : null;
      const res = await createTourSeries({
        name: name.trim(),
        season: season.trim(),
        schedule: {
          firstStartAt: new Date(firstTee).getTime(),
          weeks,
          countBest: Math.min(countBest, weeks),
          entryFeeCents: fee ? dollarsToCents(fee) : 0,
          adminFeePercent: feePct,
          maxEntries,
          placeIds: courses.map((c) => c.placeId),
          flights: cut && Number.isFinite(cut) ? [{ min: 0, max: cut }, { min: cut + 0.1, max: 54 }] : [],
        },
      });
      nav('/tour');
      void res;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav('/organizer')} className="btn-quiet mb-4 px-0">
        ← Organizer
      </button>
      <SectionHeader>Start a league season</SectionHeader>
      <p className="mb-5 text-sm text-ink-soft">
        Set it up once. Week 1 opens immediately; every following week creates
        itself on schedule, rotating through your course list. Players' best{' '}
        <Num>{Math.min(countBest, weeks)}</Num> of <Num>{weeks}</Num> weeks
        count, so a missed Tuesday never ends a season.
      </p>

      <div className="space-y-5">
        <Field label="League name" hint='e.g. "KC Tuesday Night League"'>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Season label" hint='e.g. "2026 Summer"'>
          <input className="field-input" value={season} onChange={(e) => setSeason(e.target.value)} />
        </Field>
        <Field
          label="Week 1 first tee"
          hint="This fixes the league night — every week repeats 7 days later."
        >
          <input
            type="datetime-local"
            className="field-input tnum"
            value={firstTee}
            onChange={(e) => setFirstTee(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Weeks">
            <input
              type="number" min={1} max={30}
              className="field-input tnum"
              value={weeks}
              onChange={(e) => setWeeks(Math.max(1, Math.min(30, Number(e.target.value))))}
            />
          </Field>
          <Field label="Best-N weeks count" hint="Classic league scoring.">
            <input
              type="number" min={1} max={weeks}
              className="field-input tnum"
              value={countBest}
              onChange={(e) => setCountBest(Math.max(1, Number(e.target.value)))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Weekly entry" hint="Blank = free.">
            <input
              className="field-input tnum"
              inputMode="decimal"
              placeholder="$10"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </Field>
          <Field label="Admin fee %" hint="Price the work.">
            <input
              type="number" min={0} max={30}
              className="field-input tnum"
              value={feePct}
              onChange={(e) => setFeePct(Math.max(0, Math.min(30, Number(e.target.value))))}
            />
          </Field>
          <Field label="Max field">
            <input
              type="number" min={4} max={60}
              className="field-input tnum"
              value={maxEntries}
              onChange={(e) => setMaxEntries(Math.max(4, Number(e.target.value)))}
            />
          </Field>
        </div>

        <Field
          label="Course rotation"
          hint="Add courses in order — week 1 plays the first, week 2 the second, and it loops. One course = same place every week."
        >
          <PlacesAutocomplete onSelect={(c) => setCourses((cs) => [...cs, c])} />
          {courses.length > 0 && (
            <div className="mt-2 space-y-1">
              {courses.map((c, i) => (
                <div key={`${c.placeId}_${i}`} className="flex items-center justify-between text-sm">
                  <span className="text-ink">
                    <Num className="mr-2 text-ink-faint">{i + 1}.</Num>
                    {c.name}
                  </span>
                  <button
                    className="text-xs text-tournament underline"
                    onClick={() => setCourses((cs) => cs.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Flight split (optional)"
          hint="An index cutoff, e.g. 12 — makes two flights (0–12 and 12.1+) that compete separately each week."
        >
          <input
            className="field-input tnum"
            inputMode="decimal"
            placeholder="12"
            value={flightCut}
            onChange={(e) => setFlightCut(e.target.value)}
          />
        </Field>

        {error && <p className="text-sm text-tournament">{error}</p>}
        <Card className="p-3 text-xs text-ink-soft">
          Weekly purses pay gross and net each week; flight winners are named
          per week; season standings (best-{Math.min(countBest, weeks)}) live on
          the Tour page with one persistent league chat across all {weeks} weeks.
        </Card>
        <Button variant="primary" className="w-full" disabled={!valid || busy} onClick={submit}>
          {busy ? 'Creating season…' : 'Create the season — week 1 goes live now'}
        </Button>
      </div>
    </div>
  );
}
