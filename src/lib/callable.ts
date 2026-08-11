/**
 * Client wrappers for Cloud Functions callables.
 *
 * Anything that touches money or advances a bracket runs in a Cloud Function;
 * clients never write those documents (§3). This file is the full callable
 * surface across all phases — the authoritative contract the UI builds against.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type {
  DivisionMode,
  DoubleDipRule,
  Eligibility,
  HandicapSource,
  PayoutRow,
  PrizeType,
  ReportTargetType,
  TournamentStructure,
} from '@/types/models';

// ---- Phase 1: the board -----------------------------------------------------
export const joinRound = httpsCallable<{ postId: string }, { status: string }>(
  functions,
  'joinRound',
);
export const leaveRound = httpsCallable<{ postId: string }, { status: string }>(
  functions,
  'leaveRound',
);
export const submitReport = httpsCallable<
  { targetType: ReportTargetType; targetId: string; reason: string; context?: string },
  { reportId: string }
>(functions, 'submitReport');
export const blockUser = httpsCallable<{ blockedId: string }, { ok: boolean }>(
  functions,
  'blockUser',
);
export const unblockUser = httpsCallable<{ blockedId: string }, { ok: boolean }>(
  functions,
  'unblockUser',
);
export const deleteAccount = httpsCallable<Record<string, never>, { ok: boolean }>(
  functions,
  'deleteAccount',
);

// ---- Phase 2/3: tournaments -------------------------------------------------
export interface CreateTournamentInput {
  formatId: string;
  name: string;
  description: string;
  entryFeeCents: number; // 0 for free events (Phase 2)
  adminFeePercent: number;
  payoutTable: PayoutRow[];
  divisionMode: DivisionMode;
  doubleDipRule: DoubleDipRule;
  prizeType: PrizeType;
  minEntries: number;
  maxEntries: number;
  registrationOpens: number; // epoch ms (UTC)
  registrationCloses: number;
  eligibility?: Partial<Eligibility>;
  structure: TournamentStructure;
  roundDeadlineDays: number;
  fromRequestId?: string;
}
export const createTournament = httpsCallable<CreateTournamentInput, { tournamentId: string }>(
  functions,
  'createTournament',
);
export const publishTournament = httpsCallable<{ tournamentId: string }, { ok: boolean }>(
  functions,
  'publishTournament',
);
export const cancelTournament = httpsCallable<{ tournamentId: string }, { ok: boolean }>(
  functions,
  'cancelTournament',
);

// Enter: singles or a team (partnerId for a one-off, teamId for a persistent team).
export const enterTournament = httpsCallable<
  { tournamentId: string; partnerId?: string; teamId?: string; teamName?: string },
  { entryId: string; clientSecret: string | null; paymentMode: 'authorize' | 'setup' | null }
>(functions, 'enterTournament');
// After Stripe Elements succeeds, this verifies with Stripe and flips the
// entry to its real payment state (authorized / methodSaved).
export const confirmEntryPayment = httpsCallable<
  { entryId: string },
  { status: string }
>(functions, 'confirmEntryPayment');
export const withdrawEntry = httpsCallable<{ entryId: string }, { ok: boolean }>(
  functions,
  'withdrawEntry',
);
// Normally scheduled at registrationCloses; organizers can trigger manually.
export const closeRegistration = httpsCallable<{ tournamentId: string }, { ok: boolean }>(
  functions,
  'closeRegistration',
);

// ---- Matches: scheduling + results (deterministic machinery, §5) -----------
export const submitAvailability = httpsCallable<
  { matchId: string; dates: number[] },
  { ok: boolean; status: string }
>(functions, 'submitAvailability');
// Named requestExtension (not useExtension) so it isn't mistaken for a React
// hook; the underlying Cloud Function is still 'useExtension'.
export const requestExtension = httpsCallable<{ matchId: string }, { ok: boolean }>(
  functions,
  'useExtension',
);
export const setAgreedTime = httpsCallable<
  { matchId: string; agreedTime: number; placeId: string | null; bookedBy: string | null },
  { ok: boolean }
>(functions, 'setAgreedTime');
export const submitResult = httpsCallable<
  { matchId: string; winnerEntryId: string; margin: string; scorecardPhotoUrl?: string },
  { ok: boolean; status: string }
>(functions, 'submitResult');
export const confirmResult = httpsCallable<{ matchId: string }, { ok: boolean }>(
  functions,
  'confirmResult',
);
export const disputeResult = httpsCallable<
  { matchId: string; note: string },
  { ok: boolean }
>(functions, 'disputeResult');

// Stroke-play scorecards (gross foursome, multi-round stroke play).
export const submitRoundScore = httpsCallable<
  { tournamentId: string; round: number; gross: number; scorecardPhotoUrl?: string },
  { ok: boolean; status: string }
>(functions, 'submitRoundScore');
export const confirmRoundScore = httpsCallable<
  { scorecardId: string },
  { ok: boolean }
>(functions, 'confirmRoundScore');

// ---- Green fees + cancellation ladder (§5 — never player-to-player debt) ---
export const collectGreenFees = httpsCallable<
  { matchId: string; perPlayerCents: number },
  { ok: boolean; charged: number }
>(functions, 'collectGreenFees');
export const cancelScheduledMatch = httpsCallable<
  { matchId: string },
  { ok: boolean; outcome: 'rescheduled' | 'refundPending' | 'forfeited' }
>(functions, 'cancelScheduledMatch');

// ---- Courses: upsert a listed course from a Places pick (only write path) --
export const ensureCourse = httpsCallable<
  {
    placeId: string;
    name: string;
    address: string;
    location: { lat: number; lng: number } | null;
  },
  { created: boolean }
>(functions, 'ensureCourse');

// ---- Enter the Draw — one-tap matching into a group with a named booker ----
export const enterDraw = httpsCallable<
  { day: string; willingToBook?: boolean },
  { requestId: string; alreadyIn: boolean }
>(functions, 'enterDraw');
export const leaveDraw = httpsCallable<{ day: string }, { ok: boolean }>(
  functions,
  'leaveDraw',
);

// ---- Run it back: clone a completed round for next week, group pre-invited -
export const rerunPost = httpsCallable<{ postId: string }, { postId: string }>(
  functions,
  'rerunPost',
);

// ---- Confirm a tee time on a board post / draw group (booker-only) ---------
export const confirmTeeTime = httpsCallable<
  { postId: string; teeTime: number; placeId?: string | null; courseName?: string | null },
  { ok: boolean }
>(functions, 'confirmTeeTime');

// ---- Attestation (the §P3 witness — feeds minAttestedRounds eligibility) ---
export const attestRound = httpsCallable<{ roundId: string }, { ok: boolean }>(
  functions,
  'attestRound',
);

// ---- Course data entry (organizer) — promotes listed → supported (§4) ------
export const updateCourseData = httpsCallable<
  {
    placeId: string;
    teeSets?: { name: string; yardage: number; rating: number; slope: number; par: number }[];
    holeHandicapOrder?: number[];
    holePars?: number[];
    accessType?: 'public' | 'dailyFee' | 'semiPrivate' | 'private';
    bookingPlatform?: string | null;
    bookingUrl?: string | null;
    bookingWindowDays?: number | null;
    bookingOpensAtLocal?: string | null;
  },
  { ok: boolean; promoted: boolean }
>(functions, 'updateCourseData');

// ---- Spectating / social ----------------------------------------------------
export const followUser = httpsCallable<{ targetId: string }, { ok: boolean }>(
  functions,
  'followUser',
);
export const unfollowUser = httpsCallable<{ targetId: string }, { ok: boolean }>(
  functions,
  'unfollowUser',
);

// ---- Organizer actions ------------------------------------------------------
export const verifyHandicap = httpsCallable<
  { userId: string; source: HandicapSource; note?: string },
  { ok: boolean }
>(functions, 'verifyHandicap');
export const adjustTourIndex = httpsCallable<
  { userId: string; tourIndex: number; note: string },
  { ok: boolean }
>(functions, 'adjustTourIndex');
export const resolveDispute = httpsCallable<
  { matchId: string; winnerEntryId: string; margin: string },
  { ok: boolean }
>(functions, 'resolveDispute');
export const restrictUser = httpsCallable<
  { userId: string; status: 'active' | 'restricted' | 'banned' },
  { ok: boolean }
>(functions, 'restrictUser');
export const reviewEventRequest = httpsCallable<
  { requestId: string; decision: 'approved' | 'declined' },
  { ok: boolean }
>(functions, 'reviewEventRequest');

// ---- Instant events (addendum §2 — the 10% tier) ---------------------------
// A member instantiates a pre-approved template: course, date, fee within the
// template's bounds, payout shape from its allowed list. Live immediately.
export const createInstantEvent = httpsCallable<
  {
    templateId: string;
    placeId: string | null;
    startsAt: number; // epoch ms
    entryFeeCents: number;
    payoutShape: string; // key from the template's allowedPayoutShapes
    name?: string;
  },
  { tournamentId: string }
>(functions, 'createInstantEvent');

// ---- Tour stops (addendum §7 — the backbone of a season) -------------------
// With a schedule, the series IS the league: week 1 is created immediately and
// the hourly sweep auto-creates each following week (rotating through
// placeIds). Standings count each player's best `countBest` weeks.
export const createTourSeries = httpsCallable<
  {
    name: string;
    season: string;
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
  },
  { seriesId: string }
>(functions, 'createTourSeries');
export const createTourStop = httpsCallable<
  {
    seriesId: string;
    weekNumber: number;
    placeId: string;
    startsAt: number;
    teeTimesHeld: number;
    entryFeeCents: number;
    maxEntries: number;
    flights: { min: number; max: number }[];
  },
  { tournamentId: string }
>(functions, 'createTourStop');

// ---- Member event requests (Path B, member-initiated) ----------------------
export const requestEvent = httpsCallable<
  {
    formatId: string;
    proposedEntryCents: number;
    proposedField: number;
    preferredCourses: string[];
    preferredDates: number[];
    note?: string;
  },
  { requestId: string }
>(functions, 'requestEvent');

// ---- Payments (no stored value, ever — §7) ---------------------------------
// Connect Express onboarding so a winner receives payouts to their own account.
export const createConnectOnboardingLink = httpsCallable<
  Record<string, never>,
  { url: string }
>(functions, 'createConnectOnboardingLink');
// SetupIntent for a saved card — powers one-tap re-entry (the wallet UX with
// none of the stored-value exposure).
export const createSetupIntent = httpsCallable<
  Record<string, never>,
  { clientSecret: string }
>(functions, 'createSetupIntent');
// Asks Stripe whether Connect onboarding is actually finished (payouts_enabled),
// not merely whether a link was once created.
export const checkPayoutStatus = httpsCallable<
  Record<string, never>,
  { onboarded: boolean; started: boolean }
>(functions, 'checkPayoutStatus');
