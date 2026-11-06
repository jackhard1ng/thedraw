# The Draw

Competition and playing partners for golfers without a regular group —
tournaments, match play, and open tee times. Kansas City first, nationally
expandable.

This repository implements the full build specification (`the-draw-build-spec`)
across Phases 1–4: the board, free and paid tournaments, and the depth layer.
The build order in §6 is respected in the code's structure — Phase 1 stands
alone and bootstraps the rest — but the competitive and money engines are all
present and wired.

> **Launch gates still apply.** Paid tournaments require both a per-market switch
> (`markets.paidEventsEnabled`) and the legal opinion letter in §7. Until Stripe
> keys are configured the money rails are inert and free events run end to end.
> Ship Phase 1 first; do not rush a paid event into the tail of a season (§6).

---

## What's built — by phase

### Phase 1 — the board

The board is the only feature that works with 12 users, which makes it the only
thing that can bootstrap the rest.

- **Auth** — phone (SMS) primary, Google secondary (`src/features/auth`)
- **Onboarding / profile** — real names, 18+ gate, handicap with source badge
  (`src/features/onboarding`, `src/features/profile`)
- **Handicap source badges + freshness** — GHIN / Linked / Self-declared, green
  under 30 days → amber → gray (`src/lib/handicap.ts`)
- **Course entry via Google Places** — keyed by `place_id`, never a name string
  (`src/features/courses/PlacesAutocomplete.tsx`)
- **Round posts** — the open board, with two required fields (timing + slots)
  and everything else behind "More options" (`src/features/board`)
- **Join / leave flow** — atomic, server-authoritative (`functions` +
  `src/lib/callable.ts`)
- **Chat** — per-post coordination thread, append-only (`src/features/chat`)
- **Filters** — vibe, stakes, booked-only, open-slots (`useRoundPosts.ts`)
- **Self-reported rounds** — separate from the verified index, no rating/slope
  required (`src/features/rounds`)
- **Block / report / delete** — required in Phase 1, all server-side
  (`src/features/moderation`, `functions/src/board.ts`)

### Phase 2 — free tournaments

Formats are **data, not code** (`formats/{id}`, seeded in `scripts/seed.mjs`) —
adding a format never touches the engine.

- **Tournaments + entries** — organizer-created, published payout grid, frozen
  combined index and seed (`functions/src/tournaments.ts`,
  `src/features/tournaments`)
- **Brackets** — single-elimination, byes to top seeds, frozen index shown every
  round (`functions/src/engine/bracket.ts`, `src/features/brackets`)
- **Pods** — round-robin, snake-drafted by seed (`functions/src/engine/pods.ts`)
- **Scheduling + forfeit ladder** — 48h availability, one self-serve extension,
  deterministic forfeit/walkover at deadline (`functions/src/engine/scheduling.ts`,
  `functions/src/scheduled.ts`)
- **Result confirmation** — submit → 48h to confirm or dispute → silence
  auto-confirms (§P1); stroke-play scorecards with partner attestation
- **Standings + awards** — placements not just wins, append-only, frozen bracket
  path (`functions/src/completion.ts`)
- **Leaderboards** — gross/net separate tables, scores to par, THRU, differential
  to index, shareable SVG→PNG card (`src/features/leaderboard`)
- **Spectating** — public match page, results feed, follow, season order of merit
  (`src/features/spectating`)
- **Education** — auto-generated pre-match card + inline glossary, no rules page
  (`src/lib/education.ts`, `src/features/matches`)
- **Organizer console** — create tournaments (legal lines enforced), verify
  handicaps, adjust Tour Index, resolve disputes, moderate, review event requests
  (`src/features/organizer`, `functions/src/organizer.ts`)

### Phase 3 — paid tournaments (gated)

- **Stripe Connect (Express)** — authorize at entry, capture at close, void under
  minimum, transfer winnings to the winner's own account — no stored value ever
  (`functions/src/lib/stripe.ts`, `functions/src/payments.ts`)
- **Ledger** — every money movement an append-only row; balances are summed,
  never stored (`functions/src/shared.ts` `writeLedger`)
- **Eligibility gates** — one evaluator, default + high-stakes rule sets
  (`functions/src/engine/eligibility.ts`)
- **Cancellation + weather** — deterministic; auto void/refund/reschedule on
  dangerous weather (`functions/src/scheduled.ts`)
- **One-tap re-entry** — saved-card SetupIntent, the wallet UX with none of the
  exposure (`createSetupIntent`)

### Phase 4 — depth (partial)

- **Order of merit** built; `matches.holes` / `scorecards.holes` arrays are
  modeled from day one so live scoring (RTDB) is a feature, not a migration.
- Live hole-by-hole scoring, held tee inventory, and negotiated league rates
  remain deferred per §6/§9.

### App Store (decided: web first, native later)

The web app IS the product until traction. When real users start asking "is
there an app?" (~a few thousand actives), wrap THIS codebase with Capacitor —
a packaging exercise, not a rewrite; web and store versions ship from the same
code. Until then the PWA carries everything: QR → playing in under a minute
with no install wall, every bracket/match/leaderboard a shareable URL, fixes
deployed in minutes, and no app-review gatekeeper on a money-adjacent product.
SMS covers the one thing iOS web apps can't (reliable deadline push).

## Stack (§3)

- **Frontend** — React + Vite + TypeScript, PWA-first (no app store for v1)
- **Styling** — Tailwind with the draw-sheet design tokens (§8)
- **Backend** — Firebase: Firestore, Cloud Functions, Auth, Cloud Messaging
- **Payments** — Stripe Connect Express (wired; inert without keys)
- **Course identity** — Google Places (`place_id` canonical)

Realtime Database is intentionally **not** used in v1 (reserved for Phase 4 live
scoring).

## Hard rules encoded in the code

These come from §3 and §7 and are load-bearing, not stylistic:

| Rule | Where it lives |
|---|---|
| All money is integer **cents**, never a float | `src/lib/money.ts`, every `...Cents` field |
| All money is **ledger rows**, never a `balance` field | `ledger` collection; `balanceForUser()` sums it |
| Money / bracket writes are **Cloud Functions only** | `firestore.rules`, `functions/` |
| Courses keyed by Google `place_id` | `courses/{placeId}`, Places component |
| Every entity carries a `marketId`; every query filters it | `models.ts`, `useRoundPosts.ts` |
| One `checkEligibility()`, called everywhere | `src/lib/eligibility.ts` |
| The app never holds or routes a player-arranged wager | `roundPost.stakesHandledByApp = false` |
| Handicaps always visible in results, with source + date | `handicap.ts`, profile / badges |

## Running locally

```bash
npm install
cp .env.example .env        # fill in Firebase + Places keys

# with the Firebase emulator suite (recommended for dev):
npm run emulators           # in one terminal (auth, firestore, functions)
# set VITE_USE_EMULATORS=true in .env, then:
npm run dev

# seed the KC market (against the emulator):
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=the-draw \
  node scripts/seed.mjs
```

Type-check and build:

```bash
npm run typecheck
npm run build
```

Functions:

```bash
cd functions && npm install && npm run build
```

## Project layout

```
src/
  types/models.ts        normative Firestore schema (§4) — field names are the contract
  lib/                   money, handicap, eligibility, education, leaderboard,
                         format, firebase, callables (full contract)
  context/AuthContext    phone/Google auth + current-user profile
  components/ui          the printed-sheet primitives (§8)
  features/
    auth onboarding board courses chat rounds profile moderation   (Phase 1)
    tournaments brackets leaderboard matches spectating organizer payments  (Phase 2–4)
    routes.tsx           feature route + nav manifest, mounted by App.tsx
functions/src/
  index.ts               re-exports every callable
  shared.ts              app init, auth guards, derived stats, ledger writer
  board.ts               Phase-1 callables
  tournaments.ts matches.ts completion.ts   lifecycle + results + awards/payouts
  organizer.ts social.ts payments.ts scheduled.ts
  engine/                pure, testable: bracket, pods, scoring, scheduling,
                         payout, eligibility, money
  lib/                   stripe, notify, matchgen
firestore.rules          explicit, restrictive — the only guard on the data model
firestore.indexes.json   composite indexes for every server query
scripts/seed.mjs         seed the launch market + the four formats
```

The engine modules under `functions/src/engine/` are pure and side-effect-free
(bracket seeding, purse splitting, forfeit resolution). They can be exercised
directly with `node` against the compiled `functions/lib/engine/*`.

## Phase 5 — expansion (not built)

Per-market admin tooling, organizer onboarding flows, and revenue share remain
deferred (§6). Multi-market is already structural: every entity carries a
`marketId`, a new city is a new `markets/{id}` document, and it launches
free-only then flips paid with no deploy.

## Legal hard lines (§7)

Money moves **only** through organizer-run tournaments with a published,
percentage-based purse and an itemized admin fee. Player-arranged stakes exist
only as a tag on a round post; the app never collects, holds, routes, or rakes
that money. No third-party wagering, no Calcuttas, no raffles. See §7 of the
spec before touching anything that involves money or competition.
