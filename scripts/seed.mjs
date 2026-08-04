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
for (const f of FORMATS) await db.doc(`formats/${f.id}`).set(f, { merge: true });
console.log(`Seeded ${FORMATS.length} formats`);

process.exit(0);
