/**
 * Payment setup (spec §7). Two rails, both no-stored-value:
 *   - Connect Express onboarding so a winner receives payouts to THEIR account.
 *   - A SetupIntent to save a card for one-tap re-entry — the wallet UX with
 *     none of the money-transmitter exposure.
 */
import { onCall } from 'firebase-functions/v2/https';
import { db, requireAuth, requireActive } from './shared';
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
  const user = await requireActive(uid);
  const { connectId, url } = await connectOnboardingLink({
    existingConnectId: user.stripeConnectId,
    uid,
    returnUrl: RETURN_URL,
  });
  if (connectId !== user.stripeConnectId) {
    await db.doc(`users/${uid}`).update({ stripeConnectId: connectId });
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
  const user = await requireActive(uid);
  if (!stripeEnabled() || !user.stripeConnectId) return { onboarded: false };
  const onboarded = await accountPayoutsEnabled(user.stripeConnectId);
  const cached = (user as { connectOnboarded?: boolean }).connectOnboarded ?? false;
  if (onboarded !== cached) {
    await db.doc(`users/${uid}`).update({ connectOnboarded: onboarded });
  }
  return { onboarded };
});

export const createSetupIntent = onCall<Record<string, never>>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const customerId = await ensureCustomer(user.stripeCustomerId, {
    uid,
    phone: user.phone,
    name: user.displayName,
  });
  if (customerId !== user.stripeCustomerId) {
    await db.doc(`users/${uid}`).update({ stripeCustomerId: customerId });
  }
  const si = await stripeSetupIntent(customerId);
  return { clientSecret: si.client_secret as string };
});
