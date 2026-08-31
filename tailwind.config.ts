import type { Config } from 'tailwindcss';

// Design system — spec §8, reskinned per addendum feedback: March-Madness-style
// championship blue. The reference is still the printed draw sheet, but now the
// bracket poster: cool white sheet, navy ink, a single championship blue for
// advancement/wins/live state, and an orange ball-dot as the energy accent.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base: cool bracket-sheet white
        paper: {
          DEFAULT: '#F4F6FA',
          raised: '#FBFCFE',
          sunken: '#E9EDF4',
        },
        // Ink: navy-black, high contrast
        ink: {
          DEFAULT: '#0E1A2B',
          soft: '#3A4A61',
          faint: '#69788F',
        },
        // Rule lines: cool gray-blue — bracket rails, table dividers
        rule: {
          DEFAULT: '#CBD5E3',
          strong: '#AFBDD1',
        },
        // Accent: championship blue for advancement, wins, and live state
        tournament: {
          DEFAULT: '#0A46C2',
          soft: '#2E66DE',
        },
        // Retired accent (was the orange ball); the mark's ball is white now.
        ball: '#FFFFFF',
        // Support: slate steel, secondary only (replaces pine)
        pine: {
          DEFAULT: '#33567A',
          soft: '#4F729A',
        },
        // Semantic: verification freshness badges
        fresh: '#1F7A4D', // green   — under 30 days
        stale: '#B8860B', // amber   — 30-90 days
        expired: '#69788F', // gray  — beyond 90 / self-declared
      },
      fontFamily: {
        // Headers: condensed sans, uppercase — bracket poster energy
        display: ['"Barlow Semi Condensed"', 'Oswald', 'Arial Narrow', 'sans-serif'],
        // Body: clean humanist sans
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // Numerals: monospaced with tabular figures — non-negotiable (§8)
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
      maxWidth: {
        sheet: '48rem',
      },
    },
  },
} satisfies Config;
