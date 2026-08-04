/**
 * Post a round — spec §P2: at most two required inputs. Here they are TIMING and
 * SLOTS. Everything else defaults and hides behind "More options". Friction is
 * the enemy; an empty board is a dead product.
 *
 * Defaults (§4): vibe "open", stakes "open", handicapPref "any",
 * format "open", booking "needsBooking".
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db, DEFAULT_MARKET_ID } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Field, Rule, SectionHeader } from '@/components/ui';
import { PlacesAutocomplete, type CoursePick } from '@/features/courses/PlacesAutocomplete';
import type {
  BookingState,
  HandicapPref,
  RoundFormat,
  Stakes,
  TimingMode,
  Vibe,
} from '@/types/models';

export function CreatePostPage() {
  const { fbUser } = useAuth();
  const nav = useNavigate();

  // The two required fields.
  const [timingMode, setTimingMode] = useState<TimingMode>('fixed');
  const [fixedTime, setFixedTime] = useState(''); // datetime-local string
  const [flexibleDays, setFlexibleDays] = useState<string[]>([]);
  const [slotsTotal, setSlotsTotal] = useState(1);

  // Everything below is "more options".
  const [showMore, setShowMore] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [course, setCourse] = useState<CoursePick | null>(null);
  const [booking, setBooking] = useState<BookingState>('needsBooking');
  const [vibe, setVibe] = useState<Vibe>('open');
  const [stakes, setStakes] = useState<Stakes>('open');
  const [format, setFormat] = useState<RoundFormat>('open');
  const [handicapPref, setHandicapPref] = useState<HandicapPref>('any');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timingValid =
    (timingMode === 'fixed' && !!fixedTime) ||
    (timingMode === 'window' && !!fixedTime) ||
    (timingMode === 'flexible' && flexibleDays.length > 0);
  const valid = timingValid && slotsTotal >= 1;

  function toggleDay(day: string) {
    setFlexibleDays((d) =>
      d.includes(day) ? d.filter((x) => x !== day) : [...d, day],
    );
  }

  async function submit() {
    if (!fbUser || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const fixedTs =
        fixedTime && timingMode !== 'flexible'
          ? Timestamp.fromDate(new Date(fixedTime))
          : null;
      await addDoc(collection(db, 'roundPosts'), {
        marketId: DEFAULT_MARKET_ID,
        createdBy: fbUser.uid,
        title: title.trim() || null,
        description: description.trim() || null,
        timing: {
          mode: timingMode,
          fixedTime: timingMode === 'fixed' ? fixedTs : null,
          windowStart: timingMode === 'window' ? fixedTs : null,
          windowEnd: null,
          flexibleDays: timingMode === 'flexible' ? flexibleDays : null,
        },
        course: {
          mode: course ? 'specific' : 'flexible',
          placeId: course?.placeId ?? null,
          preferredPlaceIds: null,
        },
        booking,
        slotsTotal,
        slotsFilled: 0,
        hosting: null,
        vibe,
        stakes,
        handicapPref,
        handicapRange: null,
        format,
        joinedUserIds: [],
        // Path A player-arranged stakes: the app never holds or routes money (§7).
        stakesAmount: null,
        stakesHandledByApp: false,
        status: 'open',
        createdAt: serverTimestamp(),
      });
      nav('/');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <SectionHeader>Post a round</SectionHeader>

      <div className="space-y-6">
        {/* Required field 1: timing */}
        <div>
          <div className="mb-2 flex gap-2">
            {(['fixed', 'window', 'flexible'] as TimingMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTimingMode(m)}
                className={`btn flex-1 ${
                  timingMode === m ? 'bg-ink text-paper' : 'border border-rule-strong text-ink-soft'
                }`}
              >
                {m === 'fixed' ? 'Set time' : m === 'window' ? 'Window' : 'Flexible'}
              </button>
            ))}
          </div>
          {timingMode === 'flexible' ? (
            <Field label="Which days work?">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`rounded-full border px-3 py-1 text-xs font-display uppercase ${
                      flexibleDays.includes(d)
                        ? 'border-ink bg-ink text-paper'
                        : 'border-rule-strong text-ink-soft'
                    }`}
                  >
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            <Field label={timingMode === 'window' ? 'Earliest tee time' : 'Tee time'}>
              <input
                type="datetime-local"
                className="field-input tnum"
                value={fixedTime}
                onChange={(e) => setFixedTime(e.target.value)}
              />
            </Field>
          )}
        </div>

        {/* Required field 2: slots */}
        <Field label="Open slots" hint="How many playing partners you need.">
          <div className="flex items-center gap-3">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSlotsTotal(n)}
                className={`btn h-12 w-12 ${
                  slotsTotal === n ? 'bg-tournament text-paper' : 'border border-rule-strong text-ink'
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-sm text-ink-faint">
              {slotsTotal === 1 ? 'a partner' : `${slotsTotal} players`}
            </span>
          </div>
        </Field>

        <Rule />

        <button
          type="button"
          className="btn-quiet w-full justify-between"
          onClick={() => setShowMore((s) => !s)}
        >
          <span>More options</span>
          <span>{showMore ? '–' : '+'}</span>
        </button>

        {showMore && (
          <div className="space-y-5">
            <Field label="Title" hint='Optional. e.g. "Golf with the founder".'>
              <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>

            <Field label="Course" hint="Leave blank for a flexible-course round.">
              <PlacesAutocomplete onSelect={setCourse} />
              {course && (
                <p className="mt-1 text-sm text-pine">Selected: {course.name}</p>
              )}
            </Field>

            <Field label="Is it booked?">
              <div className="flex gap-2">
                {(['booked', 'needsBooking'] as BookingState[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBooking(b)}
                    className={`btn flex-1 ${
                      booking === b ? 'bg-ink text-paper' : 'border border-rule-strong text-ink-soft'
                    }`}
                  >
                    {b === 'booked' ? 'Booked' : 'Needs booking'}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Vibe">
                <select className="field-input" value={vibe} onChange={(e) => setVibe(e.target.value as Vibe)}>
                  <option value="open">Any vibe</option>
                  <option value="casual">Casual</option>
                  <option value="competitive">Competitive</option>
                </select>
              </Field>
              <Field label="Stakes">
                <select className="field-input" value={stakes} onChange={(e) => setStakes(e.target.value as Stakes)}>
                  <option value="open">Open</option>
                  <option value="noMoney">No money</option>
                  <option value="money">Money</option>
                </select>
              </Field>
              <Field label="Format">
                <select className="field-input" value={format} onChange={(e) => setFormat(e.target.value as RoundFormat)}>
                  <option value="open">Open</option>
                  <option value="justGolf">Just golf</option>
                  <option value="singlesMatch">Singles match</option>
                  <option value="twoVTwo">2v2</option>
                  <option value="skins">Skins</option>
                </select>
              </Field>
              <Field label="Handicap">
                <select
                  className="field-input"
                  value={handicapPref}
                  onChange={(e) => setHandicapPref(e.target.value as HandicapPref)}
                >
                  <option value="any">Any</option>
                  <option value="similar">Similar to me</option>
                </select>
              </Field>
            </div>

            <Field label="Notes">
              <textarea
                className="field-input min-h-24"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            {stakes === 'money' && (
              <p className="rounded-sm border border-rule bg-paper-sunken p-3 text-xs text-ink-soft">
                Stakes are arranged and settled between players. The Draw never
                collects, holds, or takes a cut of a player-arranged wager.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-tournament">{error}</p>}

        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => nav('/')}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Posting…' : 'Post to board'}
          </Button>
        </div>
      </div>
    </div>
  );
}
