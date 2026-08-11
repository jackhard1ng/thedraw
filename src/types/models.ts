/**
 * The Draw — Firestore data model.
 *
 * Field names here are NORMATIVE: they mirror spec §4 exactly. Do not rename a
 * field to suit a component; the document shape is the contract.
 *
 * Hard rules encoded in these types (spec §3):
 *   - All money is integer CENTS. Every money field is named `...Cents`.
 *   - There is no `balance` field anywhere. Balances are summed from `ledger`.
 *   - Courses are keyed by Google `placeId`, never a name string.
 *   - Every top-level entity carries a `marketId` (§7 market-scoping).
 *
 * `Ts` is a Firestore Timestamp at rest. We alias it loosely so this file can be
 * imported by both client (firebase/firestore Timestamp) and functions
 * (firebase-admin Timestamp) without a hard dependency.
 */

export type Ts = { toDate(): Date; toMillis(): number };
export type Cents = number; // integer cents — never a float, never parseFloat'd

// ---------------------------------------------------------------------------
// markets/{marketId}
// ---------------------------------------------------------------------------
export interface Market {
  id: string;
  name: string;
  timezone: string; // IANA, e.g. "America/Chicago"
  activeSeasonStart: Ts;
  activeSeasonEnd: Ts;
  paidEventsEnabled: boolean; // false at launch; flips per-market, no deploy
  enabledFormats: string[];
  organizerIds: string[];
  adminFeePercent: number; // e.g. 25
}

// ---------------------------------------------------------------------------
// users/{userId}
// Derived, NEVER stored: attendance rate, win/loss, event count, current form.
// ---------------------------------------------------------------------------
export type HandicapSource = 'ghin' | 'thirdParty' | 'self';
export type UserRole = 'member' | 'organizer' | 'admin';
export type UserStatus = 'active' | 'restricted' | 'banned';

export interface Handicap {
  index: number;
  source: HandicapSource;
  ghinNumber: string | null;
  sourceUrl: string | null; // link to wherever they keep it
  verifiedAt: Ts | null;
  verifiedBy: string | null; // organizer userId
}

export interface User {
  marketId: string;
  displayName: string; // real name, no usernames
  photoUrl: string | null;
  age: number;
  gender: 'M' | 'F' | 'other';
  phone: string;
  handicap: Handicap;
  role: UserRole;
  organizerMarkets: string[]; // empty unless organizer
  canCreatePaidEvents: boolean; // separate flag from organizer
  stripeCustomerId: string | null;
  stripeConnectId: string | null; // only if they've received payouts
  createdAt: Ts;
  status: UserStatus;
  /** Match alerts (opt-in): notify when a matching round posts in my market. */
  alertPrefs?: {
    newPostAlerts: boolean;
    maxIndexDelta: number | null; // null = any level
  };
  /** Where in the metro they'd play (KC_AREAS ids). Empty/absent = anywhere. */
  areas?: string[];
}

// ---------------------------------------------------------------------------
// courses/{placeId}
// ---------------------------------------------------------------------------
export type CourseTier = 'supported' | 'listed';
export type AccessType = 'public' | 'dailyFee' | 'semiPrivate' | 'private';

export interface GuestPolicy {
  maxGuestsPerMember: number | null;
  memberMustAccompany: boolean;
  guestFeeCents: Cents | null;
  notes: string | null;
}

export interface TeeSet {
  name: string;
  yardage: number;
  rating: number;
  slope: number;
  par: number;
}

export interface Course {
  placeId: string; // Google Places — canonical key
  marketId: string;
  name: string;
  address: string;
  location: { lat: number; lng: number }; // Firestore geopoint on the wire
  tier: CourseTier;
  accessType: AccessType;
  guestPolicy: GuestPolicy | null; // private / semiPrivate only
  // tier: "supported" only
  bookingPlatform: string | null; // "foreUP" | "GolfNow" | "Lightspeed" | "phone"
  bookingUrl: string | null;
  bookingWindowDays: number | null;
  bookingOpensAtLocal: string | null; // "07:00"
  holeHandicapOrder: number[] | null; // 18 entries — the stroke index
  holePars: number[] | null;
  teeSets: TeeSet[] | null;
  roundCount: number; // drives the promotion queue
}

// ---------------------------------------------------------------------------
// roundPosts/{postId} — the open board. Phase 1 killer feature.
// Required at creation: timing + slotsTotal. Everything else defaults (§P2).
// ---------------------------------------------------------------------------
export type TimingMode = 'fixed' | 'window' | 'flexible';
export type CourseSelectMode = 'specific' | 'flexible';
export type BookingState = 'booked' | 'needsBooking';
export type Vibe = 'casual' | 'competitive' | 'open';
export type Stakes = 'noMoney' | 'money' | 'open';
export type HandicapPref = 'any' | 'similar' | 'range';
export type RoundFormat =
  | 'justGolf'
  | 'singlesMatch'
  | 'twoVTwo'
  | 'skins'
  | 'open';
export type RoundPostStatus = 'open' | 'full' | 'completed' | 'cancelled';

export interface RoundPost {
  marketId: string;
  createdBy: string;
  title: string | null;
  description: string | null;
  timing: {
    mode: TimingMode;
    fixedTime: Ts | null;
    windowStart: Ts | null;
    windowEnd: Ts | null;
    flexibleDays: string[] | null; // e.g. ["saturday"]
  };
  course: {
    mode: CourseSelectMode;
    placeId: string | null;
    preferredPlaceIds: string[] | null;
  };
  booking: BookingState;
  slotsTotal: number;
  slotsFilled: number;
  hosting: {
    isMemberHosted: boolean; // private/semi-private course access
    hostMustApprove: boolean; // host picks who joins, not first-come
    guestFeeCents: Cents | null; // disclosed up front, collected like a green fee
  } | null;
  vibe: Vibe; // default: open
  stakes: Stakes; // default: open
  handicapPref: HandicapPref; // default: any
  handicapRange: [number, number] | null;
  format: RoundFormat;
  joinedUserIds: string[];
  // Player-arranged stakes (spec Path A). The app NEVER holds or routes this.
  stakesAmount: null; // never captured
  stakesHandledByApp: false; // always false, no exception
  /** Standing game: re-posts itself one week forward when it completes. */
  recurrence?: 'weekly' | null;
  standingOriginId?: string;
  status: RoundPostStatus;
  createdAt: Ts;
}

// ---------------------------------------------------------------------------
// formats/{formatId} — formats are DATA, not code. New format = new doc.
// ---------------------------------------------------------------------------
export type Scoring = 'scramble' | 'strokePlay' | 'matchPlay' | 'stableford';
export type Advancement =
  | 'bracket'
  | 'roundRobin'
  | 'singleRound'
  | 'cumulative';
export type FlightBy = 'combinedIndex' | 'individualIndex' | 'none';

export interface Format {
  id: string;
  name: string;
  teamSize: number;
  scoring: Scoring;
  handicapAllowance: Record<string, number> | { type: string } | null;
  advancement: Advancement;
  holes?: number;
  rounds?: number;
  groupSize?: number;
  flightBy: FlightBy;
  designatedCourses?: string[]; // one placeId per round — required for net
  scoringMode?: 'gross' | 'net' | 'both';
  requiresWitness: boolean; // true = eligible for money events (§P3)
  eligibleForMoney: boolean;
}

// ---------------------------------------------------------------------------
// tournaments/{tournamentId} — organizer-run only (Path B). Phase 2/3.
// ---------------------------------------------------------------------------
export type Division = 'gross' | 'net';
export type DivisionMode = 'grossOnly' | 'netOnly' | 'both';
export type DoubleDipRule = 'onePrizePerPlayer' | 'exclusiveDivisions';
export type PrizeType = 'cashPurse' | 'sponsoredPrizes';
export type TournamentStructure = 'bracket' | 'pods';
export type TournamentStatus =
  | 'draft'
  | 'open'
  | 'filled'
  | 'inProgress'
  | 'complete'
  | 'cancelled';

export interface PayoutRow {
  division: Division;
  place: number;
  sharePercent: number; // all rows must sum to 100 (validated in a function)
}

export interface Eligibility {
  minEventsCompleted: number;
  minAttendanceRate: number;
  requiresVerifiedIndex: boolean;
  maxHandicapVerificationAgeDays: number;
  indexRange: [number, number] | null;
  requiresCompleteProfile: boolean;
  // extended defaults for money events (§5)
  minAttestedRounds?: number;
  minAccountAgeDays?: number;
  requiresPaymentMethod?: boolean;
  onePerPhoneNumber?: boolean;
  requiresGhinVerified?: boolean;
}

export interface Tournament {
  marketId: string;
  formatId: string;
  createdBy: string; // must be organizer
  name: string;
  description: string;
  entryFeeCents: Cents;
  adminFeePercent: number;
  payoutTable: PayoutRow[]; // published before entries close
  divisionMode: DivisionMode;
  doubleDipRule: DoubleDipRule;
  prizeType: PrizeType;
  sponsoredPrizes: { place: number; description: string; value: string }[] | null;
  minEntries: number; // below this = full refund to all
  maxEntries: number;
  registrationOpens: Ts;
  registrationCloses: Ts;
  eligibility: Eligibility;
  structure: TournamentStructure;
  roundDeadlineDays: number;
  status: TournamentStatus;
  entryIds: string[];
}

// ---------------------------------------------------------------------------
// entries/{entryId}
// ---------------------------------------------------------------------------
export type PaymentStatus =
  | 'pending' // free-event placeholder before the server resolves it
  | 'pendingAuthorization' // slot reserved; card form not yet completed
  | 'authorized' // card held (manual capture) — charged only at close
  | 'methodSaved' // long window: card saved, charged at close
  | 'captured'
  | 'captureFailed'
  | 'lapsed' // pendingAuthorization at close — spot released, never charged
  | 'refunded';
export type EntryStatus = 'active' | 'eliminated' | 'withdrawn' | 'forfeited';

export interface Entry {
  tournamentId: string;
  userIds: string[]; // 1 for singles, 2 for teams
  /** Denormalized at entry so public pages never read the users collection. */
  displayNames?: string[];
  teamId: string | null;
  teamName: string | null;
  captainId: string;
  combinedIndex: number; // FROZEN at registration — never recalculated
  flight: string | null; // assigned from combinedIndex, also frozen
  seed: number;
  paymentIntentId: string | null;
  paymentStatus: PaymentStatus;
  status: EntryStatus;
}

// ---------------------------------------------------------------------------
// teams/{teamId} — persistent partnerships. Derived: record, awards.
// ---------------------------------------------------------------------------
export interface Team {
  marketId: string;
  name: string;
  memberIds: [string, string];
  createdAt: Ts;
  status: 'active' | 'retired';
}

// ---------------------------------------------------------------------------
// awards/{awardId} — append-only. Record placements, not just wins.
// ---------------------------------------------------------------------------
export type Placement =
  | 'champion'
  | 'runnerUp'
  | 'semifinalist'
  | 'quarterfinalist'
  | 'flightWinner'
  | 'podWinner';

export interface Award {
  userId: string;
  teamId: string | null;
  partnerId: string | null;
  tournamentId: string;
  tournamentName: string; // denormalized — survives forever
  season: string; // "2026 Fall"
  flight: string | null;
  placement: Placement;
  path: { round: number; opponentName: string; result: string }[];
  awardedAt: Ts;
}

// ---------------------------------------------------------------------------
// matches/{matchId}
// ---------------------------------------------------------------------------
export type MatchStatus =
  | 'pendingOpponent' // a later-round slot waiting on the other semifinal etc.
  | 'scheduling'
  | 'scheduled'
  | 'awaitingResult'
  | 'awaitingConfirmation'
  | 'complete'
  | 'forfeited'
  | 'voidedWeather';

export interface Match {
  tournamentId: string;
  round: number;
  entryIds: [string, string];
  scheduling: {
    deadline: Ts;
    availabilityLog: { entryId: string; dates: Ts[]; submittedAt: Ts }[];
    extensionsUsed: Record<string, boolean>;
    agreedTime: Ts | null;
    placeId: string | null;
    bookedBy: string | null;
  };
  result: {
    submittedBy: string | null;
    submittedAt: Ts | null;
    winnerEntryId: string | null;
    margin: string | null; // "3&2"
    holes: HoleResult[] | null; // nullable in v1, populated in Phase 4
    confirmedBy: string | null;
    confirmedAt: Ts | null;
    disputed: boolean;
    scorecardPhotoUrl: string | null;
  };
  status: MatchStatus;
  forfeitedBy: string | null;
  forfeitReason: string | null;
  /**
   * Present ONLY when the booker prepaid and opted to split (§5). Default is
   * green fees paid individually at the course — no money through the app.
   */
  greenFees?: {
    perPlayerCents: number;
    chargedUserIds: string[];
    collectedAt: Ts;
    refundPending: boolean;
  } | null;
}

// Modeled from day one even though v1 only captures totals — the single line of
// foresight that turns live scoring from a migration into a feature (§4).
export interface HoleResult {
  hole: number;
  scores: Record<string, number>; // entryId -> strokes
  winnerEntryId: string | null;
}

// ---------------------------------------------------------------------------
// scorecards/{scorecardId} — a player's score in a stroke-play tournament round
// (gross foursome, multi-round stroke play). Match-play results live on `matches`
// instead. Doc id: `${tournamentId}_${entryId}_${round}`. Confirmation mirrors
// match results: silence auto-confirms (§P1).
// ---------------------------------------------------------------------------
export interface Scorecard {
  tournamentId: string;
  entryId: string;
  userId: string;
  round: number;
  placeId: string; // designated per round for net comparison (§4)
  gross: number; // strokes
  courseHandicap: number | null; // frozen; null if course lacks tee data
  net: number | null; // gross - courseHandicap
  holes: HoleResult[] | null; // modeled now, populated Phase 4
  submittedBy: string | null;
  confirmedBy: string | null;
  confirmDeadline: Ts | null;
  scorecardPhotoUrl: string | null;
  status: 'awaitingResult' | 'awaitingConfirmation' | 'complete' | 'disputed';
}

// ---------------------------------------------------------------------------
// follows/{followerId}_{targetId} — spectating (§5). Notify when a followed
// player's result posts.
// ---------------------------------------------------------------------------
export interface Follow {
  followerId: string;
  targetId: string;
  createdAt: Ts;
}

// ---------------------------------------------------------------------------
// rounds/{roundId} — casual / self-reported. Separate from competitive results.
// ---------------------------------------------------------------------------
export type TeePosition =
  | 'tips'
  | 'back'
  | 'middle'
  | 'forwardMiddle'
  | 'forward';
export type RoundSource = 'selfReported' | 'attested' | 'tournament';

export interface Round {
  userId: string;
  placeId: string;
  playedAt: Ts;
  holes: 9 | 18;
  totalScore: number;
  teePosition: TeePosition;
  teeName: string | null;
  yardage: number | null;
  source: RoundSource;
  attestedBy: string | null;
  roundPostId: string | null;
}

// ---------------------------------------------------------------------------
// ledger/{entryId} — append-only. There is NO balance field in the system.
// ---------------------------------------------------------------------------
export type LedgerType =
  | 'entryFee'
  | 'adminFee'
  | 'payout'
  | 'refund'
  | 'greenFee'
  | 'greenFeeReimbursement';

export interface LedgerRow {
  type: LedgerType;
  amountCents: Cents; // integer, always
  fromUserId: string | null;
  toUserId: string | null;
  tournamentId: string | null;
  matchId: string | null;
  stripeRef: string;
  timestamp: Ts;
  note: string;
}

// ---------------------------------------------------------------------------
// reputationEvents/{eventId} — append-only. Displayed as a fact, never a rating.
// ---------------------------------------------------------------------------
export type ReputationType =
  | 'committed'
  | 'played'
  | 'noShow'
  | 'lateCancel'
  | 'forfeitNonResponse';

export interface ReputationEvent {
  userId: string;
  type: ReputationType;
  matchId: string | null;
  timestamp: Ts;
  expiresAt: Ts; // ~1 year; old flakes shouldn't follow forever
}

// ---------------------------------------------------------------------------
// playRequests/{id} — Enter the Draw. One tap in; the hourly sweep groups
// compatible entrants and creates a full round post with a designated booker.
// ---------------------------------------------------------------------------
export interface PlayRequest {
  marketId: string;
  userId: string;
  displayName: string;
  index: number; // frozen at entry
  day: string; // "saturday"
  willingToBook: boolean;
  areas?: string[]; // copied from the user at entry; empty = anywhere
  status: 'open' | 'matched' | 'withdrawn' | 'expired';
  postId?: string;
  createdAt: Ts;
  expiresAt: Ts;
}

// ---------------------------------------------------------------------------
// Moderation (Phase 1, non-deferrable — §5 Safety)
// ---------------------------------------------------------------------------
export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: Ts;
}

export type ReportTargetType = 'user' | 'post' | 'match';
export interface Report {
  reportedBy: string;
  targetType: ReportTargetType;
  targetId: string;
  marketId: string;
  reason: string;
  context: string | null;
  createdAt: Ts;
  status: 'open' | 'reviewing' | 'resolved';
}

// ---------------------------------------------------------------------------
// Chat — threads/{threadId}/messages/{messageId}. threadId === postId (or matchId).
// ---------------------------------------------------------------------------
export interface ChatMessage {
  authorId: string;
  authorName: string; // denormalized for cheap rendering
  text: string;
  createdAt: Ts;
}
