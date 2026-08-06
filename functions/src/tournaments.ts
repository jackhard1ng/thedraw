/**
 * Tournament lifecycle (spec §4/§5/§7). Path B only — the single path through
 * which money moves. Legal hard lines are enforced HERE, in code, not left to
 * organizer discretion:
 *
 *   - Percentage purse only; shares sum to 100 (§7.2).
 *   - Pay at least two places for a cash purse (§4).
 *   - Organizer may not compete in an event they take a fee from (§7.4).
 *   - Authorize at registration, capture at close, void if under minEntries —
 *     nobody is charged for an event that didn't run (§4 entries).
 *   - No stored value: the platform never holds a balance (§7.1).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  db,
  FieldValue,
  Timestamp,
  requireAuth,
  requireActive,
  requireOrganizer,
  getUser,
  deriveStats,
  writeLedger,
} from './shared';
import {
  checkEligibility,
  DEFAULT_PAID_ELIGIBILITY,
  FREE_ELIGIBILITY,
  type EligibilityRules,
} from './engine/eligibility';
import { itemizeEntry } from './engine/money';
import { createBracketMatches, createPodMatches, createScorecards } from './lib/matchgen';
import { makePods } from './engine/pods';
import {
  authorizeEntryFee,
  captureIntent,
  voidIntent,
  ensureCustomer,
  stripeEnabled,
} from './lib/stripe';
import { notify } from './lib/notify';

interface FormatDoc {
  id: string;
  teamSize: number;
  scoring: string;
  advancement: string;
  rounds?: number;
  designatedCourses?: string[];
  eligibleForMoney: boolean;
}

async function getFormat(formatId: string): Promise<FormatDoc> {
  const snap = await db.doc(`formats/${formatId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Unknown format.');
  return { id: snap.id, ...(snap.data() as Omit<FormatDoc, 'id'>) };
}

function validatePayoutTable(table: { division: string; place: number; sharePercent: number }[], isPaid: boolean) {
  if (!isPaid) return;
  const sum = table.reduce((a, r) => a + r.sharePercent, 0);
  if (Math.round(sum) !== 100) {
    throw new HttpsError('invalid-argument', `Payout shares must sum to 100 (got ${sum}).`);
  }
  if (table.length < 2) {
    throw new HttpsError('invalid-argument', 'Pay at least two places.');
  }
}

// ---------------------------------------------------------------------------
export const createTournament = onCall(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await getUser(uid);
  const marketId = user.marketId;
  await requireOrganizer(uid, marketId);

  const d = req.data as {
    formatId: string;
    name: string;
    description: string;
    entryFeeCents: number;
    adminFeePercent: number;
    payoutTable: { division: 'gross' | 'net'; place: number; sharePercent: number }[];
    divisionMode: string;
    doubleDipRule: string;
    prizeType: string;
    minEntries: number;
    maxEntries: number;
    registrationOpens: number;
    registrationCloses: number;
    eligibility?: Partial<EligibilityRules>;
    structure: 'bracket' | 'pods';
    roundDeadlineDays: number;
    fromRequestId?: string;
  };

  const isPaid = d.entryFeeCents > 0;
  if (!Number.isInteger(d.entryFeeCents) || d.entryFeeCents < 0) {
    throw new HttpsError('invalid-argument', 'entryFeeCents must be a non-negative integer.');
  }
  if (isPaid) {
    // Paid events require the paid flag on the organizer AND the market switch.
    if (!user.canCreatePaidEvents) throw new HttpsError('permission-denied', 'Not permitted to create paid events.');
    const market = (await db.doc(`markets/${marketId}`).get()).data() as { paidEventsEnabled: boolean } | undefined;
    if (!market?.paidEventsEnabled) throw new HttpsError('failed-precondition', 'Paid events are not enabled for this market.');
    if (d.adminFeePercent < 0 || d.adminFeePercent > 30) {
      throw new HttpsError('invalid-argument', 'Admin fee must be 0–30% (§ admin fee tiers).');
    }
  }
  validatePayoutTable(d.payoutTable, isPaid && d.prizeType === 'cashPurse');

  const format = await getFormat(d.formatId);
  if (isPaid && !format.eligibleForMoney) {
    throw new HttpsError('failed-precondition', 'This format is not eligible for money events.');
  }

  const eligibility: EligibilityRules = {
    ...(isPaid ? DEFAULT_PAID_ELIGIBILITY : FREE_ELIGIBILITY),
    ...(d.eligibility ?? {}),
  };

  const ref = db.collection('tournaments').doc();
  await ref.set({
    marketId,
    formatId: d.formatId,
    createdBy: uid,
    name: d.name,
    description: d.description ?? '',
    entryFeeCents: d.entryFeeCents,
    adminFeePercent: d.adminFeePercent ?? 0,
    payoutTable: d.payoutTable,
    divisionMode: d.divisionMode,
    doubleDipRule: d.doubleDipRule,
    prizeType: d.prizeType,
    sponsoredPrizes: null,
    minEntries: d.minEntries,
    maxEntries: d.maxEntries,
    registrationOpens: Timestamp.fromMillis(d.registrationOpens),
    registrationCloses: Timestamp.fromMillis(d.registrationCloses),
    eligibility,
    structure: d.structure,
    roundDeadlineDays: d.roundDeadlineDays ?? 7,
    status: 'draft',
    entryIds: [],
  });

  if (d.fromRequestId) {
    await db.doc(`eventRequests/${d.fromRequestId}`).update({
      status: 'approved',
      reviewedBy: uid,
      tournamentId: ref.id,
    });
  }
  return { tournamentId: ref.id };
});

// ---------------------------------------------------------------------------
export const publishTournament = onCall<{ tournamentId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`tournaments/${req.data.tournamentId}`);
  const t = (await ref.get()).data();
  if (!t) throw new HttpsError('not-found', 'Tournament not found.');
  await requireOrganizer(uid, t.marketId);
  if (t.status !== 'draft') throw new HttpsError('failed-precondition', 'Already published.');
  await ref.update({ status: 'open' });
  return { ok: true };
});

export const cancelTournament = onCall<{ tournamentId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const ref = db.doc(`tournaments/${req.data.tournamentId}`);
  const t = (await ref.get()).data();
  if (!t) throw new HttpsError('not-found', 'Tournament not found.');
  await requireOrganizer(uid, t.marketId);
  // Void/refund any authorizations before cancelling.
  await voidAllAuthorizations(req.data.tournamentId);
  await ref.update({ status: 'cancelled' });
  return { ok: true };
});

// ---------------------------------------------------------------------------
export const enterTournament = onCall(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const { tournamentId, partnerId, teamId, teamName } = req.data as {
    tournamentId: string;
    partnerId?: string;
    teamId?: string;
    teamName?: string;
  };

  const tRef = db.doc(`tournaments/${tournamentId}`);
  const t = (await tRef.get()).data() as
    | {
        marketId: string;
        formatId: string;
        entryFeeCents: number;
        maxEntries: number;
        entryIds: string[];
        createdBy: string;
        adminFeePercent: number;
        status: string;
        registrationOpens: Timestamp;
        registrationCloses: Timestamp;
        eligibility: EligibilityRules;
      }
    | undefined;
  if (!t) throw new HttpsError('not-found', 'Tournament not found.');

  const now = Date.now();
  if (t.status !== 'open') throw new HttpsError('failed-precondition', 'Registration is not open.');
  if (now < t.registrationOpens.toMillis() || now > t.registrationCloses.toMillis()) {
    throw new HttpsError('failed-precondition', 'Outside the registration window.');
  }
  if (t.entryIds.length >= t.maxEntries) throw new HttpsError('failed-precondition', 'Field is full.');

  // §7.4 — an organizer may not compete in an event THEY take a fee from.
  // Instant events are exempt (addendum §2): the template is the organizer's
  // act, the PLATFORM takes the fee, and the creator is just a player.
  if (t.createdBy === uid && t.adminFeePercent > 0 && !(t as { isInstant?: boolean }).isInstant) {
    throw new HttpsError('permission-denied', 'You cannot enter an event you take a fee from.');
  }

  const isPaid = t.entryFeeCents > 0;
  const stats = await deriveStats(uid, now);
  const elig = checkEligibility(
    {
      displayName: user.displayName,
      age: user.age,
      status: user.status,
      handicap: {
        index: user.handicap.index,
        source: user.handicap.source,
        verifiedAtMs: user.handicap.verifiedAt ? user.handicap.verifiedAt.toMillis() : null,
      },
      stripeCustomerId: user.stripeCustomerId,
    },
    t.eligibility,
    isPaid,
    stats,
    now,
  );
  if (!elig.eligible) throw new HttpsError('failed-precondition', elig.reasons.join(' '));

  const format = await getFormat(t.formatId);

  // Build the roster + frozen combined index.
  const userIds = [uid];
  let combinedIndex = user.handicap.index;
  if (format.teamSize > 1) {
    if (!partnerId) throw new HttpsError('invalid-argument', 'This format needs a partner.');
    const partner = await getUser(partnerId);
    if (partner.status === 'banned') throw new HttpsError('failed-precondition', 'Partner is not eligible.');
    userIds.push(partnerId);
    combinedIndex = user.handicap.index + partner.handicap.index; // frozen sum (§4)
  }

  // one-per-phone / one entry per user
  const existing = await db.collection('entries').where('tournamentId', '==', tournamentId).where('userIds', 'array-contains', uid).get();
  if (!existing.empty) throw new HttpsError('failed-precondition', 'You have already entered.');

  const entryRef = db.collection('entries').doc();

  // Reserve the slot atomically; freeze the entry.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tRef);
    const cur = snap.data() as { entryIds: string[]; maxEntries: number };
    if (cur.entryIds.length >= cur.maxEntries) throw new HttpsError('failed-precondition', 'Field is full.');
    tx.set(entryRef, {
      tournamentId,
      userIds,
      teamId: teamId ?? null,
      teamName: teamName ?? null,
      captainId: uid,
      combinedIndex,
      flight: null, // assigned + frozen at closeRegistration
      seed: 0,
      paymentIntentId: null,
      paymentStatus: isPaid ? 'pending' : 'captured',
      status: 'active',
    });
    tx.update(tRef, { entryIds: FieldValue.arrayUnion(entryRef.id) });
  });

  // Authorize the entry fee (manual capture) — only when payments are live.
  let clientSecret: string | null = null;
  if (isPaid) {
    if (!stripeEnabled()) {
      // Compensate: back out the entry rather than leaving a phantom.
      await backOutEntry(tournamentId, entryRef.id);
      throw new HttpsError('failed-precondition', 'Payments are not configured yet.');
    }
    const customerId = await ensureCustomer(user.stripeCustomerId, {
      uid,
      phone: user.phone,
      name: user.displayName,
    });
    if (customerId !== user.stripeCustomerId) {
      await db.doc(`users/${uid}`).update({ stripeCustomerId: customerId });
    }
    try {
      const pi = await authorizeEntryFee({
        amountCents: t.entryFeeCents,
        customerId,
        tournamentId,
        entryId: entryRef.id,
      });
      clientSecret = pi.client_secret ?? null;
      await entryRef.update({ paymentIntentId: pi.id, paymentStatus: 'authorized' });
    } catch (e) {
      await backOutEntry(tournamentId, entryRef.id);
      throw new HttpsError('internal', `Payment authorization failed: ${(e as Error).message}`);
    }
  }

  // Reputation: committing to an event you entered.
  return { entryId: entryRef.id, clientSecret };
});

async function backOutEntry(tournamentId: string, entryId: string) {
  await db.doc(`tournaments/${tournamentId}`).update({ entryIds: FieldValue.arrayRemove(entryId) });
  await db.doc(`entries/${entryId}`).delete();
}

export const withdrawEntry = onCall<{ entryId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const eRef = db.doc(`entries/${req.data.entryId}`);
  const e = (await eRef.get()).data() as
    | { tournamentId: string; captainId: string; paymentIntentId: string | null; paymentStatus: string }
    | undefined;
  if (!e) throw new HttpsError('not-found', 'Entry not found.');
  if (e.captainId !== uid) throw new HttpsError('permission-denied', 'Only the captain can withdraw.');
  const t = (await db.doc(`tournaments/${e.tournamentId}`).get()).data() as { status: string } | undefined;
  if (t?.status !== 'open') throw new HttpsError('failed-precondition', 'Too late to withdraw.');

  if (e.paymentIntentId && e.paymentStatus === 'authorized' && stripeEnabled()) {
    await voidIntent(e.paymentIntentId); // release the hold; no charge
  }
  await db.doc(`tournaments/${e.tournamentId}`).update({ entryIds: FieldValue.arrayRemove(req.data.entryId) });
  await eRef.update({ status: 'withdrawn' });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// closeRegistration — capture or void, seed, and build the draw. Normally fired
// by the scheduler at registrationCloses; organizers may trigger it manually.
// ---------------------------------------------------------------------------
export const closeRegistration = onCall<{ tournamentId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const tRef = db.doc(`tournaments/${req.data.tournamentId}`);
  const t = (await tRef.get()).data();
  if (!t) throw new HttpsError('not-found', 'Tournament not found.');
  await requireOrganizer(uid, t.marketId);
  await runClose(req.data.tournamentId);
  return { ok: true };
});

/** The close routine, callable from the scheduler too. */
export async function runClose(tournamentId: string) {
  const tRef = db.doc(`tournaments/${tournamentId}`);
  const t = (await tRef.get()).data() as any;
  if (!t || (t.status !== 'open' && t.status !== 'filled')) return;

  const entriesSnap = await db.collection('entries').where('tournamentId', '==', tournamentId).where('status', '==', 'active').get();
  const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  // Under the floor → void everything. Nobody is charged (§4).
  if (entries.length < t.minEntries) {
    await voidAllAuthorizations(tournamentId);
    await tRef.update({ status: 'cancelled' });
    await Promise.all(
      entries.flatMap((e) =>
        (e.userIds as string[]).map((u) =>
          notify({ userId: u, title: `${t.name} cancelled`, body: 'Not enough entries — your card was not charged.', deadlineCritical: true }),
        ),
      ),
    );
    return;
  }

  const isPaid = t.entryFeeCents > 0;
  const { prizeCents, adminCents } = itemizeEntry(t.entryFeeCents, t.adminFeePercent);

  // Capture authorizations and record the ledger rows.
  if (isPaid && stripeEnabled()) {
    for (const e of entries) {
      if (e.paymentIntentId && e.paymentStatus === 'authorized') {
        await captureIntent(e.paymentIntentId);
        await db.doc(`entries/${e.id}`).update({ paymentStatus: 'captured' });
        await writeLedger({ type: 'entryFee', amountCents: prizeCents, fromUserId: e.captainId, toUserId: null, tournamentId, matchId: null, stripeRef: e.paymentIntentId, note: 'entry → prize fund' });
        await writeLedger({ type: 'adminFee', amountCents: adminCents, fromUserId: e.captainId, toUserId: null, tournamentId, matchId: null, stripeRef: e.paymentIntentId, note: 'entry → administration' });
      }
    }
  }

  // Seed by combined index (lower = better = seed 1); registration order breaks ties.
  entries.sort((a, b) => a.combinedIndex - b.combinedIndex);
  const batch = db.batch();
  entries.forEach((e, i) => batch.update(db.doc(`entries/${e.id}`), { seed: i + 1 }));
  await batch.commit();

  const entriesBySeed = entries.map((e) => e.id);
  const format = (await db.doc(`formats/${t.formatId}`).get()).data() as any;

  // Branch on the FORMAT, not the structure flag — a stroke-play format must
  // never build a bracket even if an organizer left structure at its default.
  let bracketRounds = 0;
  if (format?.scoring === 'matchPlay') {
    const res = await createBracketMatches(tournamentId, entriesBySeed);
    bracketRounds = res.bracketRounds;
  } else if (t.structure === 'pods' || format?.advancement === 'roundRobin') {
    const pods = makePods(entriesBySeed);
    await createPodMatches(tournamentId, pods);
  } else {
    // Stroke play (gross foursome, multi-round) — scorecards, no matches. The
    // stroke rule freezes here: gross formats get no strokes; net formats get
    // a playing handicap from the designated course's tee data × allowance.
    const rounds = format?.rounds ?? 1;
    const allowancePercent =
      format?.handicapAllowance && typeof format.handicapAllowance.percent === 'number'
        ? format.handicapAllowance.percent
        : null;
    await createScorecards(
      tournamentId,
      entries.map((e) => ({ id: e.id, userIds: e.userIds, combinedIndex: e.combinedIndex })),
      rounds,
      format?.designatedCourses ?? [],
      allowancePercent,
    );
  }

  await tRef.update({ status: 'inProgress', bracketRounds });

  // Commitment reputation for everyone in the field.
  await Promise.all(
    entries.flatMap((e) =>
      (e.userIds as string[]).map((u) =>
        notify({ userId: u, title: `${t.name} is set`, body: 'The draw is live — check your match.', deadlineCritical: true, link: `/tournaments/${tournamentId}` }),
      ),
    ),
  );
}

async function voidAllAuthorizations(tournamentId: string) {
  if (!stripeEnabled()) return;
  const entries = await db.collection('entries').where('tournamentId', '==', tournamentId).get();
  for (const d of entries.docs) {
    const e = d.data() as { paymentIntentId: string | null; paymentStatus: string };
    if (e.paymentIntentId && e.paymentStatus === 'authorized') {
      try {
        await voidIntent(e.paymentIntentId);
      } catch (err) {
        console.error(`void failed for ${d.id}: ${(err as Error).message}`);
      }
    }
  }
}
