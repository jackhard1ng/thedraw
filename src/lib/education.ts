/**
 * Contextual education (spec §5). Assume nobody has played competitively before.
 * Never a rules page — solve it contextually. The pre-match card is auto-
 * generated for every match and is the single highest-leverage retention
 * feature in Phase 2.
 */
import { matchStrokeHoles } from '@/lib/handicap';

export interface PreMatchCard {
  heading: string; // "Round of 16 · You vs. Kevin Doyle"
  indexes: string; // "You: 12.4   Kevin: 7.1"
  strokes: string; // "You get 5 strokes."
  strokeHoles: string | null; // where they fall, if the course card is known
  primer: string; // the match-play, quickly paragraph
}

// Keyed by the number of competitors STILL ALIVE entering the round. Two left
// is the Final; four is the Semifinal; sixteen is the Round of 16.
const ROUND_NAMES: Record<number, string> = {
  2: 'Final',
  4: 'Semifinal',
  8: 'Quarterfinal',
  16: 'Round of 16',
  32: 'Round of 32',
  64: 'Round of 64',
};

export function roundLabel(entriesRemaining: number): string {
  return ROUND_NAMES[entriesRemaining] ?? `Round of ${entriesRemaining}`;
}

/**
 * Build the pre-match card for a singles match. `holeHandicapOrder` is the
 * course stroke index (18 entries); pass null for a course whose card we haven't
 * entered yet and the stroke-hole line is omitted.
 */
export function preMatchCard(args: {
  entriesRemaining: number;
  youName: string;
  oppName: string;
  youIndex: number;
  oppIndex: number;
  courseName: string | null;
  holeHandicapOrder: number[] | null;
}): PreMatchCard {
  const {
    entriesRemaining,
    youName,
    oppName,
    youIndex,
    oppIndex,
    courseName,
    holeHandicapOrder,
  } = args;

  const youGets = youIndex >= oppIndex;
  const high = Math.max(youIndex, oppIndex);
  const low = Math.min(youIndex, oppIndex);
  const { strokes, holes } = matchStrokeHoles(high, low, holeHandicapOrder);

  const strokesLine =
    strokes === 0
      ? 'Scratch match — no strokes given.'
      : youGets
        ? `You get ${strokes} stroke${strokes === 1 ? '' : 's'}.`
        : `${oppName} gets ${strokes} stroke${strokes === 1 ? '' : 's'}.`;

  const strokeHoles =
    holes.length && courseName
      ? `At ${courseName} those fall on holes ${holes.join(', ')} — the ${
          holes.length
        } hardest on the card.`
      : null;

  return {
    heading: `${roundLabel(entriesRemaining)} · ${youName} vs. ${oppName}`,
    indexes: `You: ${youIndex.toFixed(1)}   ${oppName}: ${oppIndex.toFixed(1)}`,
    strokes: strokesLine,
    strokeHoles,
    primer:
      'Match play, quickly: hole by hole, not total score. Low score wins the ' +
      'hole, ties are halved. Pick up when you can’t win a hole. "3&2" = up ' +
      '3 with 2 to play, match over. All square after 18 → sudden death from #1.',
  };
}

/**
 * The stroke rule, stated in plain language for the registration page (§5 —
 * format explained BEFORE payment). One sentence, no jargon left undefined.
 */
export function strokesRule(format: {
  scoring: string;
  handicapAllowance: Record<string, number> | { type?: string; percent?: number; low?: number; high?: number } | null;
}): string {
  const a = format.handicapAllowance as
    | { type?: string; percent?: number; low?: number; high?: number }
    | null;
  if (format.scoring === 'matchPlay') {
    return 'Strokes: the difference between your two indexes, taken on the hardest holes on the card. Equal indexes = scratch match, no strokes.';
  }
  if (!a) {
    return 'No strokes — everyone plays straight up. Your gross score is your score.';
  }
  if (typeof a.percent === 'number') {
    return `Net event: you play off ${Math.round(a.percent * 100)}% of your course handicap at the designated course, frozen when the draw is made.`;
  }
  if (typeof a.low === 'number' && typeof a.high === 'number') {
    return `Team allowance: ${Math.round(a.low * 100)}% of the lower index plus ${Math.round(a.high * 100)}% of the higher — your team plays off the combined number.`;
  }
  return 'Stroke allocation is shown on your scorecard before the round.';
}

/** One-sentence glossary — tapping any term returns this inline. No manual (§5). */
export const GLOSSARY: Record<string, string> = {
  '3&2': 'You were 3 holes up with only 2 left to play, so the match ended early.',
  halved: 'The hole was tied — neither player wins it, and the match score is unchanged.',
  conceded: 'Your opponent gave you the hole or the putt; you pick up without finishing.',
  gross: 'Your raw score, before any handicap strokes are applied.',
  net: 'Your score after subtracting your handicap strokes.',
  'match play': 'A format scored hole by hole — win more holes than your opponent, not fewer total strokes.',
  'stroke play': 'A format scored by total strokes over the round — lowest total wins.',
  flight: 'A group of players with similar handicaps competing only against each other.',
  scramble: 'A team format where everyone hits, you pick the best shot, and all play from there.',
  index: 'Your handicap index — a portable measure of your ability, lower is better.',
};
