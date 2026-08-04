/**
 * Payment setup (spec §7). Two rails, both no-stored-value:
 *   - Connect Express onboarding so a winner receives payouts to THEIR account.
 *   - A SetupIntent to save a card for one-tap re-entry — the wallet UX with
 *     none of the money-transmitter exposure.
 */
import { onCall } from 'firebase-functions/v2/https';
import { db, requireAuth, requireActive } from './shared';
import { connectOnboardingLink, ensureCustomer, createSetupIntent as stripeSetupIntent } from './lib/stripe';

const RETURN_URL = process.env.APP_URL ? `${process.env.APP_URL}/me/payouts` : 'https://thedraw.app/me/payouts';

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
