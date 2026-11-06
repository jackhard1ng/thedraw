/**
 * Member event request (spec §7 Path B, member-initiated). A member proposes an
 * event — format, entry, field size, preferred courses/dates — which an
 * organizer then reviews. Submits via the requestEvent callable; the market is
 * inferred server-side from the caller.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, SectionHeader } from '@/components/ui';
import { dollarsToCents } from '@/lib/money';
import { requestEvent } from '@/lib/callable';
import { useFormats } from '@/features/tournaments/useTournaments';
import { PlacesAutocomplete, type CoursePick } from '@/features/courses/PlacesAutocomplete';

export function RequestEventForm() {
  const nav = useNavigate();
  const formats = useFormats();
  const formatList = Object.values(formats);

  const [formatId, setFormatId] = useState('');
  const [entry, setEntry] = useState('0');
  const [field, setField] = useState(16);
  const [courses, setCourses] = useState<CoursePick[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [draftDate, setDraftDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  let entryCents = 0;
  let feeError = false;
  try {
    entryCents = dollarsToCents(entry);
  } catch {
    feeError = true;
  }

  const valid = !!formatId && !feeError && field >= 2;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await requestEvent({
        formatId,
        proposedEntryCents: entryCents,
        proposedField: field,
        preferredCourses: courses.map((c) => c.placeId),
        preferredDates: dates.map((d) => new Date(d).getTime()),
        note: note.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-sheet px-4 py-10 text-center">
        <p className="font-display uppercase tracking-wide text-pine">Request submitted</p>
        <p className="mt-1 text-sm text-ink-soft">
          An organizer will review it. You'll be notified when it's approved.
        </p>
        <Button variant="ghost" className="mt-4" onClick={() => nav('/tournaments')}>
          Back to tournaments
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <SectionHeader>Request an event</SectionHeader>
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="Proposed entry ($)" hint="0 for free.">
            <input className="field-input tnum" value={entry} onChange={(e) => setEntry(e.target.value)} />
          </Field>
          <Field label="Field size">
            <input
              type="number"
              className="field-input tnum"
              value={field}
              onChange={(e) => setField(Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="Preferred courses">
          <PlacesAutocomplete
            onSelect={(c) => c && setCourses((cs) => (cs.find((x) => x.placeId === c.placeId) ? cs : [...cs, c]))}
          />
          {courses.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {courses.map((c) => (
                <li key={c.placeId} className="flex items-center justify-between">
                  <span className="text-pine">{c.name}</span>
                  <button
                    className="text-tournament underline"
                    onClick={() => setCourses((cs) => cs.filter((x) => x.placeId !== c.placeId))}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <Field label="Preferred dates">
          <div className="flex gap-2">
            <input
              type="date"
              className="field-input tnum"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
            />
            <Button
              variant="ghost"
              onClick={() => {
                if (draftDate && !dates.includes(draftDate)) setDates((d) => [...d, draftDate].sort());
                setDraftDate('');
              }}
            >
              Add
            </Button>
          </div>
          {dates.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {dates.map((d) => (
                <li key={d} className="flex items-center justify-between">
                  <span className="text-ink tnum">{d}</span>
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
        </Field>

        <Field label="Note">
          <textarea className="field-input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {error && <p className="text-sm text-tournament">{error}</p>}

        <Button variant="primary" className="w-full" disabled={!valid || busy} onClick={submit}>
          {busy ? 'Sending…' : 'Send request'}
        </Button>
      </div>
    </div>
  );
}
