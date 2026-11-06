/**
 * The in-app notification record is the catch-all channel (spec §5): SMS and
 * push are best-effort, but every notify() lands here — so this is the one
 * place a user can always catch up on what happened to them.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Ts } from '@/types/models';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: Ts | null;
  read: boolean;
}

/** Live unread count (capped at 25 — the badge shows "25+" beyond that). */
export function useUnreadCount(uid: string | undefined): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', uid),
      where('read', '==', false),
      limit(25),
    );
    return onSnapshot(q, (snap) => setCount(snap.size), () => setCount(0));
  }, [uid]);
  return count;
}

/** The inbox list, newest first. */
export function useNotifications(uid: string | undefined): AppNotification[] | null {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    return onSnapshot(
      q,
      (snap) =>
        setItems(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, 'id'>) })),
        ),
      () => setItems([]),
    );
  }, [uid]);
  return items;
}
