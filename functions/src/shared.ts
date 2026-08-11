/**
 * Shared server helpers: app init, auth guards, derived stats, ledger writer.
 * Everything money- or bracket-touching runs here behind Auth; the Admin SDK
 * bypasses firestore.rules by design (§3), so these guards ARE the enforcement.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

if (!getApps().length) initializeApp();
export const db = getFirestore();
export { FieldValue, Timestamp };

export function requireAuth(auth: { uid: string } | undefined): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return auth.uid;
}

export interface UserDoc {
  marketId: string;
  displayName: string;
  age: number;
  role: 'member' | 'organizer' | 'admin';
  organizerMarkets: string[];
  canCreatePaidEvents: boolean;
  status: 'active' | 'restricted' | 'banned';
  createdAt: Timestamp;
  handicap: {
    index: number;
    source: 'ghin' | 'thirdParty' | 'self';
    verifiedAt: Timestamp | null;
  };
}

export async function getUser(uid: string): Promise<UserDoc> {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Finish onboarding first.');
  return snap.data() as UserDoc;
}

/**
 * PII + billing live in users/{uid}/private/data (rules: owner-readable,
 * owner may write contact fields only) — the public users doc is readable by
 * every signed-in member, so phone numbers and Stripe ids must not sit on it.
 * Reads fall back to the legacy users-doc fields so accounts created before
 * the privacy split keep working.
 */
export interface PrivateData {
  phone: string;
  fcmTokens: string[];
  stripeCustomerId: string | null;
  stripeConnectId: string | null;
  connectOnboarded: boolean;
}

export async function getPrivate(uid: string): Promise<PrivateData> {
  const [priv, user] = await Promise.all([
    db.doc(`users/${uid}/private/data`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  const p = (priv.data() ?? {}) as Partial<PrivateData>;
  const u = (user.data() ?? {}) as Partial<PrivateData>;
  return {
    phone: p.phone ?? u.phone ?? '',
    fcmTokens: p.fcmTokens ?? u.fcmTokens ?? [],
    stripeCustomerId: p.stripeCustomerId ?? u.stripeCustomerId ?? null,
    stripeConnectId: p.stripeConnectId ?? u.stripeConnectId ?? null,
    connectOnboarded: p.connectOnboarded ?? u.connectOnboarded ?? false,
  };
}

export async function setPrivate(uid: string, patch: Partial<PrivateData>) {
  await db.doc(`users/${uid}/private/data`).set(patch, { merge: true });
}

/**
 * Chat privacy: threads/{threadId}.memberIds is what firestore.rules checks
 * before letting anyone read or post in a thread. Functions maintain it at
 * every membership change — a thread with no doc is readable by no one.
 */
export async function addThreadMembers(threadId: string, uids: string[]) {
  if (uids.length === 0) return;
  await db
    .doc(`threads/${threadId}`)
    .set({ memberIds: FieldValue.arrayUnion(...uids) }, { merge: true });
}

export async function removeThreadMembers(threadId: string, uids: string[]) {
  if (uids.length === 0) return;
  await db
    .doc(`threads/${threadId}`)
    .set({ memberIds: FieldValue.arrayRemove(...uids) }, { merge: true });
}

export async function requireActive(uid: string): Promise<UserDoc> {
  const u = await getUser(uid);
  if (u.status === 'banned') throw new HttpsError('permission-denied', 'Account banned.');
  return u;
}

/** An organizer for `marketId`, or an admin (cross-market). */
export async function requireOrganizer(uid: string, marketId: string): Promise<UserDoc> {
  const u = await requireActive(uid);
  const ok = u.role === 'admin' || (u.role === 'organizer' && u.organizerMarkets.includes(marketId));
  if (!ok) throw new HttpsError('permission-denied', 'Organizer only.');
  return u;
}

/**
 * Derived stats (§4 — attendance, event count, etc. are NEVER stored). Computed
 * on demand from reputationEvents, competitive entries, and attested rounds.
 */
export async function deriveStats(uid: string, now: number) {
  const [reps, entries, rounds, user] = await Promise.all([
    db.collection('reputationEvents').where('userId', '==', uid).get(),
    db.collection('entries').where('userIds', 'array-contains', uid).get(),
    db.collection('rounds').where('userId', '==', uid).where('source', 'in', ['attested', 'tournament']).get(),
    getUser(uid),
  ]);
  const committed = reps.docs.filter((d) => d.data().type === 'committed').length;
  const played = reps.docs.filter((d) => d.data().type === 'played').length;
  const eventsCompleted = entries.docs.filter((d) => {
    const s = d.data().status;
    return s === 'eliminated' || s === 'active';
  }).length;
  return {
    eventsCompleted,
    attestedRounds: rounds.size,
    attendanceRate: committed === 0 ? 1 : played / committed,
    accountAgeDays: user.createdAt ? (now - user.createdAt.toMillis()) / 86_400_000 : 0,
    // Card details are collected inline at entry (Stripe Elements), so a
    // missing saved card is never a reason to block an entry.
    hasPaymentMethod: true,
  };
}

/** Append a ledger row. There is no balance field anywhere — this is the record. */
export async function writeLedger(row: {
  type: string;
  amountCents: number;
  fromUserId: string | null;
  toUserId: string | null;
  tournamentId: string | null;
  matchId: string | null;
  stripeRef: string;
  note: string;
}) {
  if (!Number.isInteger(row.amountCents)) {
    throw new HttpsError('internal', 'Ledger amounts must be integer cents.');
  }
  await db.collection('ledger').add({ ...row, timestamp: FieldValue.serverTimestamp() });
}

/** Record a reputation event (~1yr expiry; old flakes shouldn't follow forever). */
export async function writeReputation(
  userId: string,
  type: string,
  matchId: string | null,
  now: number,
) {
  await db.collection('reputationEvents').add({
    userId,
    type,
    matchId,
    timestamp: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + 365 * 86_400_000),
  });
}
