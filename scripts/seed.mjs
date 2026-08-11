/**
 * Seed the launch market (spec §4 markets). A new city is just a new document,
 * launched free-only and flipped to paid when ready — no deploy required.
 *
 * Run against the Firestore emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   GOOGLE_CLOUD_PROJECT=the-draw node scripts/seed.mjs
 *
 * Or against a real project with GOOGLE_APPLICATION_CREDENTIALS set.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const KC = {
  id: 'kc',
  name: 'Kansas City',
  timezone: 'America/Chicago',
  activeSeasonStart: new Date('2026-04-01T00:00:00Z'),
  activeSeasonEnd: new Date('2026-11-15T00:00:00Z'),
  paidEventsEnabled: false, // launches free-only (§4)
  enabledFormats: ['singlesMatch', 'twoManScramble', 'grossFoursome'],
  organizerIds: [], // populated when the first organizer is appointed
  adminFeePercent: 25,
  // Phase 5 franchise economics: the market organizer (Jack in KC; a local
  // golf influencer elsewhere) earns this % of every admin fee in the market.
  marketOrganizerId: null, // set to the organizer's uid when appointed
  organizerSharePercent: 30,
};

await db.doc(`markets/${KC.id}`).set(KC, { merge: true });
console.log(`Seeded market: ${KC.name}`);

// Formats are DATA, not code (§4) — adding a format must never require an engine
// change. These are the four launch formats.
const FORMATS = [
  {
    id: 'singlesMatch',
    name: 'Singles Match Play',
    teamSize: 1,
    scoring: 'matchPlay',
    handicapAllowance: null,
    advancement: 'bracket',
    holes: 18,
    flightBy: 'individualIndex',
    requiresWitness: true,
    eligibleForMoney: true,
  },
  {
    id: 'twoManScramble',
    name: '2-Man Scramble',
    teamSize: 2,
    scoring: 'scramble',
    handicapAllowance: { type: 'scramble2', low: 0.35, high: 0.15 },
    advancement: 'bracket',
    holes: 18,
    flightBy: 'combinedIndex',
    requiresWitness: true,
    eligibleForMoney: true,
  },
  {
    id: 'grossFoursome',
    name: 'Single-Round Gross Foursome',
    teamSize: 1,
    scoring: 'strokePlay',
    handicapAllowance: null, // gross — no strokes given
    advancement: 'singleRound',
    groupSize: 4,
    flightBy: 'individualIndex',
    requiresWitness: true, // satisfied: all 4 mark each other (§P3)
    eligibleForMoney: true,
  },
  {
    id: 'multiRoundStrokePlay',
    name: 'Multi-Round Stroke Play',
    teamSize: 1,
    scoring: 'strokePlay',
    handicapAllowance: { type: 'strokePlay', percent: 0.95 },
    advancement: 'cumulative',
    rounds: 3,
    designatedCourses: [], // one placeId per round — required for net
    scoringMode: 'both',
    flightBy: 'individualIndex',
    requiresWitness: true,
    eligibleForMoney: true,
  },
];
// 9-hole formats — the weeknight league replacement. Formats are data (§4):
// adding these touches no engine code. Gross-only for nines in v1 (no stroke
// allocation questions on a 9).
FORMATS.push(
  {
    id: 'twilightNine',
    name: 'Twilight Nine',
    teamSize: 1,
    scoring: 'strokePlay',
    handicapAllowance: null, // gross
    advancement: 'singleRound',
    holes: 9,
    groupSize: 4,
    flightBy: 'individualIndex',
    requiresWitness: true, // four mutual markers (§P3)
    eligibleForMoney: true,
  },
  {
    id: 'nineHoleMatch',
    name: '9-Hole Match (scratch)',
    teamSize: 1,
    scoring: 'matchPlay',
    // Explicitly scratch — {type:'none'} (vs null, which for match play means
    // "full index difference"). The pre-match card says so instead of
    // inventing a stroke spread.
    handicapAllowance: { type: 'none' },
    advancement: 'bracket',
    holes: 9,
    flightBy: 'individualIndex',
    requiresWitness: true,
    eligibleForMoney: true,
  },
);

for (const f of FORMATS) await db.doc(`formats/${f.id}`).set(f, { merge: true });
console.log(`Seeded ${FORMATS.length} formats`);

// Instant-event templates (addendum §2) — the 10% tier. Members instantiate
// these; the template is the organizer's act.
const TEMPLATES = [
  {
    // Day-one on-ramp: FREE, 9 holes, runs at 4+. A brand-new market has
    // something enterable the moment the second player signs up — and a free
    // event is the apprenticeship path toward money-event eligibility.
    id: 'freeNine',
    marketId: 'kc',
    name: 'Open Nine — Free',
    formatId: 'twilightNine',
    fieldSize: 8,
    fieldSizeMin: 4,
    entryFeeMinCents: 0,
    entryFeeMaxCents: 0,
    allowedPayoutShapes: ['winnerTakeAll'],
    adminFeePercent: 0,
    requiresGhinAboveCents: 999999,
    active: true,
  },
  {
    // Tier-banded: C/D players only (index 10.1+). The whole point of tiers —
    // a 16 competes against 14s and 19s, not against the club champion.
    id: 'cdNine',
    marketId: 'kc',
    name: 'C/D Flight Nine (10.1+ only)',
    formatId: 'twilightNine',
    indexRange: [10.1, 54],
    fieldSize: 8,
    fieldSizeMin: 4,
    entryFeeMinCents: 1000,
    entryFeeMaxCents: 5000,
    allowedPayoutShapes: ['70_30', 'winnerTakeAll'],
    adminFeePercent: 10,
    requiresGhinAboveCents: 7500,
    active: true,
  },
  {
    // The flagship: 8–16 players, Saturday morning stroke play, done by noon —
    // trophy settled before college football kicks off. Runs at 8+, caps at 16.
    id: 'saturdayClassic',
    marketId: 'kc',
    name: 'The Saturday Classic',
    formatId: 'grossFoursome',
    fieldSize: 16,
    fieldSizeMin: 8,
    entryFeeMinCents: 2000,
    entryFeeMaxCents: 10000,
    allowedPayoutShapes: ['60_30_10', '70_30', 'winnerTakeAll'],
    adminFeePercent: 10,
    requiresGhinAboveCents: 7500,
    active: true,
  },
  {
    id: 'sundayFoursome',
    marketId: 'kc',
    name: 'Sunday Foursome',
    formatId: 'grossFoursome',
    fieldSize: 4,
    entryFeeMinCents: 2000,
    entryFeeMaxCents: 20000,
    allowedPayoutShapes: ['winnerTakeAll', '70_30', '60_30_10'],
    adminFeePercent: 10,
    requiresGhinAboveCents: 7500,
    active: true,
  },
  {
    id: 'headToHead',
    marketId: 'kc',
    name: 'Head-to-Head Match',
    formatId: 'singlesMatch',
    fieldSize: 2,
    entryFeeMinCents: 2000,
    entryFeeMaxCents: 10000,
    allowedPayoutShapes: ['winnerTakeAll'],
    adminFeePercent: 10,
    requiresGhinAboveCents: 7500,
    active: true,
  },
  {
    id: 'twoVTwoScramble',
    marketId: 'kc',
    name: '2v2 Scramble',
    formatId: 'twoManScramble',
    fieldSize: 2, // two team entries
    entryFeeMinCents: 4000,
    entryFeeMaxCents: 20000,
    allowedPayoutShapes: ['winnerTakeAll'],
    adminFeePercent: 10,
    requiresGhinAboveCents: 7500,
    active: true,
  },
];
TEMPLATES.push({
  id: 'twilightNine',
  marketId: 'kc',
  name: 'Twilight Nine',
  formatId: 'twilightNine',
  fieldSize: 4,
  entryFeeMinCents: 1000,
  entryFeeMaxCents: 10000,
  allowedPayoutShapes: ['winnerTakeAll', '70_30'],
  adminFeePercent: 10,
  requiresGhinAboveCents: 7500,
  active: true,
});

for (const t of TEMPLATES) await db.doc(`eventTemplates/${t.id}`).set(t, { merge: true });
console.log(`Seeded ${TEMPLATES.length} instant-event templates`);

process.exit(0);
