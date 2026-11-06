/**
 * Stripe Connect (Express) integration (spec §3/§7).
 *
 * The single most important compliance property: THE PLATFORM NEVER HOLDS A
 * WITHDRAWABLE BALANCE. Entry fees are authorized at registration and captured
 * at close; if the field is short, authorizations are voided. Winnings transfer
 * directly to the winner's own connected account on completion. Nothing is held
 * overnight (§P6, §7.1).
 *
 * Stripe is loaded lazily and degrades gracefully: without STRIPE_SECRET_KEY the
 * money rails are inert (free events still run end to end, paid events report a
 * clear precondition error). This lets Phases 1–2 ship before the Phase-3 legal
 * gate is cleared.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type Stripe from 'stripe';

let cached: Stripe | null = null;

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!stripeEnabled()) {
    throw new HttpsError(
      'failed-precondition',
      'Payments are not configured (STRIPE_SECRET_KEY unset). Paid events are disabled.',
    );
  }
  if (!cached) {
    // Lazy require so a functions deploy without Stripe still cold-starts fast.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require('stripe');
    const StripeCtor = (lib.default ?? lib) as new (
      key: string,
      config?: Record<string, unknown>,
    ) => Stripe;
    cached = new StripeCtor(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: '2024-06-20',
    });
  }
  return cached;
}

/** Ensure the user has a Stripe Customer; returns its id. */
export async function ensureCustomer(
  existingId: string | null,
  meta: { uid: string; phone: string; name: string },
): Promise<string> {
  const stripe = getStripe();
  if (existingId) return existingId;
  const customer = await stripe.customers.create({
    name: meta.name,
    phone: meta.phone,
    metadata: { uid: meta.uid },
  });
  return customer.id;
}

/**
 * Authorize (not capture) an entry fee. capture_method: 'manual' means the money
 * is only reserved; we capture at registrationCloses, or void if the field is
 * short — nobody is ever charged for an event that didn't run (§4 entries).
 */
export async function authorizeEntryFee(args: {
  amountCents: number;
  customerId: string;
  paymentMethodId?: string;
  tournamentId: string;
  entryId: string;
}) {
  const stripe = getStripe();
  return stripe.paymentIntents.create({
    amount: args.amountCents,
    currency: 'usd',
    customer: args.customerId,
    payment_method: args.paymentMethodId,
    payment_method_types: ['card'],
    capture_method: 'manual',
    confirm: !!args.paymentMethodId, // one-tap re-entry with a saved card
    off_session: !!args.paymentMethodId,
    metadata: { tournamentId: args.tournamentId, entryId: args.entryId },
  });
}

/**
 * Card auth holds expire after ~7 days, so events with long registration
 * windows save the payment method at entry instead and charge it here, at
 * close — immediate capture, off-session. Same player promise either way:
 * charged only if the event runs.
 */
export async function chargeSavedMethod(args: {
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  tournamentId: string;
  entryId: string;
}) {
  const stripe = getStripe();
  return stripe.paymentIntents.create({
    amount: args.amountCents,
    currency: 'usd',
    customer: args.customerId,
    payment_method: args.paymentMethodId,
    payment_method_types: ['card'],
    confirm: true,
    off_session: true,
    metadata: { tournamentId: args.tournamentId, entryId: args.entryId },
  });
}

export async function retrievePaymentIntent(id: string) {
  return getStripe().paymentIntents.retrieve(id);
}

export async function retrieveSetupIntent(id: string) {
  return getStripe().setupIntents.retrieve(id);
}

/** The truth about Connect onboarding — not "a link was clicked once". */
export async function accountPayoutsEnabled(connectId: string): Promise<boolean> {
  const acct = await getStripe().accounts.retrieve(connectId);
  return acct.payouts_enabled === true;
}

export async function captureIntent(paymentIntentId: string) {
  return getStripe().paymentIntents.capture(paymentIntentId);
}

export async function voidIntent(paymentIntentId: string) {
  return getStripe().paymentIntents.cancel(paymentIntentId);
}

export async function refundIntent(paymentIntentId: string) {
  return getStripe().refunds.create({ payment_intent: paymentIntentId });
}

/** Transfer winnings to a connected account — the platform holds nothing. */
export async function payout(args: {
  amountCents: number;
  destinationConnectId: string;
  tournamentId: string;
  toUserId: string;
}) {
  const stripe = getStripe();
  return stripe.transfers.create({
    amount: args.amountCents,
    currency: 'usd',
    destination: args.destinationConnectId,
    metadata: { tournamentId: args.tournamentId, toUserId: args.toUserId },
  });
}

/** Express onboarding link so a winner can receive payouts to their own account. */
export async function connectOnboardingLink(args: {
  existingConnectId: string | null;
  uid: string;
  returnUrl: string;
}): Promise<{ connectId: string; url: string }> {
  const stripe = getStripe();
  let connectId = args.existingConnectId;
  if (!connectId) {
    const acct = await stripe.accounts.create({
      type: 'express',
      metadata: { uid: args.uid },
      capabilities: { transfers: { requested: true } },
    });
    connectId = acct.id;
  }
  const link = await stripe.accountLinks.create({
    account: connectId,
    refresh_url: args.returnUrl,
    return_url: args.returnUrl,
    type: 'account_onboarding',
  });
  return { connectId, url: link.url };
}

/** SetupIntent for a saved card — powers one-tap re-entry (§ payouts). */
export async function createSetupIntent(customerId: string) {
  return getStripe().setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
  });
}
