/**
 * Board queries. Every query filters on `marketId` (spec §P7). Booked posts sort
 * above needsBooking — a booked tee time is a decision, an unbooked one is a
 * project (§4). Blocked users' posts are filtered out client-side (§5 Safety);
 * the block itself is enforced server-side on join.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  doc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RoundPost, Vibe, Stakes } from '@/types/models';

export interface BoardFilters {
  vibe: Vibe | 'all';
  stakes: Stakes | 'all';
  bookedOnly: boolean;
  openSlotsOnly: boolean;
}

export const DEFAULT_FILTERS: BoardFilters = {
  vibe: 'all',
  stakes: 'all',
  bookedOnly: false,
  openSlotsOnly: true,
};

export interface PostWithId extends RoundPost {
  id: string;
}

export function useRoundPosts(marketId: string, blockedIds: Set<string>) {
  const [posts, setPosts] = useState<PostWithId[] | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'roundPosts'),
      where('marketId', '==', marketId),
      where('status', 'in', ['open', 'full']),
      orderBy('booking', 'desc'), // "needsBooking" < "booked" alpha; desc puts booked first
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as RoundPost) }))
        .filter((p) => !blockedIds.has(p.createdBy));
      setPosts(rows);
    });
    // blockedIds identity is stable per render via the caller's useMemo.
  }, [marketId, blockedIds]);

  return posts;
}

export function applyFilters(posts: PostWithId[], f: BoardFilters): PostWithId[] {
  return posts.filter((p) => {
    if (f.vibe !== 'all' && p.vibe !== 'open' && p.vibe !== f.vibe) return false;
    if (f.stakes !== 'all' && p.stakes !== 'open' && p.stakes !== f.stakes) return false;
    if (f.bookedOnly && p.booking !== 'booked') return false;
    if (f.openSlotsOnly && p.slotsFilled >= p.slotsTotal) return false;
    return true;
  });
}

export function usePost(postId: string | undefined) {
  const [post, setPost] = useState<PostWithId | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!postId) return;
    return onSnapshot(doc(db, 'roundPosts', postId), (snap) => {
      setPost(snap.exists() ? { id: snap.id, ...(snap.data() as RoundPost) } : null);
      setLoading(false);
    });
  }, [postId]);
  return { post, loading };
}
