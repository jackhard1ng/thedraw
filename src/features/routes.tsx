/**
 * Phase 2–5 feature routes and nav additions. The App owner imports and mounts
 * `featureRoutes` inside the app's <Routes> and appends `featureNavItems` to the
 * bottom nav. Direct imports (not lazy) — the bundles are small and this keeps
 * the wiring trivial.
 *
 * Public/shareable routes (/m/:id) are included here too; the App owner decides
 * whether to expose them outside the auth gate.
 */
import { Route } from 'react-router-dom';

import { TournamentListPage } from '@/features/tournaments/TournamentListPage';
import { InstantEventPage } from '@/features/tournaments/InstantEventPage';
import { TourPage } from '@/features/tour/TourPage';
import { TournamentDetailPage } from '@/features/tournaments/TournamentDetailPage';
import { TournamentBracketPage } from '@/features/tournaments/TournamentBracketPage';
import { TournamentLeaderboardPage } from '@/features/tournaments/TournamentLeaderboardPage';
import { MatchPage } from '@/features/matches/MatchPage';
import { ScoreCardPage } from '@/features/matches/ScoreCardPage';
import { PublicMatchPage } from '@/features/spectating/PublicMatchPage';
import { ResultsFeed } from '@/features/spectating/ResultsFeed';
import { OrderOfMerit } from '@/features/spectating/OrderOfMerit';
import { OrganizerConsole } from '@/features/organizer/OrganizerConsole';
import { CreateTournamentForm } from '@/features/organizer/CreateTournamentForm';
import { VerifyHandicapPanel } from '@/features/organizer/VerifyHandicapPanel';
import { ReviewRequests } from '@/features/organizer/ReviewRequests';
import { RequestEventForm } from '@/features/organizer/RequestEventForm';
import { PayoutSetup } from '@/features/payments/PayoutSetup';
import { SavedCard } from '@/features/payments/SavedCard';

export const featureRoutes = [
  <Route key="tournaments" path="/tournaments" element={<TournamentListPage />} />,
  <Route key="instant" path="/tournaments/new-game" element={<InstantEventPage />} />,
  <Route key="tour" path="/tour" element={<TourPage />} />,
  <Route key="tournament" path="/tournaments/:id" element={<TournamentDetailPage />} />,
  <Route key="bracket" path="/tournaments/:id/bracket" element={<TournamentBracketPage />} />,
  <Route key="leaderboard" path="/tournaments/:id/leaderboard" element={<TournamentLeaderboardPage />} />,
  <Route key="scorecard" path="/tournaments/:id/scorecard" element={<ScoreCardPage />} />,
  <Route key="match" path="/matches/:id" element={<MatchPage />} />,
  <Route key="public-match" path="/m/:id" element={<PublicMatchPage />} />,
  <Route key="results" path="/results" element={<ResultsFeed />} />,
  <Route key="standings" path="/standings" element={<OrderOfMerit />} />,
  <Route key="organizer" path="/organizer" element={<OrganizerConsole />} />,
  <Route key="organizer-new" path="/organizer/new" element={<CreateTournamentForm />} />,
  <Route key="organizer-verify" path="/organizer/verify" element={<VerifyHandicapPanel />} />,
  <Route key="organizer-requests" path="/organizer/requests" element={<ReviewRequests />} />,
  <Route key="request-event" path="/request-event" element={<RequestEventForm />} />,
  <Route key="payouts" path="/payouts" element={<PayoutSetup />} />,
  <Route key="wallet" path="/wallet" element={<SavedCard />} />,
];

export const featureNavItems: { to: string; label: string }[] = [
  { to: '/tournaments', label: 'Compete' },
  { to: '/results', label: 'Results' },
  { to: '/standings', label: 'Merit' },
];
