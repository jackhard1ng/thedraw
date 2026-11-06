/**
 * Course setup — give the KC courses you'll actually use their hole pars +
 * stroke index + tee ratings, so live scoring shows full to-par and correct
 * net strokes. A course with tee sets + stroke index is promoted to
 * `supported`; hole pars unlock live to-par.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HOW TO USE
 * 1. Mint the course doc with the RIGHT place_id first. The app keys courses by
 *    Google place_id, and events must reference the same id, so the safest way
 *    to get it is: in the app, create a post or event and SELECT the course from
 *    the search box once. That creates `courses/<placeId>` (tier "listed").
 * 2. Find its placeId: Organizer console → Course data (the panel lists your
 *    market's courses), or read the `courses` collection in the Firebase console.
 * 3. Fill a COURSES entry below with that placeId and the data off the course's
 *    scorecard (hole 1 → 18). Ratings/slopes are free at https://ncrdb.usga.org.
 * 4. Run it against your LIVE project:
 *      GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *      GOOGLE_CLOUD_PROJECT=<your-project-id> node scripts/setup-courses.mjs
 *    (Or against the emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 …)
 *
 * It is idempotent — safe to re-run after fixing a number. It will NOT run while
 * any entry still has the placeholder placeId "REPLACE_ME".
 *
 * You can also do this entirely in the app: Organizer → Course data now has a
 * "Hole pars" field alongside tee sets and stroke index. This script is just the
 * faster way to do several courses at once.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ===========================================================================
// EDIT THIS: one object per course. Copy the EXAMPLE, replace every value with
// real data off the scorecard, and delete the EXAMPLE line's `example: true`.
// ===========================================================================
const COURSES = [
  {
    example: true, // ← delete this line once the data below is real
    placeId: 'REPLACE_ME', // the Google place_id from step 2
    name: 'Example Municipal GC',
    marketId: 'kc',
    // One tee set minimum. name, yardage, rating, slope, par.
    teeSets: [
      { name: 'White', yardage: 6200, rating: 69.8, slope: 124, par: 71 },
    ],
    // 18 values, hole 1 → 18. Each of 1..18 exactly once (the "handicap" row).
    holeHandicapOrder: [7, 1, 13, 5, 17, 9, 3, 15, 11, 2, 14, 6, 18, 10, 4, 16, 12, 8],
    // 18 values, hole 1 → 18. Each 3..6 (the "par" row).
    holePars: [4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5],
  },
  // Add more KC courses here…
];

// --- validation (mirrors functions/src/courses.ts updateCourseData) --------
function validate(c) {
  const errs = [];
  if (!c.placeId || c.placeId === 'REPLACE_ME') errs.push('placeId is still REPLACE_ME');
  if (!c.name) errs.push('name is required');
  if (!c.marketId) errs.push('marketId is required');
  for (const t of c.teeSets ?? []) {
    if (!(t.name && t.slope >= 55 && t.slope <= 155 && t.rating > 50 && t.rating < 90 && t.par >= 54 && t.par <= 80 && t.yardage > 1000)) {
      errs.push(`tee "${t.name}": check slope (55-155), rating (50-90), par (54-80), yardage (>1000)`);
    }
  }
  const o = c.holeHandicapOrder;
  if (!o || o.length !== 18 || ![...o].sort((a, b) => a - b).every((v, i) => v === i + 1)) {
    errs.push('holeHandicapOrder must be the numbers 1-18, each exactly once');
  }
  const p = c.holePars;
  if (!p || p.length !== 18 || p.some((x) => x < 3 || x > 6)) {
    errs.push('holePars must be 18 values of 3-6');
  }
  return errs;
}

async function main() {
  const real = COURSES.filter((c) => !c.example);
  if (real.length === 0) {
    console.error('No courses to set up — edit scripts/setup-courses.mjs and fill in the COURSES array (remove the EXAMPLE).');
    process.exit(1);
  }
  let bad = false;
  for (const c of real) {
    const errs = validate(c);
    if (errs.length) {
      bad = true;
      console.error(`✗ ${c.name || c.placeId}: ${errs.join('; ')}`);
    }
  }
  if (bad) {
    console.error('\nFix the errors above and re-run. Nothing was written.');
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  for (const c of real) {
    const ref = db.doc(`courses/${c.placeId}`);
    const snap = await ref.get();
    const base = snap.exists
      ? {}
      : {
          // Create a minimal doc if the course was never selected in-app. Prefer
          // selecting it in-app first so the place_id matches real bookings.
          placeId: c.placeId,
          marketId: c.marketId,
          name: c.name,
          address: c.address ?? '',
          location: null,
          accessType: 'public',
          guestPolicy: null,
          bookingPlatform: null,
          bookingUrl: null,
          bookingWindowDays: null,
          bookingOpensAtLocal: null,
          roundCount: 0,
        };
    await ref.set(
      {
        ...base,
        teeSets: c.teeSets,
        holeHandicapOrder: c.holeHandicapOrder,
        holePars: c.holePars,
        // tee sets + stroke index = supported (unlocks net); hole pars = live to-par.
        tier: 'supported',
      },
      { merge: true },
    );
    console.log(`✓ ${c.name} (${c.placeId}) — supported, hole pars + stroke index set`);
  }
  console.log(`\nDone — ${real.length} course${real.length === 1 ? '' : 's'} ready for full live scoring.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
