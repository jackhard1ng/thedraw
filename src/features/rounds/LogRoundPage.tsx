/**
 * Log a self-reported round (spec §4 `rounds`). No course rating or slope
 * required — yardage plus relative tee position conveys difficulty anywhere on
 * earth. This is deliberately a rough picture; real handicaps live elsewhere.
 *
 * Two required inputs (§P2): course + total score. Self-reported rounds display
 * in a visually separate section from the verified index and are never blended.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Field, SectionHeader } from '@/components/ui';
import { PlacesAutocomplete, type CoursePick } from '@/features/courses/PlacesAutocomplete';
import type { TeePosition } from '@/types/models';

const TEES: [TeePosition, string][] = [
  ['tips', 'Tips'],
  ['back', 'Back'],
  ['middle', 'Middle'],
  ['forwardMiddle', 'Fwd-mid'],
  ['forward', 'Forward'],
];

export function LogRoundPage() {
  const { fbUser } = useAuth();
  const nav = useNavigate();
  // Arriving from a completed board post ("log your score") links the round to
  // that post so a groupmate can attest it (the eligibility funnel).
  const [params] = useSearchParams();
  const fromPostId = params.get('postId');
  const fromPlaceId = params.get('placeId');
  const [course, setCourse] = useState<CoursePick | null>(null);
  const [score, setScore] = useState('');
  const [holes, setHoles] = useState<9 | 18>(18);
  const [tee, setTee] = useState<TeePosition>('middle');
  const [playedAt, setPlayedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoreNum = Number(score);
  const effectivePlaceId = course?.placeId ?? fromPlaceId;
  const valid = !!effectivePlaceId && Number.isFinite(scoreNum) && scoreNum > 0;

  async function submit() {
    if (!fbUser || !effectivePlaceId || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, 'rounds'), {
        userId: fbUser.uid,
        placeId: effectivePlaceId,
        playedAt: playedAt
          ? Timestamp.fromDate(new Date(playedAt))
          : Timestamp.now(),
        holes,
        totalScore: scoreNum,
        teePosition: tee,
        teeName: null,
        yardage: null,
        source: 'selfReported',
        attestedBy: null,
        roundPostId: fromPostId ?? null,
      });
      nav(fromPostId ? `/post/${fromPostId}` : '/me');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <SectionHeader>Log a round</SectionHeader>
      <p className="mb-6 text-sm text-ink-soft">
        A quick record for your card. Kept separate from your verified index.
        Only rounds played through a board post can be attested by your group —
        and attested rounds are what count toward money-event eligibility.
      </p>

      <div className="space-y-5">
        <Field label="Course">
          <PlacesAutocomplete onSelect={setCourse} />
          {course && <p className="mt-1 text-sm text-pine">Selected: {course.name}</p>}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Total score">
            <input
              className="field-input tnum"
              inputMode="numeric"
              placeholder="84"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </Field>
          <Field label="Holes">
            <div className="flex gap-2">
              {([9, 18] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHoles(h)}
                  className={`btn flex-1 ${
                    holes === h ? 'bg-ink text-paper' : 'border border-rule-strong text-ink-soft'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Tees" hint="Relative position conveys difficulty — no rating needed.">
          <div className="flex flex-wrap gap-2">
            {TEES.map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setTee(val)}
                className={`rounded-full border px-3 py-1 text-xs font-display uppercase ${
                  tee === val ? 'border-ink bg-ink text-paper' : 'border-rule-strong text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="When" hint="Optional — defaults to now.">
          <input
            type="date"
            className="field-input tnum"
            value={playedAt}
            onChange={(e) => setPlayedAt(e.target.value)}
          />
        </Field>

        {error && <p className="text-sm text-tournament">{error}</p>}

        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => nav('/me')}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Saving…' : 'Save round'}
          </Button>
        </div>
      </div>
    </div>
  );
}
