/**
 * Profile — reads top to bottom as a story (spec §8):
 *   who they are → what they claim and how well-sourced → what they've done →
 *   how reliably they show up.
 *
 * The verified index and self-reported rounds live in visually separate
 * sections and are never blended (§4). Attendance is prominent — it matters more
 * to "should I accept this match" than the handicap does (§8).
 *
 * Attendance, record, and event counts are DERIVED, never stored (§4). In
 * Phase 1 there are no competitive events yet, so these read from reputation
 * events and self-reported rounds only.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { deleteAccount } from '@/lib/callable';
import { Badge, Button, Card, Num, Rule, SectionHeader, Spinner } from '@/components/ui';
import { freshness, indexLine, sourceBadge, tierFor } from '@/lib/handicap';
import { areasFor } from '@/lib/areas';
import { formatTeeTime } from '@/lib/format';
import { formatCents } from '@/lib/money';
import { usePrivate } from '@/lib/usePrivate';
import type { ReputationEvent, Round } from '@/types/models';

const PLACEMENT_LABEL: Record<string, string> = {
  champion: 'Champion',
  runnerUp: 'Runner-up',
  semifinalist: 'Semifinalist',
  quarterfinalist: 'Quarterfinalist',
  podWinner: 'Pod winner',
  flightWinner: 'Flight winner',
};

interface AwardRow {
  id: string;
  tournamentName: string;
  season: string;
  placement: string;
  flight: string | null;
  amountCents: number | null;
}

/** The trophy shelf — placements and real dollars, from the append-only awards. */
function AwardsList({ userId }: { userId: string }) {
  const [awards, setAwards] = useState<AwardRow[] | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, 'awards'),
      where('userId', '==', userId),
      orderBy('awardedAt', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => setAwards(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AwardRow, 'id'>) }))),
      () => setAwards([]),
    );
  }, [userId]);

  if (awards === null) return null;
  if (awards.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        No placements yet — they land here the moment an event completes.
      </p>
    );
  }
  const totalCents = awards.reduce((a, w) => a + (w.amountCents ?? 0), 0);
  return (
    <div>
      {totalCents > 0 && (
        <p className="mb-2 text-sm text-ink">
          Career winnings: <Num className="text-pine">{formatCents(totalCents)}</Num>
        </p>
      )}
      <div className="divide-y divide-rule">
        {awards.map((w) => (
          <div key={w.id} className="flex items-center justify-between py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-ink">
                {PLACEMENT_LABEL[w.placement] ?? w.placement}
                {w.flight ? ` · ${w.flight}` : ''}
              </p>
              <p className="text-xs text-ink-faint">
                {w.tournamentName} · {w.season}
              </p>
            </div>
            {w.amountCents != null && w.amountCents > 0 && (
              <Num className="shrink-0 text-pine">{formatCents(w.amountCents)}</Num>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReputationLine({ userId }: { userId: string }) {
  const [events, setEvents] = useState<ReputationEvent[] | null>(null);
  useEffect(() => {
    const q = query(collection(db, 'reputationEvents'), where('userId', '==', userId));
    return onSnapshot(
      q,
      (snap) => setEvents(snap.docs.map((d) => d.data() as ReputationEvent)),
      () => setEvents([]),
    );
  }, [userId]);

  if (events === null) return null;
  const committed = events.filter((e) => e.type === 'committed').length;
  const played = events.filter((e) => e.type === 'played').length;
  if (committed === 0) {
    return <p className="text-sm text-ink-faint">No committed rounds yet.</p>;
  }
  // Displayed as a fact, never a star rating (§4).
  return (
    <p className="text-ink">
      Played <Num>{played}</Num> of <Num>{committed}</Num> committed rounds.
    </p>
  );
}

function SelfReportedRounds({ userId }: { userId: string }) {
  const [rounds, setRounds] = useState<(Round & { id: string })[] | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, 'rounds'),
      where('userId', '==', userId),
      orderBy('playedAt', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => setRounds(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Round) }))),
      () => setRounds([]),
    );
  }, [userId]);

  if (rounds === null) return <Spinner />;
  if (rounds.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        No rounds logged.{' '}
        <Link to="/rounds/new" className="text-tournament underline">
          Log one
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="divide-y divide-rule">
      {rounds.map((r) => (
        <div key={r.id} className="flex items-center justify-between py-2 text-sm">
          <div>
            <span className="text-ink">{formatTeeTime(r.playedAt)}</span>
            <span className="ml-2 text-ink-faint">
              {r.holes} holes · {r.teePosition}
            </span>
            {r.source === 'attested' && (
              <span className="ml-2">
                <Badge tone="fresh">Attested</Badge>
              </span>
            )}
          </div>
          <Num className="text-lg text-ink">{r.totalScore}</Num>
        </div>
      ))}
    </div>
  );
}

/** Device notifications (FCM web push) — banners like any installed app. */
function PushButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'enabled' | 'denied' | 'unsupported'>('idle');
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-ink">
        Device notifications
        <span className="block text-xs text-ink-faint">
          Banners for draws, deadlines, and chat — like any app. On iPhone, add
          to Home Screen first.
        </span>
      </span>
      {state === 'enabled' ? (
        <Badge tone="fresh">On</Badge>
      ) : (
        <Button
          variant="ghost"
          className="px-3 py-1.5 text-xs"
          disabled={state === 'busy'}
          onClick={async () => {
            setState('busy');
            const { enablePush } = await import('@/lib/push');
            setState(await enablePush());
          }}
        >
          {state === 'busy' ? '…' : state === 'denied' ? 'Blocked in browser' : state === 'unsupported' ? 'Not available' : 'Enable'}
        </Button>
      )}
    </div>
  );
}

/** Match alerts (opt-in): in-app notice when a matching round posts. */
function AlertPrefs({ userId, prefs }: { userId: string; prefs?: { newPostAlerts: boolean; maxIndexDelta: number | null } }) {
  const on = prefs?.newPostAlerts ?? false;
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'users', userId), {
        alertPrefs: { newPostAlerts: !on, maxIndexDelta: prefs?.maxIndexDelta ?? 8 },
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="flex items-center justify-between py-2 text-sm">
      <span className="text-ink">
        Alert me when a round near my level is posted
        <span className="block text-xs text-ink-faint">
          Within ±8 of your index, your market only.
        </span>
      </span>
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={toggle}
        className="h-5 w-5 accent-tournament"
      />
    </label>
  );
}

/**
 * The member-facing path to the green badge. One tap files a request into the
 * organizer's queue; the button reflects the open request so nobody wonders
 * whether "have an organizer verify it" actually went anywhere.
 */
function VerificationRequest({
  userId,
  marketId,
  displayName,
  ghinNumber,
  sourceUrl,
}: {
  userId: string;
  marketId: string;
  displayName: string;
  ghinNumber: string | null;
  sourceUrl: string | null;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'requested'>('idle');
  useEffect(() => {
    const q = query(
      collection(db, 'verificationRequests'),
      where('userId', '==', userId),
      where('status', '==', 'open'),
    );
    return onSnapshot(
      q,
      (snap) => setState((s) => (snap.empty ? (s === 'requested' ? 'idle' : s) : 'requested')),
      () => undefined,
    );
  }, [userId]);

  async function request() {
    setState('busy');
    try {
      const { addDoc, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'verificationRequests'), {
        userId,
        marketId,
        displayName,
        ghinNumber,
        sourceUrl,
        status: 'open',
        createdAt: serverTimestamp(),
      });
      setState('requested');
    } catch {
      setState('idle');
    }
  }

  return (
    <div className="mt-3 border-t border-rule pt-3">
      <p className="text-xs text-ink-faint">
        A verified index earns the green badge and unlocks money events.
        {!ghinNumber && !sourceUrl && ' Add a GHIN number or record link first for a faster check.'}
      </p>
      {state === 'requested' ? (
        <p className="mt-2 text-xs text-pine">
          Verification requested — the market organizer checks your record and
          you'll get a notification when it's done.
        </p>
      ) : (
        <Button
          variant="ghost"
          className="mt-2 px-3 py-1.5 text-xs"
          disabled={state === 'busy'}
          onClick={request}
        >
          {state === 'busy' ? '…' : 'Request verification'}
        </Button>
      )}
    </div>
  );
}

/**
 * Texts are the deadline-critical channel — a Google-sign-in user has no phone
 * on file, so this row lets them add one (and anyone correct theirs).
 */
function PhoneRow({ userId }: { userId: string }) {
  const contact = usePrivate(userId);
  const phone = contact?.phone ?? '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (contact === null) return null;
  if (!editing) {
    return (
      <div className="flex items-center justify-between py-2 text-sm">
        <span className="text-ink">
          Text alerts
          <span className="block text-xs text-ink-faint">
            {phone
              ? `Deadline-critical texts go to ${phone}.`
              : 'No number on file — you won’t get deadline texts, only inbox and push.'}
          </span>
        </span>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => { setValue(phone); setEditing(true); }}>
          {phone ? 'Change' : 'Add number'}
        </Button>
      </div>
    );
  }
  return (
    <div className="py-2">
      <input
        className="field-input tnum"
        inputMode="tel"
        autoComplete="tel"
        placeholder="816-555-0123"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          className="px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { normalizePhone } = await import('@/features/onboarding/Onboarding');
              const { setDoc: setPrivateDoc } = await import('firebase/firestore');
              await setPrivateDoc(
                doc(db, 'users', userId, 'private', 'data'),
                { phone: normalizePhone(value) },
                { merge: true },
              );
              setEditing(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Where they'll play. The metro is wide — downtown and Blue Springs shouldn't
 * get drawn together unless someone said "anywhere". Empty selection = anywhere
 * (the friendly default: never blocks a match).
 */
function AreaPrefs({ userId, marketId, areas }: { userId: string; marketId: string; areas?: string[] }) {
  const options = areasFor(marketId);
  const selected = new Set(areas ?? []);
  const [busy, setBusy] = useState(false);
  if (options.length === 0) return null;

  async function toggleArea(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBusy(true);
    try {
      await updateDoc(doc(db, 'users', userId), { areas: [...next] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-2">
      <p className="text-sm text-ink">Where you’ll play</p>
      <p className="text-xs text-ink-faint">
        The draw only groups you with players in a shared area. Pick none to
        play anywhere in the metro.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((a) => {
          const on = selected.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              disabled={busy}
              onClick={() => toggleArea(a.id)}
              title={a.hint}
              className={`rounded-full border px-3 py-1 text-xs font-display uppercase tracking-wide transition-colors ${
                on
                  ? 'border-tournament bg-tournament text-paper'
                  : 'border-rule-strong text-ink-soft'
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      {selected.size === 0 && (
        <p className="mt-2 text-xs text-ink-faint">Currently: anywhere.</p>
      )}
    </div>
  );
}

export function ProfilePage() {
  const { profile, fbUser, signOutNow } = useAuth();
  if (!profile || !fbUser) return <Spinner />;

  const badge = sourceBadge(profile.handicap);
  const fresh = freshness(profile.handicap.verifiedAt);

  async function onDelete() {
    if (
      !window.confirm(
        'Delete your account? This actually deletes your profile and posts. Only legally-required ledger rows are retained, anonymized.',
      )
    )
      return;
    await deleteAccount({});
    await signOutNow();
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      {/* Who they are */}
      <div className="flex items-center gap-4">
        {profile.photoUrl ? (
          <img
            src={profile.photoUrl}
            alt=""
            className="h-16 w-16 rounded-full border border-rule object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-rule bg-paper-sunken font-display text-xl text-ink-soft">
            {profile.displayName.slice(0, 1)}
          </div>
        )}
        <div>
          <h1 className="text-2xl">{profile.displayName}</h1>
          <p className="text-sm text-ink-faint">
            {profile.age} · {profile.marketId.toUpperCase()}
          </p>
        </div>
      </div>

      {/* What they claim and how well-sourced */}
      <Card className="mt-6 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display uppercase tracking-wide text-xs text-ink-faint">
              Handicap
            </p>
            <p className="mt-1 text-xl">
              <Num>{indexLine(profile.handicap)}</Num>
            </p>
            {/* The tier — stable while the decimal drifts; derived, never stored. */}
            <p className="mt-1">
              <Badge tone="tournament">
                Tier {tierFor(profile.handicap.index).label}
              </Badge>
              <span className="ml-2 text-xs text-ink-faint">
                {tierFor(profile.handicap.index).range}
              </span>
            </p>
          </div>
          <div className="text-right">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {profile.handicap.verifiedAt && (
              <p className={`mt-1 text-xs ${fresh === 'fresh' ? 'text-fresh' : fresh === 'stale' ? 'text-stale' : 'text-ink-faint'}`}>
                Verified {formatTeeTime(profile.handicap.verifiedAt)}
              </p>
            )}
          </div>
        </div>
        {!profile.handicap.verifiedAt && (
          <VerificationRequest
            userId={fbUser.uid}
            marketId={profile.marketId}
            displayName={profile.displayName}
            ghinNumber={profile.handicap.ghinNumber}
            sourceUrl={profile.handicap.sourceUrl}
          />
        )}
      </Card>

      {/* How reliably they show up — prominent (§8) */}
      <div className="mt-6">
        <SectionHeader>Reliability</SectionHeader>
        <ReputationLine userId={fbUser.uid} />
      </div>

      {/* The competitive record — placements and winnings (the product's moat) */}
      <div className="mt-6">
        <SectionHeader>Record</SectionHeader>
        <AwardsList userId={fbUser.uid} />
      </div>

      {/* Self-reported rounds — visually separate, clearly labeled (§4) */}
      <div className="mt-6">
        <SectionHeader
          right={
            <Link to="/rounds/new" className="text-xs text-tournament underline">
              + Log
            </Link>
          }
        >
          Self-reported rounds
        </SectionHeader>
        <p className="mb-2 text-xs text-ink-faint">
          A rough picture. Not part of your verified index.
        </p>
        <SelfReportedRounds userId={fbUser.uid} />
      </div>

      {/* Money rails — no stored value; winnings pay out to your own account (§7) */}
      <div className="mt-8">
        <SectionHeader>Account</SectionHeader>
        <div className="divide-y divide-rule">
          <Link to="/payouts" className="flex items-center justify-between py-3">
            <span>Set up payouts</span>
            <span className="text-ink-faint">→</span>
          </Link>
          <Link to="/wallet" className="flex items-center justify-between py-3">
            <span>Saved card for one-tap re-entry</span>
            <span className="text-ink-faint">→</span>
          </Link>
          <Link to="/request-event" className="flex items-center justify-between py-3">
            <span>Request an event</span>
            <span className="text-ink-faint">→</span>
          </Link>
        </div>
      </div>

      {/* Notifications */}
      <div className="mt-6">
        <SectionHeader>Alerts</SectionHeader>
        <PushButton />
        <PhoneRow userId={fbUser.uid} />
        <AlertPrefs userId={fbUser.uid} prefs={profile.alertPrefs} />
      </div>

      {/* Area preferences — feed the draw's grouping (shared-area rule) */}
      <div className="mt-6">
        <SectionHeader>Home turf</SectionHeader>
        <AreaPrefs userId={fbUser.uid} marketId={profile.marketId} areas={profile.areas} />
      </div>

      <Rule className="my-8" />

      <div className="space-y-3">
        <Button variant="ghost" className="w-full" onClick={signOutNow}>
          Sign out
        </Button>
        <button
          onClick={onDelete}
          className="w-full py-2 text-center text-sm text-tournament underline"
        >
          Delete account
        </button>
      </div>
    </div>
  );
}
