/**
 * Green fees + the cancellation ladder (spec §5).
 *
 * TWO MODES, and the default is the app doing NOTHING:
 *
 *   Default (~99% of tee times): green fees are PAID AT THE COURSE. Each
 *   player pays the pro shop directly. No money moves through the platform,
 *   nothing to split, nothing to reimburse.
 *
 *   Prepaid (opt-in): the booker actually fronted the whole group's cost
 *   (prepaid online rates, some weekend munis). Only then does the booker
 *   invoke collectGreenFees: each player's share is charged to their saved
 *   card and the collected funds transfer to the booker. "Debt between users
 *   must never exist" — the app either moves the money completely or stays
 *   out completely; it never tracks an IOU.
 *
 *   Floor: shares under $10/player are refused — card-processing overhead on
 *   pocket change approaches 15%, and a trivial sum settles in the parking
 *   lot. The floor is what keeps the feature honest, not a limitation.
 *
 * Cancellation ladder (published before entry, deterministic §P1):
 *   >72h   — full refund, match returns to scheduling (one per season)
 *   24–72h — refund only if the slot re-fills or the course releases
 *            (recorded as refundPending; resolved by booker attestation)
 *   <24h   — no refund, match forfeited
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp, requireAuth, requireActive, getUser, getPrivate, writeLedger, writeReputation } from './shared';
import { getStripe, stripeEnabled } from './lib/stripe';
import { forfeitMatch } from './matches';
import { notify } from './lib/notify';

const H = 3_600_000;

/** Below this per-player share the app stays out — settle it at the course. */
export const MIN_GREEN_FEE_SHARE_CENTS = 1000;

/**
 * Booker collects green fees for a scheduled match. Each player's share is
 * charged off-session to their saved card; collected funds transfer to the
 * booker's connected account. The platform holds nothing (§P6).
 */
export const collectGreenFees = onCall<{
  matchId: string;
  perPlayerCents: number;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const { matchId, perPlayerCents } = req.data;
  if (!Number.isInteger(perPlayerCents) || perPlayerCents <= 0 || perPlayerCents > 50000) {
    throw new HttpsError('invalid-argument', 'perPlayerCents must be a positive integer.');
  }
  if (perPlayerCents < MIN_GREEN_FEE_SHARE_CENTS) {
    throw new HttpsError(
      'failed-precondition',
      'Shares under $10 settle at the course — card fees would eat a split this small.',
    );
  }
  if (!stripeEnabled()) throw new HttpsError('failed-precondition', 'Payments are not configured.');

  const mRef = db.doc(`matches/${matchId}`);
  const m = (await mRef.get()).data() as any;
  if (!m) throw new HttpsError('not-found', 'Match not found.');
  if (m.status !== 'scheduled') throw new HttpsError('failed-precondition', 'Match is not scheduled.');
  if (m.scheduling?.bookedBy !== uid) throw new HttpsError('permission-denied', 'Only the booker collects green fees.');
  if (m.greenFees?.collectedAt) throw new HttpsError('failed-precondition', 'Green fees already collected.');

  // Every player in both entries except the booker pays their share.
  const players: string[] = [];
  for (const entryId of m.entryIds) {
    if (!entryId) continue;
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
    for (const u of e?.userIds ?? []) if (u !== uid) players.push(u);
  }

  const stripe = getStripe();
  const bookerPriv = await getPrivate(uid);
  // Idempotent across retries: players already charged in a previous partial
  // run (recorded on the match as we go) are skipped, never double-charged.
  const alreadyCharged = new Set<string>((m.greenFees?.chargedUserIds as string[] | undefined) ?? []);
  const charged: string[] = [...alreadyCharged];
  for (const player of players) {
    if (alreadyCharged.has(player)) continue;
    const p = await getUser(player);
    const pPriv = await getPrivate(player);
    if (!pPriv.stripeCustomerId) {
      throw new HttpsError('failed-precondition', `${p.displayName} has no saved payment method.`);
    }
    const methods = await stripe.paymentMethods.list({ customer: pPriv.stripeCustomerId, type: 'card', limit: 1 });
    if (!methods.data[0]) throw new HttpsError('failed-precondition', `${p.displayName} has no saved card.`);
    let pi;
    try {
      pi = await stripe.paymentIntents.create({
        amount: perPlayerCents,
        currency: 'usd',
        customer: pPriv.stripeCustomerId,
        payment_method: methods.data[0].id,
        confirm: true,
        off_session: true,
        metadata: { matchId, kind: 'greenFee' },
      });
    } catch (err) {
      throw new HttpsError(
        'failed-precondition',
        `${p.displayName}'s card was declined. Everyone charged so far is recorded — fix it up and retry; nobody is charged twice.`,
      );
    }
    charged.push(player);
    // Record progress IMMEDIATELY so a later failure can't cause re-charging.
    await mRef.update({ 'greenFees.chargedUserIds': charged, 'greenFees.perPlayerCents': perPlayerCents });
    await writeLedger({ type: 'greenFee', amountCents: perPlayerCents, fromUserId: player, toUserId: null, tournamentId: m.tournamentId ?? null, matchId, stripeRef: pi.id, note: 'green fee share' });
    // A card charge with no message is a support ticket — tell the player.
    await notify({
      userId: player,
      title: `Green fee: $${(perPlayerCents / 100).toFixed(2)}`,
      body: 'Your share of the prepaid tee time was charged to your saved card and reimbursed to the booker.',
      link: `/matches/${matchId}`,
    });
  }

  // Reimburse the booker from collected funds — never player-to-player debt.
  const totalCents = perPlayerCents * charged.length;
  let reimburseRef = 'pending-onboarding';
  if (bookerPriv.stripeConnectId) {
    const tr = await stripe.transfers.create({
      amount: totalCents,
      currency: 'usd',
      destination: bookerPriv.stripeConnectId,
      metadata: { matchId, kind: 'greenFeeReimbursement' },
    });
    reimburseRef = tr.id;
  } else {
    await notify({ userId: uid, title: 'Set up payouts to be reimbursed', body: 'Green fees were collected — add your payout account to receive them. The reimbursement retries automatically once you finish.', deadlineCritical: true, link: '/payouts' });
  }
  await writeLedger({ type: 'greenFeeReimbursement', amountCents: totalCents, fromUserId: null, toUserId: uid, tournamentId: m.tournamentId ?? null, matchId, stripeRef: reimburseRef, note: `green fees × ${charged.length}` });

  await mRef.update({
    greenFees: { perPlayerCents, chargedUserIds: charged, collectedAt: Timestamp.now(), refundPending: false },
  });
  return { ok: true, charged: charged.length };
});

/** The deterministic cancellation ladder (§5). Either competitor may invoke. */
export const cancelScheduledMatch = onCall<{ matchId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  await requireActive(uid);
  const mRef = db.doc(`matches/${req.data.matchId}`);
  const m = (await mRef.get()).data() as any;
  if (!m) throw new HttpsError('not-found', 'Match not found.');
  if (m.status !== 'scheduled') throw new HttpsError('failed-precondition', 'Nothing scheduled to cancel.');

  // Identify the canceller's entry.
  let myEntryId: string | null = null;
  for (const entryId of m.entryIds) {
    if (!entryId) continue;
    const e = (await db.doc(`entries/${entryId}`).get()).data() as { captainId: string; userIds: string[] } | undefined;
    if (e?.userIds.includes(uid)) myEntryId = entryId;
  }
  if (!myEntryId) throw new HttpsError('permission-denied', 'You are not in this match.');

  const teeMs = (m.scheduling?.agreedTime as Timestamp | null)?.toMillis() ?? 0;
  const hoursOut = (teeMs - Date.now()) / H;

  if (hoursOut > 72) {
    // Full refund, back to scheduling — ONE free reschedule per season per entry.
    const eRef = db.doc(`entries/${myEntryId}`);
    const e = (await eRef.get()).data() as { seasonRescheduleUsed?: boolean };
    if (e.seasonRescheduleUsed) {
      throw new HttpsError('failed-precondition', 'You have used your free reschedule this season.');
    }
    await refundGreenFees(req.data.matchId, m);
    await eRef.update({ seasonRescheduleUsed: true });
    await mRef.update({
      status: 'scheduling',
      'scheduling.agreedTime': null,
      'scheduling.deadline': Timestamp.fromMillis(Date.now() + 48 * H),
      greenFees: null,
    });
    await writeReputation(uid, 'lateCancel', req.data.matchId, Date.now());
    return { ok: true, outcome: 'rescheduled' };
  }

  if (hoursOut >= 24) {
    // Refund only if the slot re-fills or the course releases — recorded as
    // pending; the booker attests the outcome. The match still voids now.
    await mRef.update({
      status: 'scheduling',
      'scheduling.agreedTime': null,
      'scheduling.deadline': Timestamp.fromMillis(Date.now() + 48 * H),
      ...(m.greenFees ? { 'greenFees.refundPending': true } : {}),
    });
    await writeReputation(uid, 'lateCancel', req.data.matchId, Date.now());
    return { ok: true, outcome: 'refundPending' };
  }

  // <24h — no refund, match forfeited by the canceller (§P1: deterministic).
  const other = m.entryIds.find((e: string) => e && e !== myEntryId);
  await forfeitMatch(req.data.matchId, myEntryId, other, 'Cancelled inside 24 hours.');
  return { ok: true, outcome: 'forfeited' };
});

async function refundGreenFees(matchId: string, m: any) {
  if (!m.greenFees?.collectedAt || !stripeEnabled()) return;
  const stripe = getStripe();
  const rows = await db.collection('ledger').where('matchId', '==', matchId).where('type', '==', 'greenFee').get();
  for (const d of rows.docs) {
    const r = d.data() as { stripeRef: string; amountCents: number; fromUserId: string | null };
    try {
      const re = await stripe.refunds.create({ payment_intent: r.stripeRef });
      await writeLedger({ type: 'refund', amountCents: r.amountCents, fromUserId: null, toUserId: r.fromUserId, tournamentId: null, matchId, stripeRef: re.id, note: 'green fee refund (>72h cancel)' });
    } catch (e) {
      console.error(`green fee refund failed: ${(e as Error).message}`);
    }
  }
}
