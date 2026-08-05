/**
 * The Draw — Cloud Functions entry point.
 *
 * Everything money- or bracket-touching lives here, behind Auth. Clients never
 * write the collections these own (firestore.rules); the Admin SDK bypasses
 * those rules by design, so the guards in each module ARE the enforcement (§3).
 *
 * Modules:
 *   board        — Phase 1: join/leave, report, block, delete
 *   tournaments  — create/publish/enter/withdraw/close lifecycle (Path B)
 *   matches      — scheduling, results, scorecards, confirmation
 *   completion   — awards + payouts on completion (imported by matches)
 *   organizer    — verify handicap, Tour Index, resolve disputes, moderation
 *   social       — follow, event requests
 *   payments     — Connect onboarding, saved-card SetupIntent
 *   scheduled    — the hourly deterministic machinery (§P1) + weather
 */
export {
  joinRound,
  leaveRound,
  submitReport,
  blockUser,
  unblockUser,
  deleteAccount,
} from './board';

export {
  createTournament,
  publishTournament,
  cancelTournament,
  enterTournament,
  withdrawEntry,
  closeRegistration,
} from './tournaments';

export {
  submitAvailability,
  useExtension,
  setAgreedTime,
  submitResult,
  confirmResult,
  disputeResult,
  submitRoundScore,
  confirmRoundScore,
} from './matches';

export {
  verifyHandicap,
  adjustTourIndex,
  resolveDispute,
  restrictUser,
  reviewEventRequest,
} from './organizer';

export { followUser, unfollowUser, requestEvent } from './social';

export { createInstantEvent } from './instant';

export { createTourSeries, createTourStop } from './tour';

export { collectGreenFees, cancelScheduledMatch } from './greenfees';

export { ensureCourse } from './courses';

export { attestRound, onRoundPosted } from './boardlife';

export { createConnectOnboardingLink, createSetupIntent } from './payments';

export { tick } from './scheduled';
