/**
 * Stripe.js, loaded lazily so the board never carries the payment bundle.
 * Degrades honestly: without VITE_STRIPE_PUBLISHABLE_KEY the paid UI says
 * payments aren't available yet instead of failing on tap.
 */
import type { Stripe } from '@stripe/stripe-js';

let promise: Promise<Stripe | null> | null = null;

export function stripeClientEnabled(): boolean {
  return !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
}

export function getStripeClient(): Promise<Stripe | null> {
  if (!stripeClientEnabled()) return Promise.resolve(null);
  if (!promise) {
    promise = import('@stripe/stripe-js').then(({ loadStripe }) =>
      loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY),
    );
  }
  return promise;
}
