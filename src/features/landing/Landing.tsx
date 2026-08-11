/**
 * The landing page — what a cold QR scan opens (dropped at a sold-out men's
 * league, a range, a muni counter). Pitched at exactly that golfer: the league
 * filled up, the season moved on without you, and this is the league that
 * doesn't do that. The live board renders as proof of life (roundPosts are
 * world-readable for precisely this reason).
 *
 * `?src=coursename` on the QR URL is stored and attached to the user doc at
 * onboarding, so every flyer drop is measurable.
 */
import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db, DEFAULT_MARKET_ID, firebaseConfigured } from '@/lib/firebase';
import { Button, Card, Num, Rule } from '@/components/ui';
import { Mark } from '@/components/Mark';
import { SignIn } from '@/features/auth/SignIn';
import { formatTeeTime } from '@/lib/format';
import type { RoundPost } from '@/types/models';

export const REFERRAL_KEY = 'thedraw.src';

function LiveBoardTeaser() {
  const [posts, setPosts] = useState<(RoundPost & { id: string })[] | null>(null);
  useEffect(() => {
    if (!firebaseConfigured) {
      setPosts([]);
      return;
    }
    const q = query(
      collection(db, 'roundPosts'),
      where('marketId', '==', DEFAULT_MARKET_ID),
      where('status', 'in', ['open', 'full']),
      orderBy('booking', 'asc'), // "booked" sorts first — decisions above projects
      orderBy('createdAt', 'desc'),
      limit(3),
    );
    return onSnapshot(
      q,
      (snap) => setPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoundPost) }))),
      () => setPosts([]),
    );
  }, []);

  if (!posts || posts.length === 0) return null;
  return (
    <Card className="p-4 text-left">
      <p className="mb-2 font-display uppercase tracking-wide text-xs text-ink-faint">
        On the board right now
      </p>
      <div className="divide-y divide-rule">
        {posts.map((p) => (
          <div key={p.id} className="flex items-center justify-between py-2 text-sm">
            <span className="min-w-0 truncate text-ink">
              {p.title ||
                (p.timing.mode === 'fixed'
                  ? formatTeeTime(p.timing.fixedTime)
                  : `Flexible · ${p.timing.flexibleDays?.join(', ') ?? ''}`)}
            </span>
            <span className="ml-3 shrink-0 text-xs text-ink-faint">
              <Num>{p.slotsTotal - p.slotsFilled}</Num> open
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Landing() {
  const [showSignIn, setShowSignIn] = useState(false);

  // Capture flyer attribution (?src=ironhorse) before anything else.
  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get('src');
    if (src) localStorage.setItem(REFERRAL_KEY, src.slice(0, 40));
  }, []);

  if (showSignIn) return <SignIn />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10 text-center">
      <Mark className="mx-auto mb-4 h-14 w-14 text-ink" />
      <h1 className="text-4xl leading-tight">
        We are the league.
        <br />
        We are the tournament.
      </h1>
      <p className="mt-3 text-ink-soft">
        Stop digging through course websites for the one league that filled up
        in March. Every tournament, weeknight nine, and money match in Kansas
        City lives here — and it never sells out. Enter any week. Play at your
        level. Winners paid automatically.
      </p>

      <div className="my-6 space-y-2 text-left text-sm text-ink-soft">
        {[
          ['One tap in', 'Enter the weekend draw and get grouped with players at your level. Somebody in your group books — like your regular crew would.'],
          ['Real competition', 'Match play brackets, gross foursomes, a season order of merit. Your record is public and permanent.'],
          ['On your schedule', 'No Tuesday-night-only. Matches happen whenever both players can play — deadlines keep it honest.'],
        ].map(([h, b]) => (
          <div key={h} className="flex gap-3">
            <span className="mt-0.5 font-display uppercase tracking-wide text-xs text-tournament">
              {h}
            </span>
            <span className="flex-1">{b}</span>
          </div>
        ))}
      </div>

      <LiveBoardTeaser />

      <Button variant="primary" className="mt-6 w-full" onClick={() => setShowSignIn(true)}>
        Get in — it's free
      </Button>
      <button
        className="mt-3 text-sm text-ink-faint underline underline-offset-2"
        onClick={() => setShowSignIn(true)}
      >
        Already have a card? Sign in
      </button>

      <Rule className="my-6" />
      <p className="text-xs text-ink-faint">
        Kansas City · free to join · 18+ · real names only
      </p>
    </div>
  );
}
