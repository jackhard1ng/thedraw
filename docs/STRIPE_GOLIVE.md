# Stripe Go-Live Checklist

How to take The Draw's money rails from test mode to real dollars — safely, and
without the platform ever holding a withdrawable balance.

## The model you're turning on (know this cold)

The Draw is built so that **the platform never holds money**:

- Entry fees are **authorized** (not charged) when a player enters.
- At close, if the field met its minimum, authorizations are **captured**.
- If the field came up short, authorizations are **voided** — nobody is charged.
- Winnings **transfer directly** to each winner's own Stripe Connect (Express)
  account. Nothing sits in a Draw balance overnight.

This is a deliberate compliance property (no stored value = far less
money-transmitter exposure). Everything below preserves it. Do not add a step
that routes winnings through a platform balance.

There is **no Stripe webhook endpoint** in this codebase, and that's fine for
launch: capture/void/transfer happen inline at close and on the scheduled
`tick`, not in response to async Stripe events. A webhook (for chargebacks and
async payout status) is a documented **post-launch** add, not a go-live blocker.

---

## Step 1 — Activate the Stripe account

In the Stripe Dashboard (live mode, not test):

- [ ] Complete business activation — legal entity, address, bank account for the
      platform's own account.
- [ ] Enable **Connect** and choose **Express** accounts.
- [ ] Set the **Connect branding** (name, logo, color) — players see this on the
      onboarding screen when they set up payouts.
- [ ] Confirm your platform can create Express accounts and transfers in your
      country (US / KC — yes).

## Step 2 — Swap the keys

**Client (browser)** — in `.env.production`:

```
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

**Functions (server)** — as a Firebase secret, never committed:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY   # paste sk_live_...
```

Then redeploy both so the new keys take effect:

```bash
npm run build
firebase deploy --only functions
firebase deploy --only hosting
```

> Test and live keys are different worlds. A `pk_live_` on the client talking to
> an `sk_test_` on the server (or vice-versa) fails confusingly. Make sure both
> sides are `live` before you test with a real card.

## Step 3 — Open the market gate

Paid events are gated per-market by `markets/{id}.paidEventsEnabled`. Until this
is `true`, every paid entry returns "Paid events are not enabled for this
market" — by design.

Flip it on the KC market doc:

- [ ] Set `markets/kc.paidEventsEnabled = true` (Firestore console, or a small
      admin script).

Leave it `false` in any market you haven't launched. This is your kill switch:
setting it back to `false` instantly stops new paid entries everywhere in that
market without a deploy.

## Step 4 — Prove one real dollar round-trips

Do this yourself, with a real card, before anyone else touches paid events.

- [ ] Set up your own **payout account**: sign in, go to payouts, complete
      Connect Express onboarding, confirm `checkPayoutStatus` reports
      `onboarded: true`.
- [ ] Create a $20 paid event (a real one, or a throwaway you'll refund).
- [ ] Enter with a real card → confirm an **authorization** appears in the
      Stripe dashboard (Payments → uncaptured).
- [ ] Let the event close with the minimum met → confirm the charge is
      **captured**.
- [ ] Confirm a **transfer** lands in the winner's connected account.
- [ ] Now test the short-field path: create another paid event, don't fill it,
      let it close under minimum → confirm the authorization is **voided** and
      no charge lands.
- [ ] **Refund** yourself for the captured test.

Only after both paths (capture and void) behave correctly do you announce paid
games.

## Step 5 — The money math sanity check

Confirm on a real close that the split matches the ledger:

- [ ] Admin fee respects the floor/cap ($10 min event fee, $20/entry cap).
- [ ] Purse split (largest-remainder) sums exactly to the captured pool minus
      admin fee — no missing or phantom cent.
- [ ] Ties split evenly; team winnings pay each teammate individually.
- [ ] A winner who never finished Connect onboarding: the payout row goes
      `pending`, and `settlePendingPayouts` on the next `tick` retries it once
      they onboard. Verify a pending row actually clears after onboarding.

---

## Post-launch (not blockers)

- **Chargeback / dispute webhook** — add a `constructEvent` endpoint to react to
  `charge.dispute.created` and async payout failures. Needed once volume makes
  manual dashboard monitoring impractical.
- **Radar rules** — tune Stripe Radar once you have real traffic patterns.
- **`onePerPhoneNumber`** — enforce one account per phone at the payments layer
  to blunt multi-account abuse.

## If something looks wrong

- Money rails inert / "Payments are not configured" → `STRIPE_SECRET_KEY` unset
  or not injected into the deployed function. Re-set the secret and redeploy
  functions.
- Entry rejected "Paid events are not enabled" → `markets/kc.paidEventsEnabled`
  is not `true`.
- Card form won't mount → `VITE_STRIPE_PUBLISHABLE_KEY` missing/wrong env, or
  key mode mismatch (live vs test) with the server.
