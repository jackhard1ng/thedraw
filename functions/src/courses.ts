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
import { db, FieldValue, requireAuth, requireActive } from './shared';

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
