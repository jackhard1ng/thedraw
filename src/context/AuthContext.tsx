/**
 * Auth + current-user context. Phone (SMS) is the primary method (§3); Google
 * is secondary. A signed-in Firebase user does not yet have a `users` document —
 * that is created during onboarding once they supply a real name and handicap.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signOut, type User as FbUser } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { User } from '@/types/models';

interface AuthState {
  fbUser: FbUser | null;
  profile: User | null; // null until onboarding creates the users doc
  loading: boolean;
  signOutNow: () => Promise<void>;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [fbUser, setFbUser] = useState<FbUser | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setFbUser(u);
      setAuthReady(true);
      if (!u) {
        setProfile(null);
        setProfileReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!fbUser) return;
    setProfileReady(false);
    const ref = doc(db, 'users', fbUser.uid);
    return onSnapshot(ref, (snap) => {
      setProfile(snap.exists() ? (snap.data() as User) : null);
      setProfileReady(true);
    });
  }, [fbUser]);

  const value = useMemo<AuthState>(
    () => ({
      fbUser,
      profile,
      loading: !authReady || (!!fbUser && !profileReady),
      signOutNow: () => signOut(auth),
    }),
    [fbUser, profile, authReady, profileReady],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
