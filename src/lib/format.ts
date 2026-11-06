/**
 * Small display formatters. Timestamps are stored UTC (§3) and displayed in the
 * market timezone. Everything numeric renders monospace/tabular in the UI (§8).
 */
import type { Ts } from '@/types/models';

const DAY = 86_400_000;

export function toDate(ts: Ts | Date | null | undefined): Date | null {
  if (!ts) return null;
  return ts instanceof Date ? ts : ts.toDate();
}

/** "Sat Aug 22 · 8:10 AM" in the given market timezone. */
export function formatTeeTime(ts: Ts | Date | null, timeZone = 'America/Chicago'): string {
  const d = toDate(ts);
  if (!d) return 'TBD';
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(d);
  return `${date} · ${time}`;
}

/** Relative "in 3 days" / "2 days ago" for deadlines and post ages. */
export function relativeDays(ts: Ts | Date | null, now = Date.now()): string {
  const d = toDate(ts);
  if (!d) return '';
  const diff = Math.round((d.getTime() - now) / DAY);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

/** A score relative to par, the way every broadcast leaderboard shows it (§5). */
export function toPar(strokes: number, par: number): string {
  const rel = strokes - par;
  if (rel === 0) return 'E';
  return rel > 0 ? `+${rel}` : `${rel}`;
}

/** Differential to index — the leaderboard's most interesting number (§4). */
export function differential(strokes: number, courseHandicap: number, par: number): string {
  const net = strokes - courseHandicap - par;
  const val = net.toFixed(1);
  return net > 0 ? `+${val}` : val;
}
