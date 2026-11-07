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
import { db, FieldValue, getPrivate, Timestamp } from './shared';
import { resolveAtDeadline, type AvailabilityEntry } from './engine/scheduling';
import { runClose } from './tournaments';
import { finalizeMatch, forfeitMatch } from './matches';
import { maybeCompleteTournament } from './completion';
import { boardSweep } from './boardlife';
import { drawSweep } from './draw';
import { tourSweep } from './tour';
import { notify } from './lib/notify';
import { accountPayoutsEnabled, payout as stripePayout, stripeEnabled, voidIntent } from './lib/stripe';

export const tick = onSchedule('every 60 minutes', async () => {
  const now = Date.now();
  await closeDueTournaments(now);
  await remindBeforeDeadlines(now);
  await enforceSchedulingDeadlines(now);
  await autoConfirmResults(now);
  await autoConfirmScorecards(now);
  await dnfSweep(now);
  await weatherSweep(now);
  await bookingWindowSweep(now);
  await boardSweep(now);
  await drawSweep(now);
  await tourSweep(now);
  await settlePendingPayouts();
  await retryStuckCompletions(now);
  await unplayedMatchSweep(now);
  await abandonedSeatSweep(now);
});

/**
 * A player who opened the card form and walked away holds a seat — in a
 * heads-up match, the ONLY other seat. After 30 minutes the seat goes back to
 * the field (the hold, if any, is voided — nothing was ever charged).
 */
export async function abandonedSeatSweep(now: number) {
  const snap = await db.collection('entries').where('paymentStatus', '==', 'pendingAuthorization').get();
  for (const d of snap.docs) {
    const e = d.data() as {
      tournamentId: string;
      status: string;
      captainId: string;
      userIds?: string[];
      paymentIntentId?: string | null;
      createdAt?: Timestamp;
    };
    if (e.status !== 'active') continue;
    if ((e.createdAt?.toMillis() ?? now) > now - 30 * 60_000) continue;
    const tRef = db.doc(`tournaments/${e.tournamentId}`);
    const t = (await tRef.get()).data() as { status: string; name: string } | undefined;
    if (!t || t.status !== 'open') continue; // close handles it from here
    if (e.paymentIntentId && stripeEnabled()) {
      try {
        await voidIntent(e.paymentIntentId);
      } catch (err) {
        console.error(`abandoned-seat void failed for ${d.id}: ${(err as Error).message}`);
      }
    }
    await tRef.update({ entryIds: FieldValue.arrayRemove(d.id) });
    await d.ref.update({ status: 'withdrawn', withdrawnReason: 'cardNotCompleted' });
    await notify({
      userId: e.captainId,
      title: 'Your spot was released',
      body: `You didn't finish adding a card for ${t.name}, so the seat went back to the field. Nothing was charged — you can rejoin if there's room.`,
      link: `/tournaments/${e.tournamentId}`,
    });
  }
}

/** A completion that crashed mid-payout is re-run once stale (payouts are idempotent). */
async function retryStuckCompletions(now: number) {
  const stuck = await db
    .collection('tournaments')
    .where('status', '==', 'completing')
    .where('completingAt', '<=', Timestamp.fromMillis(now - 10 * 60_000))
    .get();
  for (const d of stuck.docs) {
    try {
      await maybeCompleteTournament(d.id);
    } catch (e) {
      console.error(`completion retry failed for ${d.id}: ${(e as Error).message}`);
    }
  }
}

/**
 * A scheduled match whose tee time came and went with NO result reported (both
 * no-showed, or the winner never posted) must not freeze captured money. Day 1
 * after the tee time: nudge both sides. Day 3: hand it to the market organizer,
 * who rules a winner or voids + refunds (single-match events).
 */
export async function unplayedMatchSweep(now: number) {
  const due = await db
    .collection('matches')
    .where('status', '==', 'scheduled')
    .where('scheduling.agreedTime', '<=', Timestamp.fromMillis(now - 24 * 3_600_000))
    .get();
  for (const d of due.docs) {
    const m = d.data() as any;
    const teeMs = (m.scheduling.agreedTime as Timestamp).toMillis();
    const captains: string[] = [];
    for (const eid of (m.entryIds as string[]).filter(Boolean)) {
      const e = (await db.doc(`entries/${eid}`).get()).data() as { captainId: string } | undefined;
      if (e) captains.push(e.captainId);
    }
    if (!m.unplayedNudgeSent) {
      for (const u of captains) {
        await notify({
          userId: u,
          title: 'Did your match happen?',
          body: 'The tee time has passed with no result. Finish the live card or report the result so it settles. If it didn’t happen, say so in the match chat — after 3 days an organizer steps in.',
          deadlineCritical: true,
          link: `/matches/${d.id}`,
        });
      }
      await d.ref.update({ unplayedNudgeSent: true });
      continue;
    }
    if (!m.unreported && teeMs <= now - 72 * 3_600_000) {
      const t = (await db.doc(`tournaments/${m.tournamentId}`).get()).data() as { marketId: string; name: string } | undefined;
      await d.ref.update({ unreported: true }); // surfaces it in the organizer's ruling queue
      await db.collection('reports').add({
        reportedBy: 'system',
        targetType: 'match',
        targetId: d.id,
        marketId: t?.marketId ?? '',
        reason: `Unreported match: the tee time passed 3 days ago with no result (${t?.name ?? 'event'}). Rule a winner, or void and refund if it never happened.`,
        context: null,
        createdAt: Timestamp.now(),
        status: 'open',
      });
      for (const u of captains) {
        await notify({
          userId: u,
          title: 'Your match went to an organizer',
          body: 'No result was reported, so an organizer will rule on it — tell them what happened in the match chat.',
          deadlineCritical: true,
          link: `/matches/${d.id}`,
        });
      }
    }
  }
}

/**
 * Money owed but not yet deliverable — a winner who hadn't finished Connect
 * onboarding at completion time — is retried here every hour until it lands.
 * This is the guarantee behind "winners are paid automatically": finishing
 * onboarding is the ONLY step, and nobody has to ask anyone for their money.
 */
async function settlePendingPayouts() {
  if (!stripeEnabled()) return;
  const rows = await db
    .collection('ledger')
    .where('stripeRef', '==', 'pending-onboarding')
    .limit(50)
    .get();
  for (const d of rows.docs) {
    const row = d.data() as { toUserId: string | null; amountCents: number; tournamentId: string | null };
    if (!row.toUserId) continue;
    const priv = await getPrivate(row.toUserId);
    if (!priv.stripeConnectId) continue; // still not onboarded — keep waiting
    try {
      if (!(await accountPayoutsEnabled(priv.stripeConnectId))) continue;
      const tr = await stripePayout({
        amountCents: row.amountCents,
        destinationConnectId: priv.stripeConnectId,
        tournamentId: row.tournamentId ?? '',
        toUserId: row.toUserId,
        idempotencyKey: `settle-${d.id}`, // one transfer per ledger row, ever
      });
      // Settlement update, not a mutation of history: the row records the same
      // debt — stripeRef flips from the pending marker to the real transfer.
      await d.ref.update({ stripeRef: tr.id, settledAt: Timestamp.now() });
      await notify({
        userId: row.toUserId,
        title: `$${(row.amountCents / 100).toFixed(2)} on the way`,
        body: 'Payout setup complete — your prize money just went out to your bank.',
        deadlineCritical: true,
        link: '/me',
      });
    } catch (e) {
      console.error(`settle failed for ledger ${d.id}: ${(e as Error).message}`);
    }
  }
}

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
  // A close that crashed mid-way sits in 'closing'; runClose re-claims it once
  // it's 10 minutes stale (captures/charges are idempotent, so this is safe).
  const stuck = await db.collection('tournaments').where('status', '==', 'closing').where('closingAt', '<=', Timestamp.fromMillis(now - 10 * 60_000)).get();
  for (const d of [...due.docs, ...stuck.docs]) {
    try {
      await runClose(d.id);
    } catch (e) {
      console.error(`close failed for ${d.id}: ${(e as Error).message}`);
    }
  }
}

/**
 * ~24h before a scheduling deadline, warn anyone who hasn't posted
 * availability. The forfeit ladder must never fire on someone who was
 * never reminded it exists (§P1).
 */
async function remindBeforeDeadlines(now: number) {
  const windowEnd = Timestamp.fromMillis(now + 26 * 3_600_000);
  const soon = await db
    .collection('matches')
    .where('status', '==', 'scheduling')
    .where('scheduling.deadline', '<=', windowEnd)
    .get();
  for (const d of soon.docs) {
    const m = d.data() as any;
    if (m.deadlineReminderSent) continue;
    const deadlineMs = (m.scheduling?.deadline as Timestamp | null)?.toMillis() ?? 0;
    if (deadlineMs <= now) continue; // enforcement handles the past
    const responded = new Set((m.scheduling?.availabilityLog ?? []).map((l: any) => l.entryId));
    let sent = false;
    for (const entryId of m.entryIds as string[]) {
      if (!entryId || responded.has(entryId)) continue;
      const e = (await db.doc(`entries/${entryId}`).get()).data() as { userIds: string[] } | undefined;
      for (const u of e?.userIds ?? []) {
        await notify({
          userId: u,
          title: 'Match deadline tomorrow',
          body: 'Post at least 3 dates you can play before the deadline — no response counts as a forfeit.',
          deadlineCritical: true,
          link: `/matches/${d.id}`,
        });
        sent = true;
      }
    }
    if (sent || responded.size >= 2) await d.ref.update({ deadlineReminderSent: true });
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
      // Silence picked the time (§P1) — both sides must hear WHICH time.
      const when = new Date(outcome.at).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZone: 'America/Chicago',
      });
      for (const id of entryIds) {
        const e = (await db.doc(`entries/${id}`).get()).data() as any;
        for (const u of e?.userIds ?? []) {
          await notify({ userId: u, title: 'Match auto-scheduled', body: `The deadline passed with overlapping dates, so your match locked in at ${when}. Work out details in the match chat.`, deadlineCritical: true, link: `/matches/${d.id}` });
        }
      }
    } else if (outcome.kind === 'noOverlap' && !m.noOverlapNoticeSent) {
      // Dates on both sides but none shared: don't leave them staring at an
      // expired deadline — point at the two ways out (extension / chat).
      await d.ref.update({ noOverlapNoticeSent: true });
      for (const id of entryIds) {
        const e = (await db.doc(`entries/${id}`).get()).data() as any;
        for (const u of e?.userIds ?? []) {
          await notify({ userId: u, title: 'No overlapping dates', body: 'You both posted availability but nothing lines up. Use your extension or agree on a date in the match chat — an organizer steps in if it stays stuck.', deadlineCritical: true, link: `/matches/${d.id}` });
        }
      }
    }
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
    const sc = d.data() as any;
    touched.add(sc.tournamentId);
    if (sc.userId) {
      await notify({
        userId: sc.userId,
        title: 'Score is official',
        body: `Your round of ${sc.gross} auto-confirmed after 48h with no objection.`,
        link: `/tournaments/${sc.tournamentId}/leaderboard`,
      });
    }
  }
  for (const tid of touched) await maybeCompleteTournament(tid);
}

/**
 * DNF sweep (§P1): a scorecard still awaiting its result after the round
 * deadline closes as DNF — no score, no place, no held-hostage event. Without
 * this, one player skipping week 7 would freeze an 18-week league's
 * completion (and everyone's payouts) forever.
 */
export async function dnfSweep(now: number) {
  const due = await db
    .collection('scorecards')
    .where('status', '==', 'awaitingResult')
    .where('dueAt', '<=', Timestamp.fromMillis(now))
    .get();
  const touched = new Set<string>();
  for (const d of due.docs) {
    const sc = d.data() as { tournamentId: string; userId: string; round: number; holes?: number[] | null; courseHandicap?: number | null };
    // A live card with holes on it was PLAYED — the scorekeeper just never
    // tapped Finish. Post it for confirmation instead of throwing it away.
    const played = (Array.isArray(sc.holes) ? sc.holes : []).filter((x) => x > 0);
    if (played.length > 0) {
      const gross = played.reduce((a, b) => a + b, 0);
      await d.ref.update({
        gross,
        net: sc.courseHandicap != null ? gross - sc.courseHandicap : null,
        submittedBy: 'auto', // not a player: the card's own player may attest it
        confirmDeadline: Timestamp.fromMillis(now + 48 * 3_600_000),
        status: 'awaitingConfirmation',
      });
      await notify({
        userId: sc.userId,
        title: `Round ${sc.round}: your live card was posted`,
        body: `Nobody tapped Finish, so the holes entered (${played.length}, gross ${gross}) were posted for you. Confirm or dispute within 48h, or it auto-confirms.`,
        deadlineCritical: true,
        link: `/tournaments/${sc.tournamentId}/scorecard`,
      });
      continue;
    }
    await d.ref.update({ status: 'dnf' });
    touched.add(sc.tournamentId);
    await notify({
      userId: sc.userId,
      title: `Round ${sc.round}: recorded as DNF`,
      body: 'The deadline passed with no score, so this round closed as a DNF. The event moves on without it — jump back in next round.',
      link: `/tournaments/${sc.tournamentId}/leaderboard`,
    });
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
        // Green fees are the course's business (its own rain policy) — never ours.
        // One update, straight back to scheduling with a fresh window and a
        // CLEAR availability log — stale dates must not re-lock the rained-out
        // day at the next deadline pass.
        await d.ref.update({
          status: 'scheduling',
          weatherVoided: true,
          'scheduling.agreedTime': null,
          'scheduling.availabilityLog': [],
          'scheduling.deadline': Timestamp.fromMillis(now + 2 * 86_400_000),
        });
        const entryIds = m.entryIds as [string, string];
        for (const id of entryIds) {
          const e = (await db.doc(`entries/${id}`).get()).data() as any;
          for (const u of e?.userIds ?? []) {
            await notify({ userId: u, title: 'Match voided — weather', body: 'Dangerous weather at your course. The tee time is voided and the match is back to scheduling — post fresh dates. If you booked it, check the course’s rain policy.', deadlineCritical: true, link: `/matches/${d.id}` });
          }
        }
      }
    } catch (e) {
      console.error(`weather check failed for ${d.id}: ${(e as Error).message}`);
    }
  }
}
