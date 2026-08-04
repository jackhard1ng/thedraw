# The Draw

Competition and playing partners for golfers without a regular group —
tournaments, match play, and open tee times. Kansas City first, nationally
expandable.

This repository implements **Phase 1 — the board** from the build specification
(`the-draw-build-spec` / §6). Later phases are scaffolded but deliberately not
built ahead of schedule.

---

## What's built (Phase 1)

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
  (`src/features/moderation`, `functions/src/index.ts`)

## Stack (§3)

- **Frontend** — React + Vite + TypeScript, PWA-first (no app store for v1)
- **Styling** — Tailwind with the draw-sheet design tokens (§8)
- **Backend** — Firebase: Firestore, Cloud Functions, Auth, Cloud Messaging
- **Payments** — Stripe Connect (Phase 3, not yet wired)
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
  lib/                   money, handicap, eligibility, format, firebase, callables
  context/AuthContext    phone/Google auth + current-user profile
  components/ui          the printed-sheet primitives (§8)
  features/
    auth  onboarding  board  courses  chat  rounds  profile  moderation
functions/src/index.ts   Phase-1 callables (join/leave, report, block, delete)
firestore.rules          explicit, restrictive — the only guard on the data model
scripts/seed.mjs         seed a launch market
```

## Phase map (§6) — what comes next, and where it attaches

- **Phase 2 — Free tournaments** (winter): formats, tournaments, entries,
  brackets/pods, scheduling + forfeit ladder, result confirmation, standings.
  The `tournaments` / `entries` / `matches` / `awards` types already exist; the
  `matches.holes` array is modeled from day one so live scoring is a feature,
  not a migration.
- **Phase 3 — Paid tournaments** (April): Stripe Connect, `ledger`,
  authorize/capture, percentage purses, payout tables, weather automation.
  **Gate:** a legal opinion letter before cash purses (§7). `money.ts` already
  does integer-cents purse splitting and admin-fee itemization.
- **Phase 4 — Depth**: live scoring (RTDB), hole-by-hole cards, order of merit.
- **Phase 5 — Expansion**: per-market config, organizer onboarding.

## Legal hard lines (§7)

Money moves **only** through organizer-run tournaments with a published,
percentage-based purse and an itemized admin fee. Player-arranged stakes exist
only as a tag on a round post; the app never collects, holds, routes, or rakes
that money. No third-party wagering, no Calcuttas, no raffles. See §7 of the
spec before touching anything that involves money or competition.
