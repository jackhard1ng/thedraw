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
import { SignIn } from '@/features/auth/SignIn';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { BoardPage } from '@/features/board/BoardPage';
import { CreatePostPage } from '@/features/board/CreatePostPage';
import { PostDetailPage } from '@/features/board/PostDetailPage';
import { LogRoundPage } from '@/features/rounds/LogRoundPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { featureRoutes } from '@/features/routes';

function Shell() {
  const { fbUser, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!fbUser) return <SignIn />;
  if (!profile) return <Onboarding />;

  return (
    <div className="min-h-dvh pb-16">
      <Masthead marketName={profile.marketId === 'kc' ? 'Kansas City' : profile.marketId.toUpperCase()} />
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/post/new" element={<CreatePostPage />} />
        <Route path="/post/:postId" element={<PostDetailPage />} />
        <Route path="/rounds/new" element={<LogRoundPage />} />
        <Route path="/me" element={<ProfilePage />} />
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
