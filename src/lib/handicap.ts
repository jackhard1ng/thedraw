/**
 * Handicap helpers — spec §4/§5.
 *
 * We are NOT a handicap authority (§9). We accept external indexes and compute
 * only a Course Handicap for net play, plus the freshness signal that defuses
 * cheater accusations socially (§5 "Handicap verification").
 */
import type { Course, Handicap, HandicapSource, Ts } from '@/types/models';

export type Freshness = 'fresh' | 'stale' | 'expired';

/** Green under 30 days, amber 30-90, gray beyond (§5). */
export function freshness(verifiedAt: Ts | null, now = Date.now()): Freshness {
  if (!verifiedAt) return 'expired';
  const days = (now - verifiedAt.toMillis()) / 86_400_000;
  if (days < 30) return 'fresh';
  if (days <= 90) return 'stale';
  return 'expired';
}

export interface SourceBadge {
  label: string;
  tone: 'fresh' | 'stale' | 'expired';
}

/**
 * The badge shown beside a handicap. A claimed source alone earns nothing — the
 * green/yellow badge appears only once an organizer has set `verifiedAt` (§5).
 * An unverified GHIN/third-party claim reads as "pending" in gray, never as
 * "verified". `handicap` may be passed as just its source for the self case.
 */
export function sourceBadge(
  handicap: HandicapSource | Pick<Handicap, 'source' | 'verifiedAt'>,
): SourceBadge {
  const source = typeof handicap === 'string' ? handicap : handicap.source;
  const verifiedAt = typeof handicap === 'string' ? null : handicap.verifiedAt;

  if (source === 'self') return { label: 'Self-declared', tone: 'expired' };
  if (!verifiedAt) {
    return {
      label: source === 'ghin' ? 'GHIN — pending' : 'Link — pending',
      tone: 'expired',
    };
  }
  return source === 'ghin'
    ? { label: 'GHIN verified', tone: 'fresh' }
    : { label: 'Linked', tone: 'stale' };
}

/**
 * Course Handicap for net play (§4 dependency):
 *   Index × Slope/113 + (Rating − Par)
 * Requires a supported course with full tee-set data — net stroke play cannot
 * run without it. Returns null when the tee data is missing.
 */
export function courseHandicap(
  index: number,
  tee: { slope: number; rating: number; par: number } | null,
): number | null {
  if (!tee) return null;
  return Math.round(index * (tee.slope / 113) + (tee.rating - tee.par));
}

/**
 * Strokes given in a singles match = the difference of the two indexes,
 * allocated to the hardest holes off the scorecard's stroke index. Match play
 * needs no rating/slope — only the hole handicap order (§4).
 */
export function matchStrokeHoles(
  higherIndex: number,
  lowerIndex: number,
  holeHandicapOrder: number[] | null,
): { strokes: number; holes: number[] } {
  const strokes = Math.max(0, Math.round(higherIndex - lowerIndex));
  if (!holeHandicapOrder || holeHandicapOrder.length !== 18) {
    return { strokes, holes: [] };
  }
  // holeHandicapOrder[i] is the stroke index (1 = hardest) for hole i+1.
  const ranked = holeHandicapOrder
    .map((si, i) => ({ hole: i + 1, si }))
    .sort((a, b) => a.si - b.si);
  const holes = ranked.slice(0, strokes).map((h) => h.hole).sort((a, b) => a - b);
  return { strokes, holes };
}

/** Whether this course can host a net event at all (§4). */
export function canHostNet(course: Pick<Course, 'tier' | 'teeSets'>): boolean {
  return course.tier === 'supported' && !!course.teeSets?.length;
}

/** "Index 12.4 (GHIN) · Tour Index 10" — display both, never blend (§5). */
export function indexLine(handicap: Handicap, tourIndex?: number | null): string {
  const src =
    handicap.source === 'ghin'
      ? 'GHIN'
      : handicap.source === 'thirdParty'
        ? 'Linked'
        : 'Self';
  const base = `Index ${handicap.index.toFixed(1)} (${src})`;
  return tourIndex != null ? `${base} · Tour Index ${tourIndex}` : base;
}
