/**
 * Payout setup — Stripe Connect Express onboarding (spec §7). Winnings pay out to
 * the player's OWN connected account; The Draw never holds a balance.
 *
 * "Set up" here means what Stripe says it means: we ask checkPayoutStatus
 * (payouts_enabled on the real account), never just "an onboarding link was
 * created once". A half-finished onboarding shows as unfinished, with the way
 * back in one tap. Any prize that was waiting pays out automatically within
 * the hour once onboarding completes.
 */
import { useEffect, useState } from 'react';
import { Button, Card, SectionHeader, Spinner } from '@/components/ui';
import { checkPayoutStatus, createConnectOnboardingLink } from '@/lib/callable';

export function PayoutSetup() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // undefined = still asking Stripe. `started` separates "never began" from
  // "began and abandoned Stripe's form" — different button labels.
  const [status, setStatus] = useState<{ onboarded: boolean; started: boolean } | undefined>();

  useEffect(() => {
    checkPayoutStatus({})
      .then((res) => setStatus(res.data))
      .catch(() => setStatus({ onboarded: false, started: false }));
  }, []);
  const onboarded = status?.onboarded;
  const started = status?.started ?? false;

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

        {onboarded === undefined ? (
          <div className="mt-4">
            <Spinner />
          </div>
        ) : onboarded ? (
          <div className="mt-4 rounded-sm border border-pine/40 bg-pine/10 p-3 text-sm text-pine">
            Payouts are active. Winnings land in your bank automatically —
            anything that was waiting pays out within the hour.
          </div>
        ) : (
          <>
            {started && (
              <p className="mt-4 text-sm text-tournament">
                Onboarding was started but not finished — Stripe can't pay you
                yet. Pick up where you left off:
              </p>
            )}
            <Button variant="primary" className="mt-4 w-full" disabled={busy} onClick={start}>
              {busy ? 'Opening Stripe…' : started ? 'Finish payout setup' : 'Set up payouts with Stripe'}
            </Button>
          </>
        )}
        {error && <p className="mt-3 text-sm text-tournament">{error}</p>}
      </Card>
    </div>
  );
}
