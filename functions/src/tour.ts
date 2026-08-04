/**
 * Tour stops (addendum §7) — recurring weekly single-round events at a rotating
 * course. The backbone of a season, and the easiest course partnership pitch:
 * 12–16 golfers every weekend, rotating.
 *
 * A stop IS a tournament (single-round stroke play, gross/net divisions,
 * flighted) linked to its series by `seriesId` + `weekNumber` — so results,
 * awards, and the season order of merit all feed automatically. The
 * `tourStops/{stopId}` doc carries the series metadata (held tee times, flights)
 * per the addendum schema.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp, requireAuth, requireOrganizer, getUser } from './shared';
import { DEFAULT_PAID_ELIGIBILITY, FREE_ELIGIBILITY } from './engine/eligibility';

export const createTourSeries = onCall<{
  name: string; // "KC Fall Tour"
  season: string; // "2026 Fall"
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await getUser(uid);
  await requireOrganizer(uid, user.marketId);
  const ref = await db.collection('tourSeries').add({
    marketId: user.marketId,
    name: req.data.name.slice(0, 80),
    season: req.data.season.slice(0, 20),
    createdBy: uid,
    status: 'active',
    createdAt: Timestamp.now(),
  });
  return { seriesId: ref.id };
});

export const createTourStop = onCall<{
  seriesId: string;
  weekNumber: number;
  placeId: string;
  startsAt: number; // epoch ms — first held tee time
  teeTimesHeld: number; // 3-4 consecutive
  entryFeeCents: number;
  maxEntries: number;
  flights: [number, number][]; // e.g. [[0,9],[10,17],[18,30]]
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await getUser(uid);
  await requireOrganizer(uid, user.marketId);
  const d = req.data;

  const series = (await db.doc(`tourSeries/${d.seriesId}`).get()).data() as
    | { marketId: string; name: string; season: string }
    | undefined;
  if (!series || series.marketId !== user.marketId) {
    throw new HttpsError('not-found', 'Series not found in your market.');
  }
  if (!Number.isInteger(d.entryFeeCents) || d.entryFeeCents < 0) {
    throw new HttpsError('invalid-argument', 'entryFeeCents must be a non-negative integer.');
  }
  if (d.entryFeeCents > 0) {
    const market = (await db.doc(`markets/${user.marketId}`).get()).data() as
      | { paidEventsEnabled: boolean }
      | undefined;
    if (!market?.paidEventsEnabled) {
      throw new HttpsError('failed-precondition', 'Paid events are not enabled for this market.');
    }
    if (!user.canCreatePaidEvents) {
      throw new HttpsError('permission-denied', 'Not permitted to create paid events.');
    }
  }

  // The stop is a normal single-round tournament — hosted tier fee, standard
  // gross/net split paying two places in each division.
  const tRef = db.collection('tournaments').doc();
  await tRef.set({
    marketId: user.marketId,
    formatId: 'grossFoursome',
    createdBy: uid,
    seriesId: d.seriesId,
    weekNumber: d.weekNumber,
    name: `${series.name} · Week ${d.weekNumber}`,
    description: `Tour stop — ${series.season}`,
    entryFeeCents: d.entryFeeCents,
    adminFeePercent: d.entryFeeCents > 0 ? 25 : 0, // hosted tier (addendum §1)
    payoutTable: [
      { division: 'gross', place: 1, sharePercent: 35 },
      { division: 'gross', place: 2, sharePercent: 15 },
      { division: 'net', place: 1, sharePercent: 35 },
      { division: 'net', place: 2, sharePercent: 15 },
    ],
    divisionMode: 'both',
    doubleDipRule: 'onePrizePerPlayer',
    prizeType: 'cashPurse',
    sponsoredPrizes: null,
    minEntries: 4,
    maxEntries: d.maxEntries,
    registrationOpens: Timestamp.now(),
    registrationCloses: Timestamp.fromMillis(d.startsAt - 24 * 3_600_000),
    startsAt: Timestamp.fromMillis(d.startsAt),
    placeId: d.placeId,
    eligibility: d.entryFeeCents > 0 ? DEFAULT_PAID_ELIGIBILITY : FREE_ELIGIBILITY,
    structure: 'singleRound',
    roundDeadlineDays: 1,
    status: 'open',
    entryIds: [],
    isTourStop: true,
  });

  // The addendum-schema stop doc, keyed to the tournament for the series page.
  await db.doc(`tourStops/${tRef.id}`).set({
    seriesId: d.seriesId,
    weekNumber: d.weekNumber,
    placeId: d.placeId,
    teeTimesHeld: d.teeTimesHeld,
    divisions: ['gross', 'net'],
    flights: d.flights,
    tournamentId: tRef.id,
    startsAt: Timestamp.fromMillis(d.startsAt),
  });

  return { tournamentId: tRef.id };
});
