/**
 * Save a card for one-tap re-entry (spec §5). A Stripe SetupIntent confirmed
 * with real Elements — the wallet UX with none of the stored-value exposure
 * (§7). The card lives with Stripe; The Draw never sees the number.
 */
import { useState } from 'react';
import { Button, Card, SectionHeader } from '@/components/ui';
import { createSetupIntent } from '@/lib/callable';
import { stripeClientEnabled } from '@/lib/stripeClient';
import { PaymentSheet } from './PaymentSheet';

export function SavedCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const res = await createSetupIntent({});
      setClientSecret(res.data.clientSecret);
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

        {saved ? (
          <div className="mt-4 rounded-sm border border-pine/40 bg-pine/10 p-3 text-sm text-pine">
            Card saved. Future entries can charge it with one tap.
          </div>
        ) : clientSecret ? (
          <div className="mt-5">
            <PaymentSheet
              clientSecret={clientSecret}
              mode="setup"
              submitLabel="Save card"
              onSuccess={() => setSaved(true)}
              onCancel={() => setClientSecret(null)}
            />
          </div>
        ) : !stripeClientEnabled() ? (
          <p className="mt-4 text-sm text-ink-faint">
            Card payments aren't available yet on this deployment.
          </p>
        ) : (
          <Button variant="primary" className="mt-5 w-full" disabled={busy} onClick={begin}>
            {busy ? 'Preparing…' : 'Save a card'}
          </Button>
        )}
        {error && <p className="mt-3 text-sm text-tournament">{error}</p>}
      </Card>
    </div>
  );
}
