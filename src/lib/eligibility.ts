/**
 * Eligibility — spec §5 "Eligibility — one evaluator, called everywhere".
 *
 * Implement a SINGLE checkEligibility function. Every entry point calls it.
 * Never scatter `if (user.rounds > 3)` checks through the codebase. Rules are
 * declarative on the tournament document so future gates are config, not code.
 *
 * This module is shared by the client (to grey out an ineligible "Enter" button
 * with reasons) and by the Cloud Function that actually authorizes an entry.
 * The function is the source of truth; the client copy is a courtesy.
 */
import type { Eligibility, Handicap, Tournament, User } from '@/types/models';
import { freshness } from '@/lib/handicap';

export interface DerivedStats {
  eventsCompleted: number; // from events/matches, never stored on user
  attestedRounds: number;
  attendanceRate: number; // 0..1
  accountAgeDays: number;
  hasPaymentMethod: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[]; // human-readable, shown verbatim in the UI
}

function profileComplete(user: User): boolean {
  return (
    !!user.displayName &&
    user.age >= 18 &&
    user.handicap.source !== 'self' &&
    user.handicap.verifiedAt != null
  );
}

function indexInRange(handicap: Handicap, range: [number, number] | null): boolean {
  if (!range) return true;
  return handicap.index >= range[0] && handicap.index <= range[1];
}

/**
 * The one evaluator. `now` is injected so the same code runs deterministically
 * in a Cloud Function and in a test.
 */
export function checkEligibility(
  user: User,
  tournament: Pick<Tournament, 'eligibility' | 'entryFeeCents'>,
  stats: DerivedStats,
  now = Date.now(),
): EligibilityResult {
  const e: Eligibility = tournament.eligibility;
  const reasons: string[] = [];

  if (user.status === 'banned') reasons.push('Account is banned.');
  if (user.status === 'restricted' && tournament.entryFeeCents > 0) {
    reasons.push('Account is restricted to free events.');
  }

  if (e.requiresCompleteProfile && !profileComplete(user)) {
    reasons.push('Complete your profile (real name, age 18+, verified index).');
  }

  if (e.requiresVerifiedIndex && user.handicap.source === 'self') {
    reasons.push('A verified handicap index is required.');
  }

  if (e.requiresGhinVerified && user.handicap.source !== 'ghin') {
    reasons.push('This event requires a GHIN-verified index.');
  }

  if (e.maxHandicapVerificationAgeDays != null) {
    const fresh = freshness(user.handicap.verifiedAt, now);
    const days = user.handicap.verifiedAt
      ? (now - user.handicap.verifiedAt.toMillis()) / 86_400_000
      : Infinity;
    if (days > e.maxHandicapVerificationAgeDays) {
      reasons.push(
        `Re-verify your handicap — must be within the last ${e.maxHandicapVerificationAgeDays} days (${fresh}).`,
      );
    }
  }

  if (!indexInRange(user.handicap, e.indexRange)) {
    reasons.push(
      `Index must be within ${e.indexRange![0]}–${e.indexRange![1]} for this flight.`,
    );
  }

  // Three paths through the "prove you're a real golfer" gate (§5): completed
  // events, attested rounds, or a VERIFIED GHIN — an established club handicap
  // record is exactly that proof, so it fast-tracks past the apprenticeship.
  const meetsEvents = stats.eventsCompleted >= (e.minEventsCompleted ?? 0);
  const meetsAttested =
    e.minAttestedRounds != null && stats.attestedRounds >= e.minAttestedRounds;
  const meetsGhin = user.handicap.source === 'ghin' && user.handicap.verifiedAt != null;
  if (!meetsEvents && !meetsAttested && !meetsGhin) {
    const parts = [`${e.minEventsCompleted ?? 0} completed events`];
    if (e.minAttestedRounds != null) parts.push(`${e.minAttestedRounds} attested rounds`);
    reasons.push(`Need ${parts.join(' or ')} first — or verify a GHIN index for instant access.`);
  }

  if (e.minAttendanceRate != null && stats.attendanceRate < e.minAttendanceRate) {
    reasons.push(
      `Attendance below ${Math.round(e.minAttendanceRate * 100)}% (yours: ${Math.round(
        stats.attendanceRate * 100,
      )}%).`,
    );
  }

  if (e.minAccountAgeDays != null && stats.accountAgeDays < e.minAccountAgeDays) {
    reasons.push(`Account must be at least ${e.minAccountAgeDays} days old.`);
  }

  if (e.requiresPaymentMethod && !stats.hasPaymentMethod) {
    reasons.push('Add a payment method to enter.');
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Default gate for every PAID tournament (§5 "Money event eligibility"). A bad
 * actor must spend two weeks and play three real rounds before touching money.
 */
export const DEFAULT_PAID_ELIGIBILITY: Eligibility = {
  requiresCompleteProfile: true,
  maxHandicapVerificationAgeDays: 60,
  minEventsCompleted: 2, // free events count
  minAttestedRounds: 3, // alternative path
  minAttendanceRate: 0.85,
  minAccountAgeDays: 14,
  requiresPaymentMethod: true,
  onePerPhoneNumber: true,
  requiresVerifiedIndex: true,
  indexRange: null,
};

/** Stricter gate for high-stakes events (entry fee above the market threshold). */
export const HIGH_STAKES_ELIGIBILITY: Eligibility = {
  ...DEFAULT_PAID_ELIGIBILITY,
  requiresGhinVerified: true,
  maxHandicapVerificationAgeDays: 30,
  minEventsCompleted: 10,
  minAttendanceRate: 0.95,
  minAccountAgeDays: 90,
};
