/**
 * The real card form (Stripe Elements). Two modes, matching the server:
 *   authorize — confirms a manual-capture PaymentIntent: the card is HELD now,
 *               charged only when the event runs (captured at close).
 *   setup     — confirms a SetupIntent: the card is SAVED now, charged at
 *               close. Used when close is too far out for an auth hold.
 * Card data goes straight to Stripe; The Draw's servers never see it.
 */
import { useEffect, useState } from 'react';
import type { Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Button, Spinner } from '@/components/ui';
import { getStripeClient } from '@/lib/stripeClient';

function SheetInner({
  mode,
  submitLabel,
  onSuccess,
  onCancel,
}: {
  mode: 'authorize' | 'setup';
  submitLabel: string;
  onSuccess: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const confirm =
      mode === 'authorize'
        ? stripe.confirmPayment({ elements, redirect: 'if_required' })
        : stripe.confirmSetup({ elements, redirect: 'if_required' });
    const { error: err } = await confirm;
    if (err) {
      setError(err.message ?? 'Payment failed — try another card.');
      setBusy(false);
      return;
    }
    try {
      await onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="mt-4 flex gap-2">
        <Button variant="primary" className="flex-1" disabled={busy || !stripe} onClick={submit}>
          {busy ? 'Processing…' : submitLabel}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-tournament">{error}</p>}
    </div>
  );
}

export function PaymentSheet({
  clientSecret,
  mode,
  submitLabel,
  onSuccess,
  onCancel,
}: {
  clientSecret: string;
  mode: 'authorize' | 'setup';
  submitLabel: string;
  onSuccess: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [stripe, setStripe] = useState<Stripe | null | undefined>(undefined);
  useEffect(() => {
    getStripeClient().then(setStripe);
  }, []);

  if (stripe === undefined) return <Spinner />;
  if (stripe === null) {
    return (
      <p className="text-sm text-ink-soft">
        Card payments aren't available yet on this deployment. Nothing was
        charged and your spot is not held — check back soon.
      </p>
    );
  }
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret,
        appearance: {
          variables: {
            colorPrimary: '#0A46C2',
            colorText: '#0E1A2B',
            fontFamily: 'Inter, system-ui, sans-serif',
            borderRadius: '4px',
          },
        },
      }}
    >
      <SheetInner mode={mode} submitLabel={submitLabel} onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}
