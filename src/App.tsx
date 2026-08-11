/**
 * App shell + routing. Three gates, in order:
 *   1. not signed in            -> SignIn (phone/Google)
 *   2. signed in, no profile    -> Onboarding (creates users doc)
 *   3. signed in, has profile   -> the app (board is home)
 */
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BottomNav } from '@/components/BottomNav';
import { Masthead } from '@/components/Mark';
import { Landing } from '@/features/landing/Landing';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { BoardPage } from '@/features/board/BoardPage';
import { CreatePostPage } from '@/features/board/CreatePostPage';
import { PostDetailPage } from '@/features/board/PostDetailPage';
import { LogRoundPage } from '@/features/rounds/LogRoundPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { PlayerProfilePage } from '@/features/profile/PlayerProfilePage';
import { InboxPage } from '@/features/notifications/InboxPage';
import { Bell } from '@/features/notifications/Bell';
import { featureRoutes } from '@/features/routes';
import { TournamentDetailPage } from '@/features/tournaments/TournamentDetailPage';
import { TournamentBracketPage } from '@/features/tournaments/TournamentBracketPage';
import { TournamentLeaderboardPage } from '@/features/tournaments/TournamentLeaderboardPage';
import { PublicMatchPage } from '@/features/spectating/PublicMatchPage';
import { ResultsFeed } from '@/features/spectating/ResultsFeed';
import { OrderOfMerit } from '@/features/spectating/OrderOfMerit';

/**
 * Signed-out chrome for public spectating pages: masthead + a persistent
 * "sign in" strip instead of the app's bottom nav.
 */
function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-16">
      <Masthead marketName="Kansas City" />
      {children}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper-raised/95 p-3 text-center backdrop-blur">
        <a href="/" className="font-display uppercase tracking-wide text-sm text-tournament">
          The Draw — sign in to play →
        </a>
      </div>
    </div>
  );
}

function Shell() {
  const { fbUser, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!fbUser) {
    // Spectating is PUBLIC (§5 + firestore.rules): shared links to posts,
    // tournaments, brackets, results, and match pages must open for a
    // signed-out visitor — the whole point of a shareable competitive record.
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/post/:postId" element={<PublicShell><PostDetailPage /></PublicShell>} />
        <Route path="/tournaments/:id" element={<PublicShell><TournamentDetailPage /></PublicShell>} />
        <Route path="/tournaments/:id/bracket" element={<PublicShell><TournamentBracketPage /></PublicShell>} />
        <Route path="/tournaments/:id/leaderboard" element={<PublicShell><TournamentLeaderboardPage /></PublicShell>} />
        <Route path="/m/:id" element={<PublicShell><PublicMatchPage /></PublicShell>} />
        <Route path="/results" element={<PublicShell><ResultsFeed /></PublicShell>} />
        <Route path="/standings" element={<PublicShell><OrderOfMerit /></PublicShell>} />
        <Route path="*" element={<Landing />} />
      </Routes>
    );
  }
  if (!profile) return <Onboarding />;

  return (
    <div className="min-h-dvh pb-16">
      <Masthead
        marketName={profile.marketId === 'kc' ? 'Kansas City' : profile.marketId.toUpperCase()}
        right={<Bell />}
      />
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/post/new" element={<CreatePostPage />} />
        <Route path="/post/:postId" element={<PostDetailPage />} />
        <Route path="/rounds/new" element={<LogRoundPage />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="/profile" element={<Navigate to="/me" replace />} />
        <Route path="/players/:uid" element={<PlayerProfilePage />} />
        <Route path="/inbox" element={<InboxPage />} />
        {/* Phase 2–5 feature routes (tournaments, matches, spectating,
            organizer, payments) — mounted from the feature manifest. */}
        {featureRoutes}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
