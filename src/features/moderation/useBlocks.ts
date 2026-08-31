/**
 * The set of users the current user has blocked. A blocked user's posts are
 * hidden and they cannot join yours; the block is silent to the blocked party
 * (spec §5 Safety). Enforcement of "cannot join" lives server-side; hiding is
 * client-side off this hook.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Block } from '@/types/models';

export function useBlockedIds(userId: string | undefined): Set<string> {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!userId) return;
    const q = query(collection(db, 'blocks'), where('blockerId', '==', userId));
    return onSnapshot(q, (snap) => {
      setIds(snap.docs.map((d) => (d.data() as Block).blockedId));
    });
  }, [userId]);
  // Stable identity so downstream effects don't re-run every render.
  return useMemo(() => new Set(ids), [ids]);
}
