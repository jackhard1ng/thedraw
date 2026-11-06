/**
 * Device notifications for the web app (FCM web push). Supported on Android
 * and desktop browsers outright, and on iOS once the app is added to the home
 * screen (iOS 16.4+). The token is stored on the user's doc; the server's
 * notify() fans out to it alongside in-app records and SMS.
 */
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { arrayUnion, doc, setDoc } from 'firebase/firestore';
import { app, auth, db } from '@/lib/firebase';

export async function pushSupported(): Promise<boolean> {
  try {
    return (await isSupported()) && 'Notification' in window;
  } catch {
    return false;
  }
}

/** Ask permission, register the FCM worker, save the device token. */
export async function enablePush(): Promise<'enabled' | 'denied' | 'unsupported'> {
  if (!(await pushSupported())) return 'unsupported';
  const uid = auth.currentUser?.uid;
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!uid || !vapidKey) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const cfg = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    senderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
  const reg = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${cfg.toString()}`,
  );

  const token = await getToken(getMessaging(app), {
    vapidKey,
    serviceWorkerRegistration: reg,
  });
  if (!token) return 'denied';

  // Tokens are PII-adjacent — they live on the private subdoc, not the
  // signed-in-readable users doc.
  await setDoc(
    doc(db, 'users', uid, 'private', 'data'),
    { fcmTokens: arrayUnion(token) },
    { merge: true },
  );
  return 'enabled';
}
