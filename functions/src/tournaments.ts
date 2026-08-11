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
  getPrivate,
  setPrivate,
  addThreadMembers,
  removeThreadMembers,
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
  chargeSavedMethod,
  createSetupIntent,
  refundIntent,
  retrievePaymentIntent,
  retrieveSetupIntent,
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
    placeId?: string | null; // designated course (enables net at that course)
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

  // A NET division needs a rated course, or its standings come up empty and
  // its published purse would quietly flow to the gross winner — the exact
  // player the net division exists to protect would fund the shark's prize.
  const hasNetRows = d.payoutTable.some((r) => r.division === 'net');
  if ((hasNetRows || d.divisionMode === 'netOnly') && format.scoring !== 'matchPlay') {
    const netCourseId = format.designatedCourses?.[0] ?? d.placeId ?? null;
    const course = netCourseId
      ? ((await db.doc(`courses/${netCourseId}`).get()).data() as
          | { tier: string; teeSets: unknown[] | null }
          | undefined)
      : undefined;
    if (course?.tier !== 'supported' || !course.teeSets?.length) {
      throw new HttpsError(
        'failed-precondition',
        'A net division needs a designated course with slope/rating on file. Pick a supported course (or ask to have its tee data added), or make the event gross-only.',
      );
    }
  }

  // The index is LOAD-BEARING when it decides entry (a band), strokes (an
  // allowance or match play), or a net division — only then is verification
  // demanded. An open gross event welcomes players with no handicap record:
  // lowest score wins, there is nothing to fake (Jack's rule).
  const indexLoadBearing =
    (d.eligibility?.indexRange ?? null) != null ||
    format.scoring === 'matchPlay' ||
    (format as { handicapAllowance?: unknown }).handicapAllowance != null ||
    d.divisionMode !== 'grossOnly';

  const base = isPaid ? DEFAULT_PAID_ELIGIBILITY : FREE_ELIGIBILITY;
  const eligibility: EligibilityRules = {
    ...base,
    ...(isPaid && !indexLoadBearing ? { requiresVerifiedIndex: false } : {}),
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
    placeId: d.placeId ?? null,
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
  await addThreadMembers(ref.id, [uid]); // organizer can talk to the field
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
      stripeCustomerId: null, // unused: cards are collected inline at entry
    },
    t.eligibility,
    isPaid,
    stats,
    now,
  );
  if (!elig.eligible) throw new HttpsError('failed-precondition', elig.reasons.join(' '));

  const format = await getFormat(t.formatId);

  // Build the roster + frozen combined index. Display names are DENORMALIZED
  // here so public spectating pages (rules: entries are world-readable) never
  // need the auth-gated users collection, which carries phones and ages.
  const userIds = [uid];
  const displayNames = [user.displayName];
  // Per-player indexes frozen individually (§4) — team allowances like the
  // 35/15 scramble formula need WHO is the 6 and who is the 7, not their sum.
  const indexes = [user.handicap.index];
  let combinedIndex = user.handicap.index;
  if (format.teamSize > 1) {
    if (!partnerId) throw new HttpsError('invalid-argument', 'This format needs a partner.');
    const partner = await getUser(partnerId);
    if (partner.status === 'banned') throw new HttpsError('failed-precondition', 'Partner is not eligible.');
    userIds.push(partnerId);
    displayNames.push(partner.displayName);
    indexes.push(partner.handicap.index);
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
      displayNames,
      teamId: teamId ?? null,
      teamName: teamName ?? null,
      captainId: uid,
      combinedIndex,
      indexes, // per-player, frozen — feeds team allowances (35/15 scramble)
      flight: null, // assigned + frozen at closeRegistration
      seed: 0,
      paymentIntentId: null,
      paymentStatus: isPaid ? 'pending' : 'captured',
      status: 'active',
    });
    tx.update(tRef, { entryIds: FieldValue.arrayUnion(entryRef.id) });
  });

  // Payment setup — only when payments are live. Two modes (§4 entries):
  //   authorize — close is soon: hold the card now, capture at close.
  //   setup     — close is >5 days out (card holds expire ~7d): save the
  //               method now, charge at close. Same promise either way:
  //               charged only if the event runs.
  // Either way the entry is NOT authorized until the player completes the
  // card form (confirmEntryPayment flips it) — no phantom "authorized" states.
  let clientSecret: string | null = null;
  let paymentMode: 'authorize' | 'setup' | null = null;
  if (isPaid) {
    if (!stripeEnabled()) {
      // Compensate: back out the entry rather than leaving a phantom.
      await backOutEntry(tournamentId, entryRef.id);
      throw new HttpsError('failed-precondition', 'Payments are not configured yet.');
    }
    const priv = await getPrivate(uid);
    const customerId = await ensureCustomer(priv.stripeCustomerId, {
      uid,
      phone: priv.phone,
      name: user.displayName,
    });
    if (customerId !== priv.stripeCustomerId) {
      await setPrivate(uid, { stripeCustomerId: customerId });
    }
    const AUTH_HOLD_MAX_MS = 5 * 86_400_000;
    const closesMs = (t.registrationCloses as Timestamp).toMillis();
    paymentMode = closesMs - Date.now() > AUTH_HOLD_MAX_MS ? 'setup' : 'authorize';
    try {
      if (paymentMode === 'authorize') {
        const pi = await authorizeEntryFee({
          amountCents: t.entryFeeCents,
          customerId,
          tournamentId,
          entryId: entryRef.id,
        });
        clientSecret = pi.client_secret ?? null;
        await entryRef.update({
          paymentIntentId: pi.id,
          paymentStatus: 'pendingAuthorization',
          paymentMode,
        });
      } else {
        const si = await createSetupIntent(customerId);
        clientSecret = si.client_secret ?? null;
        await entryRef.update({
          setupIntentId: si.id,
          paymentStatus: 'pendingAuthorization',
          paymentMode,
        });
      }
    } catch (e) {
      await backOutEntry(tournamentId, entryRef.id);
      throw new HttpsError('internal', `Payment setup failed: ${(e as Error).message}`);
    }
  }

  // Field chat membership — rules gate the thread on this. A tour stop also
  // joins the SERIES thread: one persistent league room across all 18 weeks,
  // not a disposable chat per stop.
  await addThreadMembers(tournamentId, userIds);
  const seriesId = (t as { seriesId?: string }).seriesId;
  if (seriesId) await addThreadMembers(seriesId, userIds);

  // Reputation: committing to an event you entered.
  return { entryId: entryRef.id, clientSecret, paymentMode };
});

// ---------------------------------------------------------------------------
// confirmEntryPayment — the client calls this after Stripe Elements succeeds.
// Verifies against Stripe (never trusts the client) and flips the entry to its
// real payment state. An entry left at pendingAuthorization lapses at close.
// ---------------------------------------------------------------------------
export const confirmEntryPayment = onCall<{ entryId: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const eRef = db.doc(`entries/${req.data.entryId}`);
  const e = (await eRef.get()).data() as
    | {
        captainId: string;
        paymentMode?: 'authorize' | 'setup';
        paymentIntentId: string | null;
        setupIntentId?: string;
        paymentStatus: string;
      }
    | undefined;
  if (!e) throw new HttpsError('not-found', 'Entry not found.');
  if (e.captainId !== uid) throw new HttpsError('permission-denied', 'Not your entry.');
  if (e.paymentStatus !== 'pendingAuthorization') return { status: e.paymentStatus };

  if (e.paymentMode === 'setup' && e.setupIntentId) {
    const si = await retrieveSetupIntent(e.setupIntentId);
    if (si.status !== 'succeeded' || !si.payment_method) {
      throw new HttpsError('failed-precondition', 'Card was not saved — try again.');
    }
    await eRef.update({
      paymentStatus: 'methodSaved',
      paymentMethodId: typeof si.payment_method === 'string' ? si.payment_method : si.payment_method.id,
    });
    return { status: 'methodSaved' };
  }

  if (e.paymentIntentId) {
    const pi = await retrievePaymentIntent(e.paymentIntentId);
    if (pi.status !== 'requires_capture') {
      throw new HttpsError('failed-precondition', 'Payment was not completed — try again.');
    }
    await eRef.update({ paymentStatus: 'authorized' });
    return { status: 'authorized' };
  }
  throw new HttpsError('failed-precondition', 'No payment on this entry.');
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

  if (
    e.paymentIntentId &&
    (e.paymentStatus === 'authorized' || e.paymentStatus === 'pendingAuthorization') &&
    stripeEnabled()
  ) {
    try {
      await voidIntent(e.paymentIntentId); // release the hold; no charge
    } catch (err) {
      // The withdrawal still stands; the hold falls off on its own within days.
      console.error(`void on withdraw failed for ${req.data.entryId}: ${(err as Error).message}`);
    }
  }
  await db.doc(`tournaments/${e.tournamentId}`).update({ entryIds: FieldValue.arrayRemove(req.data.entryId) });
  await eRef.update({ status: 'withdrawn' });
  await removeThreadMembers(e.tournamentId, (e as unknown as { userIds?: string[] }).userIds ?? [uid]);
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
  let entries = entriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const isPaid = t.entryFeeCents > 0;

  // Entries whose payment was never completed lapse at close — they were never
  // committed money, so they don't count toward the field and aren't seeded.
  if (isPaid) {
    const lapsed = entries.filter((e) => e.paymentStatus === 'pendingAuthorization');
    for (const e of lapsed) {
      if (e.paymentIntentId && stripeEnabled()) {
        try { await voidIntent(e.paymentIntentId); } catch { /* nothing was held */ }
      }
      await db.doc(`entries/${e.id}`).update({ status: 'withdrawn', paymentStatus: 'lapsed' });
      await tRef.update({ entryIds: FieldValue.arrayRemove(e.id) });
      await notify({
        userId: e.captainId,
        title: `${t.name}: entry dropped`,
        body: 'Your card details were never completed, so your spot was released. You were not charged.',
        deadlineCritical: true,
        link: `/tournaments/${tournamentId}`,
      });
    }
    entries = entries.filter((e) => e.paymentStatus !== 'pendingAuthorization');
  }

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

  const { prizeCents, adminCents } = itemizeEntry(t.entryFeeCents, t.adminFeePercent);

  // Collect the money — capture holds, charge saved methods. Per-entry
  // isolation: one declined card drops THAT entry, never jams the event.
  if (isPaid && stripeEnabled()) {
    const paidOk: typeof entries = [];
    for (const e of entries) {
      try {
        let stripeRef = '';
        if (e.paymentStatus === 'authorized' && e.paymentIntentId) {
          await captureIntent(e.paymentIntentId);
          stripeRef = e.paymentIntentId;
        } else if (e.paymentStatus === 'methodSaved' && e.paymentMethodId) {
          const captainPriv = await getPrivate(e.captainId);
          const pi = await chargeSavedMethod({
            amountCents: t.entryFeeCents,
            customerId: captainPriv.stripeCustomerId as string,
            paymentMethodId: e.paymentMethodId,
            tournamentId,
            entryId: e.id,
          });
          stripeRef = pi.id;
          await db.doc(`entries/${e.id}`).update({ paymentIntentId: pi.id });
        } else if (e.paymentStatus === 'captured') {
          paidOk.push(e); // already collected (retry-safe)
          continue;
        } else {
          continue;
        }
        await db.doc(`entries/${e.id}`).update({ paymentStatus: 'captured' });
        await writeLedger({ type: 'entryFee', amountCents: prizeCents, fromUserId: e.captainId, toUserId: null, tournamentId, matchId: null, stripeRef, note: 'entry → prize fund' });
        await writeLedger({ type: 'adminFee', amountCents: adminCents, fromUserId: e.captainId, toUserId: null, tournamentId, matchId: null, stripeRef, note: 'entry → administration' });
        paidOk.push(e);
      } catch (err) {
        await db.doc(`entries/${e.id}`).update({ status: 'withdrawn', paymentStatus: 'captureFailed' });
        await tRef.update({ entryIds: FieldValue.arrayRemove(e.id) });
        await notify({
          userId: e.captainId,
          title: `${t.name}: card declined`,
          body: 'Your entry fee could not be collected, so your spot was released. Update your card and re-enter if registration reopens.',
          deadlineCritical: true,
          link: `/tournaments/${tournamentId}`,
        });
        console.error(`capture failed for entry ${e.id}: ${(err as Error).message}`);
      }
    }
    entries = paidOk;

    // Declines dropped the field under the floor → refund everyone who WAS
    // charged and cancel. Nobody pays for an event that didn't run.
    if (entries.length < t.minEntries) {
      for (const e of entries) {
        const piId = e.paymentIntentId as string | null;
        if (piId) {
          try { await refundIntent(piId); } catch (err) { console.error(`refund failed for ${e.id}: ${(err as Error).message}`); }
        }
        await db.doc(`entries/${e.id}`).update({ paymentStatus: 'refunded' });
        await notify({ userId: e.captainId, title: `${t.name} cancelled`, body: 'Too many payment failures left the field short. Your entry fee was refunded in full.', deadlineCritical: true });
      }
      await tRef.update({ status: 'cancelled' });
      return;
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
    // stroke rule freezes here: gross formats get no strokes; net/allowance
    // formats (flat percent OR the 35/15 two-man scramble spec) get a playing
    // handicap from the designated course's tee data. When the format names no
    // designated courses, the event's own placeId serves — an instant scramble
    // at Swope gets real net scoring without a format edit.
    const rounds = format?.rounds ?? 1;
    const designated: string[] = format?.designatedCourses?.length
      ? format.designatedCourses
      : t.placeId
        ? Array.from({ length: rounds }, () => t.placeId as string)
        : [];

    // FLIGHTS — assigned + frozen HERE, as the entry schema always promised.
    // Bands come from the tour stop when one exists; otherwise a field of 8+
    // with a flighted format splits into even bands by frozen combined index.
    let bands: { name: string; min: number; max: number }[] | null = null;
    const stop = (await db.doc(`tourStops/${tournamentId}`).get()).data() as
      | { flights?: { min: number; max: number }[] }
      | undefined;
    if (stop?.flights?.length) {
      bands = stop.flights.map((f, i) => ({
        name: String.fromCharCode(65 + i),
        min: f.min,
        max: f.max,
      }));
    } else if (format?.flightBy && format.flightBy !== 'none' && entries.length >= 8) {
      const n = entries.length >= 18 ? 3 : 2;
      const per = Math.ceil(entries.length / n);
      bands = Array.from({ length: n }, (_, i) => {
        const slice = entries.slice(i * per, (i + 1) * per); // sorted by index above
        return {
          name: String.fromCharCode(65 + i),
          min: i === 0 ? -20 : slice[0]?.combinedIndex ?? 99,
          max: i === n - 1 ? 99 : slice[slice.length - 1]?.combinedIndex ?? 99,
        };
      });
    }
    if (bands) {
      const fBatch = db.batch();
      for (const e of entries) {
        // Below every band's floor (a plus/scratch index under a stop's
        // configured min) belongs in the TOP flight, not the bottom — the
        // fallback must be the first band, never the last.
        const band =
          bands.find((b) => e.combinedIndex >= b.min && e.combinedIndex <= b.max) ??
          (e.combinedIndex < bands[0].min ? bands[0] : bands[bands.length - 1]);
        e.flight = band.name;
        fBatch.update(db.doc(`entries/${e.id}`), { flight: band.name });
      }
      await fBatch.commit();
    }

    // An instant net event overrides the format's (null) allowance with its
    // stored percent so the net division actually gets strokes.
    const allowance = t.handicapAllowanceOverride ?? format?.handicapAllowance ?? null;
    await createScorecards(
      tournamentId,
      entries.map((e) => ({
        id: e.id,
        userIds: e.userIds,
        combinedIndex: e.combinedIndex,
        indexes: e.indexes,
      })),
      rounds,
      designated,
      allowance,
      t.roundDeadlineDays ?? 7,
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
    if (
      e.paymentIntentId &&
      (e.paymentStatus === 'authorized' || e.paymentStatus === 'pendingAuthorization')
    ) {
      try {
        await voidIntent(e.paymentIntentId);
      } catch (err) {
        console.error(`void failed for ${d.id}: ${(err as Error).message}`);
      }
    }
  }
}
