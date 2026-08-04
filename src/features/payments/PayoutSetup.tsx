/**
 * Payout setup — Stripe Connect Express onboarding (spec §7). Winnings pay out to
 * the player's OWN connected account; The Draw never holds a balance. The
 * callable returns a hosted onboarding URL we send them to.
 */
import { useState } from 'react';
import { Button, Card, SectionHeader } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { createConnectOnboardingLink } from '@/lib/callable';

export function PayoutSetup() {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = profile?.stripeConnectId != null;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await createConnectOnboardingLink({});
      // Hand off to Stripe's hosted Express onboarding.
      window.location.href = res.data.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <SectionHeader>Set up payouts</SectionHeader>
      <Card className="p-5">
        <p className="text-ink-soft">
          Winnings pay out directly to <span className="text-ink">your own</span>{' '}
          account through Stripe. The Draw never holds a balance, never routes your
          money through a wallet, and never takes a cut of a payout — only the
          itemized tournament administration fee disclosed at entry (§7).
        </p>

        {connected ? (
          <div className="mt-4 rounded-sm border border-pine/40 bg-pine/10 p-3 text-sm text-pine">
            Payouts are set up. You're ready to receive winnings.
          </div>
        ) : (
          <Button variant="primary" className="mt-5 w-full" disabled={busy} onClick={start}>
            {busy ? 'Opening Stripe…' : 'Set up payouts with Stripe'}
          </Button>
        )}
        {error && <p className="mt-3 text-sm text-tournament">{error}</p>}
      </Card>
    </div>
  );
}
