/**
 * Tour series + stops (addendum §7) — THE league machine. A series is the
 * season ("KC Tuesday Night League, 18 weeks"); each stop is one week's real
 * tournament, linked by `seriesId` + `weekNumber` so results, awards, and the
 * season standings all feed automatically.
 *
 * League realities honored here:
 *   - ROTATING COURSES: the schedule carries a placeIds rotation — week N
 *     plays placeIds[(N-1) % length]. A league without a home course is the
 *     whole point of a city-wide platform.
 *   - MISSED WEEKS ARE FINE: standings count each player's best `countBest`
 *     weeks (classic league scoring), and the DNF sweep closes out no-shows so
 *     an absence never freezes anything.
 *   - NO WEEKLY CHORE: `tourSweep` (hourly tick) auto-creates the next week's
 *     stop a few days out and tells last week's field it's open. An organizer
 *     sets the season up ONCE.
 *
 * Fee: configurable per series (default 10%) — never hardcoded. A muni league
 * lives on thin margins; the platform prices the work, not the tradition.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp, requireAuth, requireOrganizer, getUser } from './shared';
import { DEFAULT_PAID_ELIGIBILITY, FREE_ELIGIBILITY } from './engine/eligibility';
import { notify } from './lib/notify';

const WEEK_MS = 7 * 86_400_000;
/** Create next week's stop this far ahead of its first tee. */
const CREATE_LEAD_MS = 6 * 86_400_000;

export interface SeriesSchedule {
  firstStartAt: number; // epoch ms of week 1's first tee (fixes the weeknight)
  weeks: number; // season length
  entryFeeCents: number;
  adminFeePercent: number;
  maxEntries: number;
  teeTimesHeld: number;
  placeIds: string[]; // course rotation; week N → placeIds[(N-1) % len]
  // Index bands as objects — Firestore forbids nested arrays ([[0,9],…]).
  flights: { min: number; max: number }[]; // [] = unflighted
  countBest: number; // best-N weeks count toward season standings
}

export const createTourSeries = onCall<{
  name: string; // "KC Tuesday Night League"
  season: string; // "2026 Summer"
  schedule?: {
    firstStartAt: number;
    weeks: number;
    entryFeeCents: number;
    adminFeePercent?: number;
    maxEntries: number;
    teeTimesHeld?: number;
    placeIds: string[];
    flights?: { min: number; max: number }[];
    countBest?: number;
  };
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await getUser(uid);
  await requireOrganizer(uid, user.marketId);

  let schedule: SeriesSchedule | null = null;
  if (req.data.schedule) {
    const s = req.data.schedule;
    if (!s.firstStartAt || s.firstStartAt < Date.now()) {
      throw new HttpsError('invalid-argument', 'Week 1 must start in the future.');
    }
    if (!Number.isInteger(s.weeks) || s.weeks < 1 || s.weeks > 30) {
      throw new HttpsError('invalid-argument', 'Season length must be 1–30 weeks.');
    }
    if (!s.placeIds?.length) {
      throw new HttpsError('invalid-argument', 'Pick at least one course for the rotation.');
    }
    const feePct = s.adminFeePercent ?? 10;
    if (feePct < 0 || feePct > 30) {
      throw new HttpsError('invalid-argument', 'Admin fee must be 0–30%.');
    }
    schedule = {
      firstStartAt: s.firstStartAt,
      weeks: s.weeks,
      entryFeeCents: s.entryFeeCents ?? 0,
      adminFeePercent: feePct,
      maxEntries: s.maxEntries ?? 40,
      teeTimesHeld: s.teeTimesHeld ?? 4,
      placeIds: s.placeIds,
      flights: s.flights ?? [],
      countBest: Math.min(s.countBest ?? s.weeks, s.weeks),
    };
    if (schedule.entryFeeCents > 0) {
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
  }

  const ref = await db.collection('tourSeries').add({
    marketId: user.marketId,
    name: req.data.name.slice(0, 80),
    season: req.data.season.slice(0, 20),
    createdBy: uid,
    status: 'active',
    schedule,
    stopsCreated: 0,
    createdAt: Timestamp.now(),
  });

  // Week 1 exists the moment the season does — the schedule page is never
  // empty, and the auto-creator takes it from week 2.
  if (schedule) {
    await createStopInternal(ref.id, user.marketId, uid, 1, schedule);
    await ref.update({ stopsCreated: 1 });
  }
  return { seriesId: ref.id };
});

/** The shared stop builder — used by the callable and the weekly sweep. */
async function createStopInternal(
  seriesId: string,
  marketId: string,
  createdBy: string,
  weekNumber: number,
  s: SeriesSchedule,
) {
  const series = (await db.doc(`tourSeries/${seriesId}`).get()).data() as
    | { name: string; season: string }
    | undefined;
  if (!series) throw new HttpsError('not-found', 'Series not found.');
  const startsAt = s.firstStartAt + (weekNumber - 1) * WEEK_MS;
  const placeId = s.placeIds[(weekNumber - 1) % s.placeIds.length];

  const tRef = db.collection('tournaments').doc();
  await tRef.set({
    marketId,
    formatId: 'grossFoursome',
    createdBy,
    seriesId,
    weekNumber,
    name: `${series.name} · Week ${weekNumber}`,
    description: `Tour stop — ${series.season}`,
    entryFeeCents: s.entryFeeCents,
    adminFeePercent: s.entryFeeCents > 0 ? s.adminFeePercent : 0,
    payoutTable:
      s.entryFeeCents > 0
        ? [
            { division: 'gross', place: 1, sharePercent: 35 },
            { division: 'gross', place: 2, sharePercent: 15 },
            { division: 'net', place: 1, sharePercent: 35 },
            { division: 'net', place: 2, sharePercent: 15 },
          ]
        : [],
    divisionMode: 'both',
    doubleDipRule: 'onePrizePerPlayer',
    prizeType: 'cashPurse',
    sponsoredPrizes: null,
    minEntries: 4,
    maxEntries: s.maxEntries,
    registrationOpens: Timestamp.now(),
    registrationCloses: Timestamp.fromMillis(startsAt - 24 * 3_600_000),
    startsAt: Timestamp.fromMillis(startsAt),
    placeId,
    eligibility: s.entryFeeCents > 0 ? DEFAULT_PAID_ELIGIBILITY : FREE_ELIGIBILITY,
    structure: 'singleRound',
    roundDeadlineDays: 1,
    status: 'open',
    entryIds: [],
    isTourStop: true,
  });

  await db.doc(`tourStops/${tRef.id}`).set({
    seriesId,
    weekNumber,
    placeId,
    teeTimesHeld: s.teeTimesHeld,
    divisions: ['gross', 'net'],
    flights: s.flights,
    tournamentId: tRef.id,
    startsAt: Timestamp.fromMillis(startsAt),
  });

  return tRef.id;
}

/**
 * Hourly (from tick): create each series' next stop once we're inside the
 * lead window, and invite last week's field. This is what makes a league a
 * season instead of 18 chores.
 */
export async function tourSweep(now: number) {
  const active = await db
    .collection('tourSeries')
    .where('status', '==', 'active')
    .get();
  for (const d of active.docs) {
    const s = d.data() as {
      marketId: string;
      createdBy: string;
      name: string;
      schedule: SeriesSchedule | null;
      stopsCreated?: number;
    };
    if (!s.schedule) continue;
    const created = s.stopsCreated ?? 0;
    if (created >= s.schedule.weeks) {
      continue; // season fully scheduled; stops complete on their own
    }
    const nextWeek = created + 1;
    const nextStart = s.schedule.firstStartAt + (nextWeek - 1) * WEEK_MS;
    if (nextStart - now > CREATE_LEAD_MS) continue;

    const tid = await createStopInternal(d.id, s.marketId, s.createdBy, nextWeek, s.schedule);
    await d.ref.update({ stopsCreated: nextWeek });

    // Tell last week's field the new week is open — the league heartbeat.
    if (nextWeek > 1) {
      const prev = await db
        .collection('tournaments')
        .where('seriesId', '==', d.id)
        .where('weekNumber', '==', nextWeek - 1)
        .limit(1)
        .get();
      if (!prev.empty) {
        const entries = await db
          .collection('entries')
          .where('tournamentId', '==', prev.docs[0].id)
          .get();
        const uids = [...new Set(entries.docs.flatMap((e) => (e.data() as { userIds: string[] }).userIds))];
        const course = (await db.doc(`courses/${s.schedule.placeIds[(nextWeek - 1) % s.schedule.placeIds.length]}`).get()).data() as { name?: string } | undefined;
        for (const u of uids) {
          await notify({
            userId: u,
            title: `${s.name}: Week ${nextWeek} is open`,
            body: `${course?.name ?? 'This week’s course'} — enter now. Missed weeks are fine: your best ${s.schedule.countBest} weeks count.`,
            link: `/tournaments/${tid}`,
          });
        }
      }
    }
  }
}

export const createTourStop = onCall<{
  seriesId: string;
  weekNumber: number;
  placeId: string;
  startsAt: number; // epoch ms — first held tee time
  teeTimesHeld: number; // 3-4 consecutive
  entryFeeCents: number;
  adminFeePercent?: number; // priced per series/stop — default 10, never 25
  maxEntries: number;
  flights: { min: number; max: number }[]; // e.g. [{min:0,max:9},{min:10,max:30}]
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

  const tid = await createStopInternal(d.seriesId, user.marketId, uid, d.weekNumber, {
    firstStartAt: d.startsAt - (d.weekNumber - 1) * WEEK_MS,
    weeks: d.weekNumber,
    entryFeeCents: d.entryFeeCents,
    adminFeePercent: d.adminFeePercent ?? 10,
    maxEntries: d.maxEntries,
    teeTimesHeld: d.teeTimesHeld,
    placeIds: [d.placeId],
    flights: d.flights,
    countBest: d.weekNumber,
  });
  return { tournamentId: tid };
});
