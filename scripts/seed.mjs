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
process.exit(0);
