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
import { LegalFooter } from '@/features/legal';
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
      <p className="mb-3 font-display uppercase tracking-[0.18em] text-xs text-tournament">
        Real games · real stakes · any handicap
      </p>
      <h1 className="text-4xl leading-tight">
        The league that
        <br />
        was already full.
      </h1>
      <p className="mt-3 text-ink-soft">
        Every good league in town sells out the week registration opens, at one
        course, on one night. We run leagues, tournaments, and one-off matches
        across the whole city — a different course each week, a spot open any
        time. Competition shouldn’t require knowing exactly when and where to
        look.
      </p>

      <div className="my-6 space-y-2 text-left text-sm text-ink-soft">
        {[
          ['Never sells out', 'A single course has a handful of Tuesday slots; the city has hundreds. We spread a league across them, so there’s always room and a fresh course each week.'],
          ['Grab your buddy', 'Team up for a 2-man scramble and take on the field — the most fun you can have for $20. Or go solo in a league, a tournament, or a one-off match. Host one in a minute or drop into one that’s running.'],
          ['Fair at every level', 'Handicapped formats, flights, and net divisions mean a 16-and-a-20 duo can beat the scratch pair on the right day. You don’t have to be good — you have to show up.'],
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
      <div className="mt-4">
        <LegalFooter />
      </div>
    </div>
  );
}
