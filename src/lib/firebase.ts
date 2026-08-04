/**
 * Firebase initialization (spec §3).
 *
 *   Backend:  Firestore (primary), Cloud Functions, Auth, Cloud Messaging.
 *   Auth:     Phone (SMS) primary — golfers respond to texts, not email.
 *             Google sign-in secondary.
 *   Realtime Database is NOT used in v1 (deferred to Phase 4 live scoring).
 *
 * The web config values are public by design; access is enforced by
 * firestore.rules, not by hiding the API key.
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// True only when the web config is actually present. Guards against the
// white-screen-of-death when env vars are missing on a fresh deploy.
export const firebaseConfigured = Boolean(
  config.apiKey && config.projectId && config.appId,
);

export const app = initializeApp(config);

// getAuth() validates the API key EAGERLY and throws synchronously on a bad or
// missing one — which at module load is an uncatchable white screen. Guard it so
// a misconfigured deploy degrades to a signed-out app with a clear notice
// instead of a blank page. Firestore/Functions initialize lazily and are safe.
export const auth = firebaseConfigured
  ? getAuth(app)
  : (undefined as unknown as ReturnType<typeof getAuth>);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const googleProvider = new GoogleAuthProvider();

export const DEFAULT_MARKET_ID =
  (import.meta.env.VITE_DEFAULT_MARKET_ID as string) || 'kc';

// Local development against the Firebase emulator suite.
if (firebaseConfigured && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
