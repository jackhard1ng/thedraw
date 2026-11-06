/**
 * The signed-in user's PRIVATE subdocument (users/{uid}/private/data) —
 * phone and push tokens. Owner-readable only by rules; the public users doc
 * carries no PII, so anything contact-related reads through here.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface PrivateContact {
  phone?: string;
  fcmTokens?: string[];
}

export function usePrivate(uid: string | undefined): PrivateContact | null {
  const [data, setData] = useState<PrivateContact | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, 'users', uid, 'private', 'data'),
      (snap) => setData((snap.data() as PrivateContact | undefined) ?? {}),
      () => setData({}),
    );
  }, [uid]);
  return data;
}
