/**
 * Onboarding — creates the user's `users` document (spec §4).
 *
 * Real names, no usernames. 18+ age gate (§7.9). Handicap is entered with its
 * source, which drives the verification badge; a self-declared index is allowed
 * to start but shows gray. Organizer verification (GHIN/third-party) happens
 * later via a Cloud Function — a client can only ever set source: "self".
 */
import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, DEFAULT_MARKET_ID } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Field, SectionHeader } from '@/components/ui';
import type { HandicapSource } from '@/types/models';

/** "816-555-0123" → "+18165550123"; already-E.164 input passes through. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export function Onboarding() {
  const { fbUser } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | 'other'>('other');
  const [index, setIndex] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<HandicapSource>('self');
  const [ghinNumber, setGhinNumber] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ageNum = Number(age);
  const indexNum = Number(index);
  const valid =
    displayName.trim().length >= 2 &&
    Number.isFinite(ageNum) &&
    ageNum >= 18 &&
    Number.isFinite(indexNum);

  async function submit() {
    if (!fbUser || !valid) return;
    setBusy(true);
    setError(null);
    try {
      // PII (phone) goes to the owner-only private subdoc — the users doc is
      // readable by every signed-in member and must stay contact-free.
      await setDoc(doc(db, 'users', fbUser.uid), {
        marketId: DEFAULT_MARKET_ID,
        displayName: displayName.trim(),
        photoUrl: fbUser.photoURL ?? null,
        age: ageNum,
        gender,
        handicap: {
          index: indexNum,
          // A client may only ever self-declare; a green/yellow badge is granted
          // by an organizer through a Cloud Function, enforced in firestore.rules.
          source,
          ghinNumber: source === 'ghin' ? ghinNumber.trim() || null : null,
          sourceUrl: source === 'thirdParty' ? sourceUrl.trim() || null : null,
          verifiedAt: source === 'self' ? null : null,
          verifiedBy: null,
        },
        role: 'member',
        organizerMarkets: [],
        canCreatePaidEvents: false,
        createdAt: serverTimestamp(),
        status: 'active',
        // Flyer/QR attribution captured on the landing page (?src=...), so
        // every league drop is measurable.
        referralSource: localStorage.getItem('thedraw.src') ?? null,
      });
      const phoneE164 = fbUser.phoneNumber ?? normalizePhone(phone);
      if (phoneE164) {
        await setDoc(
          doc(db, 'users', fbUser.uid, 'private', 'data'),
          { phone: phoneE164 },
          { merge: true },
        );
      }
      // AuthContext's snapshot listener will pick up the new profile.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-6 py-8">
      <SectionHeader>Set up your card</SectionHeader>
      <p className="mb-6 text-sm text-ink-soft">
        Two things get you on the board: your name and your handicap. Everything
        else can wait.
      </p>

      <div className="space-y-5">
        <Field label="Name" hint="Real name — no usernames.">
          <input
            className="field-input"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Age" hint="18+ to play.">
            <input
              className="field-input tnum"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </Field>
          <Field label="Handicap index">
            <input
              className="field-input tnum"
              inputMode="decimal"
              placeholder="12.4"
              value={index}
              onChange={(e) => setIndex(e.target.value)}
            />
          </Field>
        </div>

        {!fbUser?.phoneNumber && (
          <Field
            label="Mobile number (recommended)"
            hint="Deadline-critical alerts — a confirmed tee time, a match deadline — arrive by text. Without it you'll rely on the in-app inbox."
          >
            <input
              className="field-input tnum"
              inputMode="tel"
              autoComplete="tel"
              placeholder="816-555-0123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        )}

        <Field label="Gender">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['M', 'Man'],
                ['F', 'Woman'],
                ['other', 'Other'],
              ] as ['M' | 'F' | 'other', string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setGender(val)}
                className={`btn ${
                  gender === val
                    ? 'bg-ink text-paper'
                    : 'border border-rule-strong text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Where's your handicap from?" hint="Shown on your card so others can judge for themselves.">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['ghin', 'GHIN'],
                ['thirdParty', 'App'],
                ['self', 'Self'],
              ] as [HandicapSource, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setSource(val)}
                className={`btn ${
                  source === val
                    ? 'bg-ink text-paper'
                    : 'border border-rule-strong text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {source === 'ghin' && (
          <Field label="GHIN number" hint="An organizer verifies this against the public lookup.">
            <input
              className="field-input tnum"
              value={ghinNumber}
              onChange={(e) => setGhinNumber(e.target.value)}
            />
          </Field>
        )}
        {source === 'thirdParty' && (
          <Field label="Link to your record" hint="18Birdies, Golfshot, TheGrint — a screenshot link works too.">
            <input
              className="field-input"
              inputMode="url"
              placeholder="https://…"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </Field>
        )}

        {error && <p className="text-sm text-tournament">{error}</p>}

        <Button variant="primary" className="w-full" disabled={!valid || busy} onClick={submit}>
          {busy ? 'Saving…' : 'Join the board'}
        </Button>
      </div>
    </div>
  );
}
