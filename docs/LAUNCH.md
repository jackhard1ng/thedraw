# The Draw — Launch Runbook

The product is built. This is the ordered path from a clean repo to your first
real, paid Saturday Classic in Kansas City. Follow it top to bottom. Do not
skip ahead to flyers — an empty board on a cold scan is the one failure that
wastes real attention.

The whole plan is four moves:

1. **Deploy** — get it live on a real URL.
2. **Turn on money** — flip Stripe to live and prove one $20 entry end to end.
3. **Seed** — create the first game and fill it with people you already know.
4. **Promote** — drop the QR flyers, now that a scan lands on a live board.

---

## 0. One-time accounts you need

| Thing | Why | Where |
| --- | --- | --- |
| Firebase project (Blaze plan) | Hosting, Firestore, Auth, Cloud Functions | console.firebase.google.com |
| Stripe account (live mode) | Entry authorizations + payouts to winners | dashboard.stripe.com |
| Google Cloud Places API key | Course lookup by `place_id` | console.cloud.google.com |
| Twilio account (optional at launch) | Critical-deadline SMS | twilio.com |
| A domain | The URL on the flyer | any registrar |

Firebase **must** be on the Blaze (pay-as-you-go) plan — Cloud Functions won't
deploy on the free Spark plan. Realistic cost at launch scale is a few dollars a
month.

---

## 1. Deploy to production

### 1a. Point the repo at your Firebase project

There is no `.firebaserc` committed (on purpose — the project id isn't secret,
but it's yours to set). Create it:

```bash
npm i -g firebase-tools
firebase login
firebase use --add        # pick your project, alias it "default"
```

That writes `.firebaserc`. Commit it if you like — it only names the project.

### 1b. Set the web (client) env

Copy `.env.example` to `.env.production` and fill every `VITE_*` value from the
Firebase console (Project settings → Your apps → SDK config) plus your Places
and Stripe **publishable** keys:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_GOOGLE_PLACES_KEY=...
VITE_FIREBASE_VAPID_KEY=...            # Cloud Messaging → Web Push certificates
VITE_USE_EMULATORS=false
VITE_DEFAULT_MARKET_ID=kc
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...   # can stay pk_test_ until step 2
```

> These are safe to expose in the browser — access is governed by
> `firestore.rules`, not by secrecy. The **secret** Stripe key never goes here;
> it lives on the functions side (step 2).

### 1c. Set the functions (server) secrets

The functions read plain `process.env` values. Set them as Firebase Functions
secrets (encrypted, not committed):

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY     # sk_test_... for now
firebase functions:secrets:set APP_URL               # https://thedraw.app (your domain)
# Optional at launch — SMS for critical deadlines:
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_FROM
```

> If you set secrets, confirm each function that uses them declares it in its
> `runWith`/`secrets` binding, or Cloud Functions v2 won't inject it. Grep for
> `STRIPE_SECRET_KEY` and `TWILIO_` in `functions/src` and make sure the
> deployed function can see them (a redeploy after `secrets:set` is required).

### 1d. Push the rules, indexes, functions, and site

```bash
npm run build                       # tsc + vite build → dist/  (must pass clean)
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
firebase deploy --only hosting
```

Deploy rules/indexes/functions **before** hosting so the live site never talks
to a backend that's a step behind it.

### 1e. Domain + auth

- **Custom domain:** Firebase console → Hosting → Add custom domain, follow the
  DNS steps at your registrar. (Or park the flyer QR on the
  `*.web.app` URL for day one and swap later.)
- **Auth domains:** Firebase console → Authentication → Settings → Authorized
  domains — add your custom domain, or phone/Google sign-in will silently fail
  on it.
- **Phone auth:** make sure Phone is enabled as a sign-in provider and you have
  SMS quota. Test a real phone-number login on the live URL before anyone else
  does.

### 1f. Smoke test the live signed-out experience

Open the production URL in a fresh browser:

- [ ] Landing renders, live-board teaser doesn't error (empty is fine).
- [ ] Sign up with a real phone number → onboarding → your profile.
- [ ] Create a **free** event; confirm it appears on the board.
- [ ] Open it in a second (signed-out) browser via its share link — spectating
      works.

If free events work end to end, Phase 1 is live. Money is the next gate.

---

## 2. Turn on money (Stripe live)

This has its own detailed checklist — see **[STRIPE_GOLIVE.md](./STRIPE_GOLIVE.md)**.
The short version:

1. Activate your Stripe account (business details, bank account) and enable
   **Connect** (Express).
2. Swap `sk_test_` → `sk_live_` in the functions secret and `pk_test_` →
   `pk_live_` in `VITE_STRIPE_PUBLISHABLE_KEY`; redeploy functions + hosting.
3. Flip the market's `paidEventsEnabled` flag to `true` on `markets/kc`.
4. Run **one real $20 entry through your own card**, capture at close, and
   confirm the payout lands in a connected account. Refund yourself after.

Do not announce paid events until that one real dollar has round-tripped.

---

## 3. Seed the first real game

A network product is a ghost town at zero. Before any flyer:

- [ ] Seed the KC market + a few real courses (see `scripts/seed.mjs`; point it
      at your **live** project, not the emulator).
- [ ] Create the **first Saturday Classic** with a real date, real course, real
      $20 entry — a Saturday morning before a college-football kickoff.
- [ ] Personally get **4–8 people you already know** to enter. Your regular
      group, buddies from the range. Text them the share link.
- [ ] Play it. Score it. Let it close and pay out for real.

Now you have proof of life, your first real payout screenshot, and people who'll
vouch. That screenshot is your best marketing asset — nothing sells a money
game like a real transfer.

---

## 4. Promote (QR flyers)

Only now. The app already captures `?src=coursename` at onboarding, so every
drop is measurable.

- [ ] Make a flyer with a QR to `https://your-domain/?src=shoalcreek` (one code
      per location so you can see what converts).
- [ ] Drop them at Shoal Creek, Royal Meadows, the range, muni counters — the
      places golfers without a league already stand around.
- [ ] Lead the flyer with the payout proof and the show-up promise, not the
      feature list.

Then watch the board. Real golfers tell you what to build next far better than
another imagined persona will.

---

## What to deliberately NOT do before launch

These are real, but they're post-launch — you learn whether they matter by
watching a live market, not by building on spec:

- 2-vs-1 "Challenge Match" asymmetric format
- Women-only draw pool
- Per-player mixed-tee handicapping (only bites net play at rated courses; your
  casual crews use ratingless net, which is already correct)
- Stripe chargeback webhook (manual-capture design doesn't require it to
  operate; add it once real volume justifies the async handling)
- `onePerPhoneNumber` hard enforcement

Ship. Learn. Then decide.
