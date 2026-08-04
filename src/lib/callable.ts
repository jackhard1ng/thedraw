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
  { entryId: string; clientSecret: string | null }
>(functions, 'enterTournament');
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
export const useExtension = httpsCallable<{ matchId: string }, { ok: boolean }>(
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
