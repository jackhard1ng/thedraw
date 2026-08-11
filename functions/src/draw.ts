/**
 * Enter the Draw — one-tap matching. You don't find a game; you enter the draw
 * and get drawn into one.
 *
 * The draw's output is a GROUP, not a tee time. The app holds no inventory
 * (spec §9) — a human always books. So every drawn group has a DESIGNATED
 * BOOKER, chosen from those who entered willing to book (the same
 * responsibility pattern as a tournament captain, §4). The "you're drawn"
 * notice names them: nobody wonders whose job the booking is.
 *
 *   - enterDraw: one tap — market, day, index all come from your profile.
 *     willingToBook defaults true.
 *   - drawSweep (hourly): greedily groups compatible open requests
 *     (same market + day, index spread ≤ MAX_SPREAD, group of 4 → 3 → 2,
 *     at least one willing booker per group), creates a FULL round post with
 *     chat open, notifies everyone, marks requests matched.
 *   - Requests expire after 7 days (silence resolves, §P1).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp, requireAuth, requireActive } from './shared';
import { notify } from './lib/notify';

export const MAX_INDEX_SPREAD = 8;
const REQUEST_TTL_DAYS = 7;

export const enterDraw = onCall<{
  day: string; // "saturday" | "sunday" | ...
  willingToBook?: boolean;
}>(async (req) => {
  const uid = requireAuth(req.auth);
  const user = await requireActive(uid);
  const day = String(req.data.day || '').toLowerCase();
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (!DAYS.includes(day)) throw new HttpsError('invalid-argument', 'Pick a day of the week.');

  // One open request per user per day.
  const existing = await db
    .collection('playRequests')
    .where('userId', '==', uid)
    .where('day', '==', day)
    .where('status', '==', 'open')
    .get();
  if (!existing.empty) return { requestId: existing.docs[0].id, alreadyIn: true };

  const ref = await db.collection('playRequests').add({
    marketId: user.marketId,
    areas: (user as { areas?: string[] }).areas ?? [], // empty = anywhere
    userId: uid,
    displayName: user.displayName,
    index: user.handicap.index, // frozen at entry
    day,
    willingToBook: req.data.willingToBook !== false,
    status: 'open',
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + REQUEST_TTL_DAYS * 86_400_000),
  });
  return { requestId: ref.id, alreadyIn: false };
});

export const leaveDraw = onCall<{ day: string }>(async (req) => {
  const uid = requireAuth(req.auth);
  const open = await db
    .collection('playRequests')
    .where('userId', '==', uid)
    .where('day', '==', String(req.data.day).toLowerCase())
    .where('status', '==', 'open')
    .get();
  await Promise.all(open.docs.map((d) => d.ref.update({ status: 'withdrawn' })));
  return { ok: true };
});

function areasCompatible(group: { areas?: string[] }[]): boolean {
  // Empty list = plays anywhere. Otherwise every pair must share an area —
  // downtown and Blue Springs shouldn't get drawn together unless one of
  // them said "anywhere".
  const listed = group.filter((r) => (r.areas?.length ?? 0) > 0);
  if (listed.length < 2) return true;
  const shared = listed
    .map((r) => new Set(r.areas))
    .reduce((acc, s) => new Set([...acc].filter((a) => s.has(a))));
  return shared.size > 0;
}

interface Req {
  id: string;
  marketId: string;
  userId: string;
  displayName: string;
  index: number;
  day: string;
  willingToBook: boolean;
  areas?: string[];
  createdAt: Timestamp;
}

const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** End (23:59 CT ≈ 05:59 UTC next day) of the next occurrence of `day`. */
export function nextOccurrenceEnd(day: string, fromMs: number): number {
  const target = DAY_INDEX[day] ?? 6;
  const from = new Date(fromMs);
  const ahead = (target - from.getUTCDay() + 7) % 7 || 7; // today's draw → next week
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + ahead, 23, 59));
  return d.getTime() + 6 * 3_600_000; // shift to roughly end-of-day Central
}

/** Hourly: expire stale requests, then match what can be matched. */
export async function drawSweep(now: number) {
  const stale = await db
    .collection('playRequests')
    .where('status', '==', 'open')
    .where('expiresAt', '<=', Timestamp.fromMillis(now))
    .get();
  for (const d of stale.docs) {
    await d.ref.update({ status: 'expired' });
    // Silence is a product killer — tell them the entry lapsed and invite a
    // re-entry rather than letting the button quietly reset (§P1).
    const r = d.data() as { userId: string; day: string };
    await notify({
      userId: r.userId,
      title: 'Draw entry expired',
      body: `Nobody matched for ${r.day} this week — it happens early on. Tap to re-enter; new players join daily.`,
      link: '/',
    });
  }

  const openSnap = await db.collection('playRequests').where('status', '==', 'open').get();
  const open = openSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Req, 'id'>) }));

  // Bucket by market + day.
  const buckets = new Map<string, Req[]>();
  for (const r of open) {
    const key = `${r.marketId}|${r.day}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  // Blocks veto a grouping in either direction — being drawn with someone you
  // blocked would be worse than not being drawn at all. Results are memoized
  // per sweep since the same pair recurs across candidate windows.
  const blockCache = new Map<string, boolean>();
  async function pairBlocked(a: string, b: string): Promise<boolean> {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!blockCache.has(key)) {
      const [x, y] = await Promise.all([
        db.doc(`blocks/${a}_${b}`).get(),
        db.doc(`blocks/${b}_${a}`).get(),
      ]);
      blockCache.set(key, x.exists || y.exists);
    }
    return blockCache.get(key)!;
  }
  async function groupBlocked(group: Req[]): Promise<boolean> {
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        if (await pairBlocked(group[a].userId, group[b].userId)) return true;
      }
    }
    return false;
  }

  for (const [, reqs] of buckets) {
    // Sort by index so adjacent players are compatible; greedy windows of 4→3→2
    // with spread ≤ MAX_INDEX_SPREAD and at least one willing booker.
    reqs.sort((a, b) => a.index - b.index);
    let i = 0;
    while (i < reqs.length) {
      let group: Req[] | null = null;
      for (const size of [4, 3, 2]) {
        const candidate = reqs.slice(i, i + size);
        if (candidate.length < size) continue;
        const spread = candidate[candidate.length - 1].index - candidate[0].index;
        if (spread > MAX_INDEX_SPREAD) continue;
        if (!candidate.some((r) => r.willingToBook)) continue;
        if (!areasCompatible(candidate)) continue;
        if (await groupBlocked(candidate)) continue;
        group = candidate;
        break;
      }
      if (!group) {
        i += 1; // this player waits for more entrants
        continue;
      }
      await createDrawGroup(group, now);
      i += group.length;
    }
  }
}

async function createDrawGroup(group: Req[], now: number) {
  // Booker: earliest-entered willing booker — deterministic, named, on the hook.
  const booker = [...group]
    .filter((r) => r.willingToBook)
    .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())[0];
  const others = group.filter((r) => r.userId !== booker.userId);
  const dayLabel = group[0].day[0].toUpperCase() + group[0].day.slice(1);

  const postRef = await db.collection('roundPosts').add({
    marketId: group[0].marketId,
    createdBy: booker.userId,
    title: `${dayLabel} draw group`,
    description: `Drawn by The Draw. ${booker.displayName} books and confirms the tee time on this page.`,
    timing: { mode: 'flexible', fixedTime: null, windowStart: null, windowEnd: null, flexibleDays: [group[0].day] },
    // The concrete date this group is FOR — the lifecycle sweep uses it to
    // nudge the booker and to complete/expire the post (a flexible post would
    // otherwise never complete, killing the attestation funnel).
    targetDate: Timestamp.fromMillis(nextOccurrenceEnd(group[0].day, now)),
    course: { mode: 'flexible', placeId: null, preferredPlaceIds: null },
    booking: 'needsBooking',
    slotsTotal: group.length,
    slotsFilled: group.length,
    hosting: null,
    vibe: 'open',
    stakes: 'open',
    handicapPref: 'similar',
    handicapRange: [group[0].index, group[group.length - 1].index],
    format: 'justGolf',
    joinedUserIds: others.map((r) => r.userId),
    stakesAmount: null,
    stakesHandledByApp: false,
    drawMatched: true,
    status: 'full',
    createdAt: Timestamp.now(),
  });

  const batch = db.batch();
  for (const r of group) {
    batch.update(db.doc(`playRequests/${r.id}`), { status: 'matched', postId: postRef.id });
  }
  await batch.commit();

  const roster = group.map((r) => `${r.displayName} (${r.index.toFixed(1)})`).join(', ');
  for (const r of group) {
    const isBooker = r.userId === booker.userId;
    await notify({
      userId: r.userId,
      title: `You're drawn — ${dayLabel}`,
      body: isBooker
        ? `Your group: ${roster}. YOU book — grab a tee time, then hit "Confirm the tee time" on the post so everyone gets locked in.`
        : `Your group: ${roster}. ${booker.displayName} books; you'll get a text when the tee time is confirmed.`,
      deadlineCritical: true, // a formed group is time-sensitive — SMS it
      link: `/post/${postRef.id}`,
    });
  }
}
