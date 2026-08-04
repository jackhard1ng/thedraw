/**
 * Save a card for one-tap re-entry (spec §5). Uses a Stripe SetupIntent — the
 * wallet UX with none of the stored-value exposure (§7). The callable returns a
 * clientSecret; confirming it with Stripe Elements is stubbed here (Phase 3),
 * where a <CardElement> + stripe.confirmCardSetup(clientSecret, …) would attach
 * the payment method. For now we call the callable and confirm the secret exists.
 */
import { useState } from 'react';
import { Button, Card, SectionHeader } from '@/components/ui';
import { createSetupIntent } from '@/lib/callable';

export function SavedCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function saveCard() {
    setBusy(true);
    setError(null);
    try {
      const res = await createSetupIntent({});
      // Phase 3: pass res.data.clientSecret to Stripe Elements
      //   stripe.confirmCardSetup(clientSecret, { payment_method: { card } })
      // to attach the card off-session. We assert the secret came back here.
      if (res.data.clientSecret) setReady(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <SectionHeader>Save a card</SectionHeader>
      <Card className="p-5">
        <p className="text-ink-soft">
          Save a card once for one-tap re-entry into future events. Your card lives
          with Stripe, not with The Draw — we never store card numbers or hold a
          balance (§7).
        </p>

        {ready ? (
          <div className="mt-4 rounded-sm border border-pine/40 bg-pine/10 p-3 text-sm text-pine">
            Setup authorized. Card entry (Stripe Elements) is wired in Phase 3.
          </div>
        ) : (
          <Button variant="primary" className="mt-5 w-full" disabled={busy} onClick={saveCard}>
            {busy ? 'Preparing…' : 'Save a card'}
          </Button>
        )}
        {error && <p className="mt-3 text-sm text-tournament">{error}</p>}
      </Card>
    </div>
  );
}
