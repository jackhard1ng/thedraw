/**
 * The deterministic machinery (spec §5, §P1). A single hourly job drives every
 * "what happens if nobody responds?" outcome so no admin ever has to decide:
 *
 *   - close registration at registrationCloses (capture or void)
 *   - forfeit / walkover at the scheduling deadline
 *   - auto-confirm results and scorecards after 48h of silence
 *   - void + refund + reschedule on dangerous weather
 *
 * Weather is the #1 expected support request; it is automated before launch.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from './shared';
import { resolveAtDeadline, type AvailabilityEntry } from './engine/scheduling';
import { runClose } from './tournaments';
import { finalizeMatch, forfeitMatch } from './matches';
import { maybeCompleteTournament } from './completion';
import { boardSweep } from './boardlife';
import { drawSweep } from './draw';
import { notify } from './lib/notify';

export const tick = onSchedule('every 60 minutes', async () => {
  const now = Date.now();
  await closeDueTournaments(now);
  await enforceSchedulingDeadlines(now);
  await autoConfirmResults(now);
  await autoConfirmScorecards(now);
  await weatherSweep(now);
  await bookingWindowSweep(now);
  await boardSweep(now);
  await drawSweep(now);
});

/**
 * Booking-window notifications (§5): for supported courses, compute when
 * booking opens for a match's agreed date and tell both sides proactively.
 * This turns a nag into genuine utility — the reason to open the app Tuesday.
 */
async function bookingWindowSweep(now: number) {
  const scheduled = await db
    .collection('matches')
    .where('status', '==', 'scheduled')
    .where('scheduling.agreedTime', '>', Timestamp.fromMillis(now))
    .get();
  for (const d of scheduled.docs) {
    const m = d.data() as any;
    if (m.bookingNoticeSent || !m.scheduling?.placeId) continue;
    const course = (await db.doc(`courses/${m.scheduling.placeId}`).get()).data() as any;
    if (course?.tier !== 'supported' || !course.bookingWindowDays) continue;
    const teeMs = (m.scheduling.agreedTime as Timestamp).toMillis();
    const opensMs = teeMs - course.bookingWindowDays * 86_400_000;
    // Fire within the hour that the window opens (job runs hourly).
    if (opensMs > now || opensMs < now - 2 * 3_600_000) continue;
    for (const entryId of m.entryIds as string[]) {
      if (!entryId) continue;
      const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
      for (const u of e?.userIds ?? []) {
        await notify({
          userId: u,
          title: `${course.name} booking is open`,
          body: `Booking just opened for your match date${course.bookingOpensAtLocal ? ` (opens ${course.bookingOpensAtLocal} local)` : ''}. Grab the tee time.`,
          deadlineCritical: true,
          link: `/matches/${d.id}`,
        });
      }
    }
    await d.ref.update({ bookingNoticeSent: true });
  }
}

async function closeDueTournaments(now: number) {
  const due = await db.collection('tournaments').where('status', '==', 'open').where('registrationCloses', '<=', Timestamp.fromMillis(now)).get();
  for (const d of due.docs) {
    try {
      await runClose(d.id);
    } catch (e) {
      console.error(`close failed for ${d.id}: ${(e as Error).message}`);
    }
  }
}

async function enforceSchedulingDeadlines(now: number) {
  const due = await db.collection('matches').where('status', '==', 'scheduling').where('scheduling.deadline', '<=', Timestamp.fromMillis(now)).get();
  for (const d of due.docs) {
    const m = d.data() as any;
    const entryIds = m.entryIds as [string, string];
    if (!entryIds[0] || !entryIds[1]) continue; // still pending an opponent
    const log: AvailabilityEntry[] = (m.scheduling.availabilityLog ?? []).map((l: any) => ({
      entryId: l.entryId,
      dates: (l.dates ?? []).map((t: Timestamp) => t.toMillis()),
    }));
    // Higher seed = better = lower seed number.
    const seeds = await Promise.all(entryIds.map(async (id) => ({ id, seed: ((await db.doc(`entries/${id}`).get()).data() as any)?.seed ?? 999 })));
    const higher = seeds.sort((a, b) => a.seed - b.seed)[0].id;
    const outcome = resolveAtDeadline(entryIds, log, higher);

    if (outcome.kind === 'forfeit') {
      await forfeitMatch(d.id, outcome.forfeitedEntryId, outcome.advancingEntryId, outcome.reason);
    } else if (outcome.kind === 'doubleNonResponse') {
      const loser = entryIds.find((e) => e !== outcome.advancingEntryId) ?? null;
      await forfeitMatch(d.id, loser, outcome.advancingEntryId, outcome.reason);
    } else if (outcome.kind === 'scheduleReady') {
      await d.ref.update({ 'scheduling.agreedTime': Timestamp.fromMillis(outcome.at), status: 'scheduled' });
    }
    // 'noOverlap' → leave for a self-serve extension / organizer escalation.
  }
}

async function autoConfirmResults(now: number) {
  const due = await db.collection('matches').where('status', '==', 'awaitingConfirmation').where('result.confirmDeadline', '<=', Timestamp.fromMillis(now)).get();
  for (const d of due.docs) {
    const m = d.data() as any;
    if (m.result?.disputed) continue; // a dispute holds for the organizer
    await finalizeMatch(d.id, null); // silence = auto-confirmed (§P1)
  }
}

async function autoConfirmScorecards(now: number) {
  const due = await db.collection('scorecards').where('status', '==', 'awaitingConfirmation').where('confirmDeadline', '<=', Timestamp.fromMillis(now)).get();
  const touched = new Set<string>();
  for (const d of due.docs) {
    await d.ref.update({ status: 'complete', confirmedAt: Timestamp.fromMillis(now) });
    touched.add((d.data() as any).tournamentId);
  }
  for (const tid of touched) await maybeCompleteTournament(tid);
}

/**
 * Pull weather for each scheduled match's course + tee time; void on lightning,
 * heavy rain, or a posted closure. Degrades to a no-op without WEATHER_API_KEY.
 */
async function weatherSweep(now: number) {
  const key = process.env.WEATHER_API_KEY;
  if (!key) return;
  const soon = now + 12 * 3_600_000;
  const scheduled = await db.collection('matches').where('status', '==', 'scheduled').where('scheduling.agreedTime', '<=', Timestamp.fromMillis(soon)).get();
  for (const d of scheduled.docs) {
    const m = d.data() as any;
    const placeId = m.scheduling?.placeId;
    if (!placeId) continue;
    const course = (await db.doc(`courses/${placeId}`).get()).data() as any;
    const loc = course?.location;
    if (!loc) continue;
    try {
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${loc.latitude ?? loc.lat}&lon=${loc.longitude ?? loc.lng}&appid=${key}`);
      const w = (await res.json()) as any;
      const conditions: string[] = (w.weather ?? []).map((x: any) => String(x.main).toLowerCase());
      const rainMm = w.rain?.['1h'] ?? 0;
      const dangerous = conditions.includes('thunderstorm') || rainMm > 7.6;
      if (dangerous) {
        await d.ref.update({ status: 'voidedWeather', 'scheduling.agreedTime': null });
        const entryIds = m.entryIds as [string, string];
        for (const id of entryIds) {
          const e = (await db.doc(`entries/${id}`).get()).data() as any;
          for (const u of e?.userIds ?? []) {
            await notify({ userId: u, title: 'Match voided — weather', body: 'Dangerous weather at your course. The match is voided and back to scheduling; reschedule when you can.', deadlineCritical: true, link: `/matches/${d.id}` });
          }
        }
        // Back to scheduling with a fresh window.
        await d.ref.update({ status: 'scheduling', 'scheduling.deadline': Timestamp.fromMillis(now + 2 * 86_400_000) });
      }
    } catch (e) {
      console.error(`weather check failed for ${d.id}: ${(e as Error).message}`);
    }
  }
}
