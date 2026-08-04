/**
 * Follow / unfollow a player (spec §5 spectating). The follow doc id is the
 * deterministic `${followerId}_${targetId}`, so the current state is a single
 * doc read; the toggle itself runs through the followUser / unfollowUser
 * callables.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui';
import { followUser, unfollowUser } from '@/lib/callable';

export function FollowButton({ targetId }: { targetId: string }) {
  const { fbUser } = useAuth();
  const uid = fbUser?.uid;
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid || uid === targetId) {
      setFollowing(false);
      return;
    }
    return onSnapshot(
      doc(db, 'follows', `${uid}_${targetId}`),
      (snap) => setFollowing(snap.exists()),
      () => setFollowing(false),
    );
  }, [uid, targetId]);

  if (!uid || uid === targetId) return null;

  async function toggle() {
    setBusy(true);
    try {
      if (following) await unfollowUser({ targetId });
      else await followUser({ targetId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={following ? 'ghost' : 'primary'} disabled={busy || following === null} onClick={toggle}>
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}
