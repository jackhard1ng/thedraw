/**
 * Payment setup (spec §7). Two rails, both no-stored-value:
 *   - Connect Express onboarding so a winner receives payouts to THEIR account.
 *   - A SetupIntent to save a card for one-tap re-entry — the wallet UX with
 *     none of the money-transmitter exposure.
 */
import { onCall } from 'firebase-functions/v2/https';
import { getPrivate, requireAuth, requireActive, setPrivate } from './shared';
import {
  accountPayoutsEnabled,
  connectOnboardingLink,
  ensureCustomer,
  createSetupIntent as stripeSetupIntent,
  stripeEnabled,
} from './lib/stripe';

const RETURN_URL = process.env.APP_URL ? `${process.env.APP_URL}/payouts` : 'https://thedraw.app/payouts';

export const createConnectOnboardingLink = onCall<Record<string, never>>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const priv = await getPrivate(uid);
  const { connectId, url } = await connectOnboardingLink({
    existingConnectId: priv.stripeConnectId,
    uid,
    returnUrl: RETURN_URL,
  });
  if (connectId !== priv.stripeConnectId) {
    await setPrivate(uid, { stripeConnectId: connectId });
  }
  return { url };
});

/**
 * The truth about payout readiness. A stored stripeConnectId only means an
 * onboarding LINK was created — the user may have abandoned Stripe's form.
 * This asks Stripe whether payouts are actually enabled, and caches the
 * positive answer on the user doc (connectOnboarded) for the UI.
 */
export const checkPayoutStatus = onCall<Record<string, never>>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const priv = await getPrivate(uid);
  if (!stripeEnabled() || !priv.stripeConnectId) return { onboarded: false, started: !!priv.stripeConnectId };
  const onboarded = await accountPayoutsEnabled(priv.stripeConnectId);
  if (onboarded !== priv.connectOnboarded) {
    await setPrivate(uid, { connectOnboarded: onboarded });
  }
  return { onboarded, started: true };
});

export const createSetupIntent = onCall<Record<string, never>>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const priv = await getPrivate(uid);
  const customerId = await ensureCustomer(priv.stripeCustomerId, {
    uid,
    phone: priv.phone,
    name: user.displayName,
  });
  if (customerId !== priv.stripeCustomerId) {
    await setPrivate(uid, { stripeCustomerId: customerId });
  }
  const si = await stripeSetupIntent(customerId);
  return { clientSecret: si.client_secret as string };
});
