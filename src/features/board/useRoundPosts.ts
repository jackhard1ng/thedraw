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
      // "booked" < "needsBooking" alphabetically, so ASC puts booked first —
      // a booked tee time is a decision, an unbooked one is a project (§4).
      orderBy('booking', 'asc'),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as RoundPost) }))
          .filter((p) => !blockedIds.has(p.createdBy));
        setPosts(rows);
      },
      // A failed query must not strand the page on an infinite spinner.
      () => setPosts([]),
    );
    // blockedIds identity is stable per render via the caller's useMemo.
  }, [marketId, blockedIds]);

  return posts;
}

/**
 * The signed-in user's own upcoming rounds — posts they created or joined.
 * The main board filter hides full posts by default, which would hide YOUR
 * OWN drawn group; this dedicated query is how your Saturday game stays
 * findable without a notification link.
 */
export function useMyRounds(uid: string | undefined): PostWithId[] | null {
  const [mine, setMine] = useState<PostWithId[] | null>(null);
  const [joined, setJoined] = useState<PostWithId[] | null>(null);

  useEffect(() => {
    if (!uid) return;
    const base = collection(db, 'roundPosts');
    const un1 = onSnapshot(
      query(base, where('createdBy', '==', uid), where('status', 'in', ['open', 'full'])),
      (snap) => setMine(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoundPost) }))),
      () => setMine([]),
    );
    const un2 = onSnapshot(
      query(base, where('joinedUserIds', 'array-contains', uid), where('status', 'in', ['open', 'full'])),
      (snap) => setJoined(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoundPost) }))),
      () => setJoined([]),
    );
    return () => {
      un1();
      un2();
    };
  }, [uid]);

  if (mine === null || joined === null) return null;
  const seen = new Set<string>();
  return [...mine, ...joined]
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .sort((a, b) => {
      const at = a.timing.fixedTime?.toMillis() ?? Number.MAX_SAFE_INTEGER;
      const bt = b.timing.fixedTime?.toMillis() ?? Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
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
    return onSnapshot(
      doc(db, 'roundPosts', postId),
      (snap) => {
        setPost(snap.exists() ? { id: snap.id, ...(snap.data() as RoundPost) } : null);
        setLoading(false);
      },
      () => {
        setPost(null);
        setLoading(false);
      },
    );
  }, [postId]);
  return { post, loading };
}
