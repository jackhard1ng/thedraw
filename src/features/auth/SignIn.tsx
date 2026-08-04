/**
 * Sign in — phone (SMS) primary, Google secondary (spec §3).
 * Golfers respond to texts, not emails, so SMS leads.
 */
import { useRef, useState } from 'react';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
} from 'firebase/auth';
import { auth, googleProvider, firebaseConfigured } from '@/lib/firebase';
import { Button, Field, Rule } from '@/components/ui';
import { Mark } from '@/components/Mark';

function normalizeUsPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.startsWith('+') ? raw : `+${digits}`;
}

export function SignIn() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      if (!verifier.current) {
        verifier.current = new RecaptchaVerifier(auth, 'recaptcha', {
          size: 'invisible',
        });
      }
      confirmation.current = await signInWithPhoneNumber(
        auth,
        normalizeUsPhone(phone),
        verifier.current,
      );
      setStage('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setBusy(true);
    try {
      await confirmation.current?.confirm(code);
      // onAuthStateChanged in AuthContext takes it from here.
    } catch {
      setError('That code did not match. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <Mark className="mx-auto mb-3 h-12 w-12 text-ink" />
        <h1 className="text-4xl">The Draw</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Competition and playing partners for golfers without a regular group.
        </p>
      </div>

      {!firebaseConfigured && (
        <div className="mb-4 rounded-sm border border-stale/40 bg-stale/10 p-3 text-sm text-ink-soft">
          Sign-in isn't available yet — this deployment is missing its Firebase
          configuration. Add the <code>VITE_FIREBASE_*</code> keys to enable it.
        </div>
      )}

      {stage === 'phone' ? (
        <div className="space-y-4">
          <Field label="Mobile number" hint="We text deadline-critical updates.">
            <input
              className="field-input tnum"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(816) 555-0134"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || !firebaseConfigured || phone.replace(/\D/g, '').length < 10}
            onClick={sendCode}
          >
            {busy ? 'Sending…' : 'Text me a code'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Verification code" hint={`Sent to ${phone}.`}>
            <input
              className="field-input tnum tracking-[0.5em] text-center text-lg"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || code.length < 6}
            onClick={verifyCode}
          >
            {busy ? 'Verifying…' : 'Sign in'}
          </Button>
          <Button variant="quiet" className="w-full" onClick={() => setStage('phone')}>
            Use a different number
          </Button>
        </div>
      )}

      <div className="my-6 flex items-center gap-3">
        <Rule className="flex-1" />
        <span className="text-xs uppercase tracking-widest text-ink-faint">or</span>
        <Rule className="flex-1" />
      </div>

      <Button variant="ghost" className="w-full" disabled={!firebaseConfigured} onClick={google}>
        Continue with Google
      </Button>

      {error && <p className="mt-4 text-sm text-tournament">{error}</p>}
      <div id="recaptcha" />

      <p className="mt-8 text-center text-xs text-ink-faint">
        18+ only. By continuing you accept the Terms of Service and the liability
        waiver &amp; assumption of risk.
      </p>
    </div>
  );
}
