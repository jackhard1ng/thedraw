/**
 * Keeping your own index current. GHIN revises twice a month, and until now an
 * index was frozen at onboarding — the card a stranger reads went stale.
 *
 * The rule that keeps this honest:
 *   - RAISING the index (gaining strokes) on a verified handicap drops the badge
 *     back to "pending" and files a re-verification request for the organizer.
 *   - LOWERING it (giving strokes) keeps the badge — nobody sandbags by getting
 *     better.
 * Entries already made keep the index frozen at entry, and an organizer's Tour
 * Index still overrides at the next entry. Source and GHIN number are kept.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, requireAuth, requireActive } from './shared';

export const updateMyIndex = onCall<{ index: number }>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const next = req.data.index;
  if (typeof next !== 'number' || !Number.isFinite(next) || next < -10 || next > 54) {
    throw new HttpsError('invalid-argument', 'Enter an index between +10 and 54.');
  }
  const index = Math.round(next * 10) / 10;
  const prev = user.handicap.index;
  const reverify = !!user.handicap.verifiedAt && index > prev;

  await db.doc(`users/${uid}`).update({
    'handicap.index': index,
    'handicap.updatedAt': FieldValue.serverTimestamp(),
    ...(reverify ? { 'handicap.verifiedAt': null, 'handicap.verifiedBy': null } : {}),
  });

  if (reverify) {
    const open = await db
      .collection('verificationRequests')
      .where('userId', '==', uid)
      .where('status', '==', 'open')
      .limit(1)
      .get();
    if (open.empty) {
      await db.collection('verificationRequests').add({
        userId: uid,
        marketId: user.marketId,
        displayName: user.displayName,
        ghinNumber: user.handicap.ghinNumber ?? null,
        sourceUrl: user.handicap.sourceUrl ?? null,
        note: `Index raised ${prev.toFixed(1)} → ${index.toFixed(1)} — re-verify.`,
        status: 'open',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
  return { ok: true, index, reverify };
});
