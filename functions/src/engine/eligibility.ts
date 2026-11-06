/**
 * Server-authoritative eligibility (spec §5). One evaluator, called by every
 * entry point that authorizes an entry. Mirrors the client copy in
 * src/lib/eligibility.ts — the client greys out an ineligible button; this is
 * the gate that actually decides.
 */
export interface EligibilityRules {
  minEventsCompleted: number;
  minAttendanceRate: number;
  requiresVerifiedIndex: boolean;
  maxHandicapVerificationAgeDays: number;
  indexRange: [number, number] | null;
  requiresCompleteProfile: boolean;
  minAttestedRounds?: number;
  minAccountAgeDays?: number;
  requiresPaymentMethod?: boolean;
  onePerPhoneNumber?: boolean;
  requiresGhinVerified?: boolean;
}

export interface EligUser {
  displayName: string;
  age?: number; // legacy docs only — new docs use isAdult
  isAdult?: boolean;
  status: 'active' | 'restricted' | 'banned';
  handicap: {
    index: number;
    source: 'ghin' | 'thirdParty' | 'self';
    verifiedAtMs: number | null;
  };
  stripeCustomerId: string | null;
}

export interface EligStats {
  eventsCompleted: number;
  attestedRounds: number;
  attendanceRate: number;
  accountAgeDays: number;
  hasPaymentMethod: boolean;
}

export interface EligResult {
  eligible: boolean;
  reasons: string[];
}

export function checkEligibility(
  user: EligUser,
  rules: EligibilityRules,
  isPaid: boolean,
  stats: EligStats,
  now: number,
): EligResult {
  const reasons: string[] = [];
  const days = user.handicap.verifiedAtMs
    ? (now - user.handicap.verifiedAtMs) / 86_400_000
    : Infinity;

  if (user.status === 'banned') reasons.push('Account is banned.');
  if (user.status === 'restricted' && isPaid) reasons.push('Account is restricted to free events.');

  // Complete profile = identity only (real name, 18+). Index verification is a
  // SEPARATE gate (requiresVerifiedIndex) so open gross events — where the
  // index decides nothing — can welcome players with no handicap record.
  // 18+ is the isAdult flag on new docs; legacy docs still carry exact age.
  const adult = user.isAdult ?? (typeof user.age === 'number' && user.age >= 18);
  const profileComplete = !!user.displayName && adult;
  if (rules.requiresCompleteProfile && !profileComplete) {
    reasons.push('Complete your profile (real name, age 18+).');
  }
  if (rules.requiresVerifiedIndex && user.handicap.source === 'self') {
    reasons.push('A verified handicap index is required.');
  }
  if (rules.requiresGhinVerified && user.handicap.source !== 'ghin') {
    reasons.push('This event requires a GHIN-verified index.');
  }
  // Freshness only matters where the index matters — an open gross event
  // doesn't care how stale (or absent) a handicap record is. And only a
  // once-verified index can be "re-verified"; a never-verified one is already
  // rejected above, and a second reason would just be noise.
  if (
    rules.requiresVerifiedIndex &&
    rules.maxHandicapVerificationAgeDays != null &&
    user.handicap.verifiedAtMs != null &&
    days > rules.maxHandicapVerificationAgeDays
  ) {
    reasons.push(`Re-verify your handicap within the last ${rules.maxHandicapVerificationAgeDays} days.`);
  }
  if (rules.indexRange && (user.handicap.index < rules.indexRange[0] || user.handicap.index > rules.indexRange[1])) {
    reasons.push(`Index must be within ${rules.indexRange[0]}–${rules.indexRange[1]}.`);
  }

  // Verified GHIN fast-tracks the apprenticeship gate — an established club
  // handicap record IS the "real golfer known to real people" proof (§5).
  const meetsEvents = stats.eventsCompleted >= (rules.minEventsCompleted ?? 0);
  const meetsAttested = rules.minAttestedRounds != null && stats.attestedRounds >= rules.minAttestedRounds;
  const meetsGhin = user.handicap.source === 'ghin' && user.handicap.verifiedAtMs != null;
  if (!meetsEvents && !meetsAttested && !meetsGhin) {
    reasons.push(`Need ${rules.minEventsCompleted ?? 0} completed events or ${rules.minAttestedRounds ?? 0} attested rounds first — or verify a GHIN index for instant access.`);
  }
  if (rules.minAttendanceRate != null && stats.attendanceRate < rules.minAttendanceRate) {
    reasons.push(`Attendance below ${Math.round(rules.minAttendanceRate * 100)}%.`);
  }
  if (rules.minAccountAgeDays != null && stats.accountAgeDays < rules.minAccountAgeDays) {
    reasons.push(`Account must be at least ${rules.minAccountAgeDays} days old.`);
  }
  if (rules.requiresPaymentMethod && !stats.hasPaymentMethod) {
    reasons.push('Add a payment method to enter.');
  }

  return { eligible: reasons.length === 0, reasons };
}

export const DEFAULT_PAID_ELIGIBILITY: EligibilityRules = {
  requiresCompleteProfile: true,
  maxHandicapVerificationAgeDays: 60,
  minEventsCompleted: 2,
  minAttestedRounds: 3,
  minAttendanceRate: 0.85,
  minAccountAgeDays: 14,
  requiresPaymentMethod: true,
  onePerPhoneNumber: true,
  requiresVerifiedIndex: true,
  indexRange: null,
};

/** Stricter gate for high-stakes events (addendum §5) — GHIN only, probed hard. */
export const HIGH_STAKES_ELIGIBILITY: EligibilityRules = {
  ...DEFAULT_PAID_ELIGIBILITY,
  requiresGhinVerified: true,
  maxHandicapVerificationAgeDays: 30,
  minEventsCompleted: 10,
  minAttendanceRate: 0.95,
  minAccountAgeDays: 90,
};

export const FREE_ELIGIBILITY: EligibilityRules = {
  requiresCompleteProfile: false,
  maxHandicapVerificationAgeDays: 3650,
  minEventsCompleted: 0,
  minAttendanceRate: 0,
  minAccountAgeDays: 0,
  requiresVerifiedIndex: false,
  requiresPaymentMethod: false,
  indexRange: null,
};
