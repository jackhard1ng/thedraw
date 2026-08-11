/**
 * Instant events — the 10% tier (addendum §2).
 *
 * Members do not create money games; they INSTANTIATE PRE-APPROVED TEMPLATES.
 * The template is the organizer's act: it fixes the format, field size, fee
 * bounds, allowed payout shapes, and the admin fee. A member picks one, sets
 * course/date/fee within bounds, and the event is created immediately — a real
 * tournament with a published payout table and an itemized fee. No review.
 *
 * Hard constraints enforced here, in code:
 *   - entry fee inside template bounds — no arbitrary amounts
 *   - payout shape from the template's allowed list — never free-form
 *   - payout table written to the event and FROZEN at creation
 *   - creator MAY compete (the platform takes the fee, not the creator)
 *   - above the template's high-stakes threshold, stricter eligibility applies
 *
 * Nothing here touches hard line 7a: a player-arranged stakes match is still
 * never raked, held, or routed. The distinction is template-instantiated
 * (allowed, fee applies) vs. privately arranged (allowed, zero fee, zero money
 * handling).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp, requireAuth, requireActive, addThreadMembers } from './shared';
import { HIGH_STAKES_ELIGIBILITY, DEFAULT_PAID_ELIGIBILITY, FREE_ELIGIBILITY } from './engine/eligibility';

/** Payout shape presets (addendum §3). Keys are the template's allowed list. */
export const PAYOUT_SHAPES: Record<string, { place: number; sharePercent: number }[]> = {
  winnerTakeAll: [{ place: 1, sharePercent: 100 }],
  '70_30': [
    { place: 1, sharePercent: 70 },
    { place: 2, sharePercent: 30 },
  ],
  '60_30_10': [
    { place: 1, sharePercent: 60 },
    { place: 2, sharePercent: 30 },
    { place: 3, sharePercent: 10 },
  ],
};

interface TemplateDoc {
  marketId: string;
  name: string;
  formatId: string;
  fieldSize: number; // maximum field
  fieldSizeMin?: number; // minimum to run; omitted = runs full or not at all
  indexRange?: [number, number] | null; // tier-banded template (C/D-only etc.)
  entryFeeMinCents: number;
  entryFeeMaxCents: number;
  allowedPayoutShapes: string[];
  adminFeePercent: number;
  requiresGhinAboveCents: number; // high-stakes gate threshold
  // Net-capable stroke templates split the purse gross + net, so a mixed
  // crew ($8–$22) competes fairly instead of the low index sweeping. Net uses
  // the chosen course's rating when supported, else a percentage of full index
  // (rough but universally available — the casual-crew reality).
  netCapable?: boolean;
  netAllowancePercent?: number; // e.g. 0.9; applies to the net division
  active: boolean;
}

export const createInstantEvent = onCall<{
  templateId: string;
  placeId: string | null;
  startsAt: number; // epoch ms
  entryFeeCents: number;
  payoutShape: string;
  name?: string;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const { templateId, placeId, startsAt, entryFeeCents, payoutShape } = req.data;

  const tpl = (await db.doc(`eventTemplates/${templateId}`).get()).data() as TemplateDoc | undefined;
  if (!tpl || !tpl.active) throw new HttpsError('not-found', 'Template not available.');
  if (tpl.marketId !== user.marketId) throw new HttpsError('permission-denied', 'Template is for another market.');

  // Market must have paid events enabled for a paid instant event.
  if (entryFeeCents > 0) {
    const market = (await db.doc(`markets/${user.marketId}`).get()).data() as { paidEventsEnabled: boolean } | undefined;
    if (!market?.paidEventsEnabled) {
      throw new HttpsError('failed-precondition', 'Paid events are not enabled for this market.');
    }
  }

  // Fee inside template bounds — no arbitrary amounts.
  if (
    !Number.isInteger(entryFeeCents) ||
    entryFeeCents < tpl.entryFeeMinCents ||
    entryFeeCents > tpl.entryFeeMaxCents
  ) {
    throw new HttpsError(
      'invalid-argument',
      `Entry fee must be between ${tpl.entryFeeMinCents} and ${tpl.entryFeeMaxCents} cents.`,
    );
  }

  // Shape from the template's allowed list — never free-form.
  if (!tpl.allowedPayoutShapes.includes(payoutShape) || !PAYOUT_SHAPES[payoutShape]) {
    throw new HttpsError('invalid-argument', 'Payout shape not allowed by this template.');
  }

  if (!startsAt || startsAt < Date.now()) {
    throw new HttpsError('invalid-argument', 'Pick a future tee time.');
  }

  const format = (await db.doc(`formats/${tpl.formatId}`).get()).data() as
    | { scoring: string; handicapAllowance: { type?: string } | { percent?: number } | null; teamSize?: number }
    | undefined;

  // NET DIVISION for a mixed crew. A net-capable stroke template splits the
  // purse gross + net: gross crowns the best golf straight up, net gives the
  // 22 a real chance. Net uses the chosen course's rating when it's supported,
  // otherwise a percentage of full index (rough but always available — what a
  // weekend crew actually does). handicapAllowanceOverride tells runClose how
  // to freeze each card's strokes.
  let divisionMode = 'grossOnly';
  let handicapAllowanceOverride: { percent: number; ratinglessOk: true } | null = null;
  const netAllowance = tpl.netAllowancePercent ?? 0.9;
  const shape = PAYOUT_SHAPES[payoutShape];
  let payoutTable: { division: string; place: number; sharePercent: number }[];
  if (tpl.netCapable && format?.scoring === 'strokePlay') {
    // Split each place's share in half across gross and net (largest-remainder
    // keeps the table summing to 100).
    divisionMode = 'both';
    handicapAllowanceOverride = { percent: netAllowance, ratinglessOk: true };
    payoutTable = shape.flatMap((r) => {
      const grossShare = Math.round(r.sharePercent / 2);
      return [
        { division: 'gross', place: r.place, sharePercent: grossShare },
        { division: 'net', place: r.place, sharePercent: r.sharePercent - grossShare },
      ];
    });
  } else {
    payoutTable = shape.map((r) => ({ division: 'gross', ...r }));
  }

  // High-stakes gate above the template threshold — compared PER PLAYER, not
  // per team entry: a $40-a-head scramble is a $40 event to each player, not
  // an $80 one. Below it, an open GROSS format relaxes the index requirement —
  // the index decides nothing there, so no handicap record is needed to play.
  const scratchByDesign = (format?.handicapAllowance as { type?: string } | null)?.type === 'none';
  const indexLoadBearing =
    (tpl.indexRange ?? null) != null ||
    (!scratchByDesign &&
      (format?.scoring === 'matchPlay' || format?.handicapAllowance != null || divisionMode === 'both'));
  const perPlayerFeeCents = Math.round(
    entryFeeCents / Math.max(1, format?.teamSize ?? 1),
  );
  const highStakes = perPlayerFeeCents > tpl.requiresGhinAboveCents;
  // LOW-STAKES CREW RELAXATION: a sub-threshold instant event is a game among
  // people who know each other (bounded downside, self-policing field), so it
  // waives the 14-day apprenticeship AND self-declared indexes are fine — even
  // for net. Sandbagging a $20 game among friends isn't the threat model;
  // anonymous high-stakes net is, and that keeps the full gate below.
  let eligibility: Record<string, unknown>;
  if (highStakes) {
    eligibility = { ...HIGH_STAKES_ELIGIBILITY };
  } else if (entryFeeCents > 0) {
    eligibility = {
      ...DEFAULT_PAID_ELIGIBILITY,
      requiresVerifiedIndex: (tpl.indexRange ?? null) != null, // tier bands still verify
      minEventsCompleted: 0,
      minAttendanceRate: 0,
      minAccountAgeDays: 0,
    };
    delete (eligibility as { minAttestedRounds?: number }).minAttestedRounds;
  } else {
    eligibility = { ...FREE_ELIGIBILITY };
  }
  // Tier-banded templates ("C/D only") carry their band into eligibility.
  if (tpl.indexRange) eligibility.indexRange = tpl.indexRange;
  void indexLoadBearing;

  // Registration closes shortly before the round so authorize/capture works the
  // same as any tournament (capture at close, void under minimum).
  const closes = startsAt - 2 * 3_600_000;

  const ref = db.collection('tournaments').doc();
  await ref.set({
    marketId: user.marketId,
    formatId: tpl.formatId,
    createdBy: uid, // creator MAY compete — the platform takes the fee, not them
    createdFromTemplateId: templateId,
    name: req.data.name?.slice(0, 80) || tpl.name,
    description: `Instant event · ${tpl.name}`,
    entryFeeCents,
    adminFeePercent: tpl.adminFeePercent, // the 10% tier
    payoutTable, // FROZEN at creation
    divisionMode,
    handicapAllowanceOverride, // null for gross; percent+ratinglessOk for net
    doubleDipRule: 'onePrizePerPlayer',
    prizeType: 'cashPurse',
    sponsoredPrizes: null,
    // Small games run full or not at all; bigger fields (e.g. the Saturday
    // Classic's 8–16) set fieldSizeMin so the event runs once viable. Under
    // minimum at close, every authorization is voided — nobody is charged.
    minEntries: tpl.fieldSizeMin ?? tpl.fieldSize,
    maxEntries: tpl.fieldSize,
    registrationOpens: Timestamp.now(),
    registrationCloses: Timestamp.fromMillis(Math.max(closes, Date.now() + 15 * 60_000)),
    startsAt: Timestamp.fromMillis(startsAt),
    placeId: placeId ?? null,
    eligibility,
    structure: 'singleRound',
    roundDeadlineDays: 1,
    // Baseline ground rules on every money game — the rest is first-tee talk.
    rules:
      'Green fees are paid at the course — your entry is purse and platform only. ' +
      'No gimmes outside match play — putt everything out. ' +
      'Agree any local relief (lift-clean-place, lateral drops) on the first tee, never after.',
    status: 'open', // live immediately — no review, no waiting
    entryIds: [],
    isInstant: true,
  });

  // The creator organizes in the field chat even before anyone enters.
  await addThreadMembers(ref.id, [uid]);
  return { tournamentId: ref.id };
});
