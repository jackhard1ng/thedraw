/**
 * Course documents (spec §4). `listed` courses come free from Places
 * autocomplete — this callable upserts one the first time any user selects a
 * course, and bumps roundCount on reuse (the promotion queue signal).
 *
 * Without this, no course doc ever exists, and everything keyed off
 * `courses/{placeId}` — weather automation, booking-window notices, net
 * eligibility — is dead on arrival. Clients cannot write `courses` directly
 * (firestore.rules), so this is the single creation path.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, requireAuth, requireActive, requireOrganizer } from './shared';

export const ensureCourse = onCall<{
  placeId: string;
  name: string;
  address: string;
  location: { lat: number; lng: number } | null;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const { placeId, name, address, location } = req.data;
  if (!placeId || !name) throw new HttpsError('invalid-argument', 'placeId and name required.');

  const ref = db.doc(`courses/${placeId}`);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ roundCount: FieldValue.increment(1) });
    return { created: false };
  }
  await ref.set({
    placeId,
    marketId: user.marketId,
    name: String(name).slice(0, 120),
    address: String(address ?? '').slice(0, 200),
    location: location ?? null,
    tier: 'listed', // promoted to 'supported' by an organizer with scorecard data
    accessType: 'public',
    guestPolicy: null,
    bookingPlatform: null,
    bookingUrl: null,
    bookingWindowDays: null,
    bookingOpensAtLocal: null,
    holeHandicapOrder: null,
    holePars: null,
    teeSets: null,
    roundCount: 1,
  });
  return { created: true };
});

/**
 * Organizer enters scorecard data — the alternative to bulk-importing a
 * national ratings database. Ratings/slopes are free to look up at
 * ncrdb.usga.org; hole handicap order comes off a scorecard photo, entered
 * once (spec §4). Entering full tee data + stroke index PROMOTES the course
 * to `supported`, which unlocks net scoring, weather automation richness,
 * booking-window notices, and different-tee match suggestions.
 */
export const updateCourseData = onCall<{
  placeId: string;
  teeSets?: { name: string; yardage: number; rating: number; slope: number; par: number }[];
  holeHandicapOrder?: number[];
  holePars?: number[];
  accessType?: 'public' | 'dailyFee' | 'semiPrivate' | 'private';
  bookingPlatform?: string | null;
  bookingUrl?: string | null;
  bookingWindowDays?: number | null;
  bookingOpensAtLocal?: string | null;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`courses/${req.data.placeId}`);
  const course = (await ref.get()).data() as { marketId: string } | undefined;
  if (!course) throw new HttpsError('not-found', 'Course not found — select it once via search first.');
  await requireOrganizer(uid, course.marketId);

  const patch: Record<string, unknown> = {};

  if (req.data.teeSets) {
    for (const t of req.data.teeSets) {
      const ok =
        t.name && t.slope >= 55 && t.slope <= 155 && t.rating > 50 && t.rating < 90 &&
        t.par >= 54 && t.par <= 80 && t.yardage > 1000;
      if (!ok) throw new HttpsError('invalid-argument', `Tee "${t.name}": check slope (55-155), rating, par, yardage.`);
    }
    patch.teeSets = req.data.teeSets;
  }
  if (req.data.holeHandicapOrder) {
    const o = req.data.holeHandicapOrder;
    const isPerm = o.length === 18 && [...o].sort((a, b) => a - b).every((v, i) => v === i + 1);
    if (!isPerm) throw new HttpsError('invalid-argument', 'Stroke index must be the numbers 1-18, each exactly once.');
    patch.holeHandicapOrder = o;
  }
  if (req.data.holePars) {
    if (req.data.holePars.length !== 18 || req.data.holePars.some((p) => p < 3 || p > 6)) {
      throw new HttpsError('invalid-argument', 'Hole pars must be 18 values of 3-6.');
    }
    patch.holePars = req.data.holePars;
  }
  for (const k of ['accessType', 'bookingPlatform', 'bookingUrl', 'bookingWindowDays', 'bookingOpensAtLocal'] as const) {
    if (req.data[k] !== undefined) patch[k] = req.data[k];
  }

  await ref.update(patch);

  // Promotion: full tee data + stroke index = a supported course (§4 tiers).
  const after = (await ref.get()).data() as { teeSets: unknown[] | null; holeHandicapOrder: number[] | null; tier: string };
  if (after.tier !== 'supported' && after.teeSets?.length && after.holeHandicapOrder) {
    await ref.update({ tier: 'supported' });
    return { ok: true, promoted: true };
  }
  return { ok: true, promoted: false };
});
