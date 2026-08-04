import type { Config } from 'tailwindcss';

// Design system — spec §8. The reference is the draw sheet posted outside the
// pro shop before a championship: ink on warm paper, ruled lines, tabular figures.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base: bone / warm paper white
        paper: {
          DEFAULT: '#F7F4EE',
          raised: '#FCFAF5',
          sunken: '#EFEBE1',
        },
        // Ink: near-black with a warm cast, high contrast
        ink: {
          DEFAULT: '#1A1815',
          soft: '#4A4640',
          faint: '#78726A',
        },
        // Rule lines: light warm gray — the structural motif
        rule: {
          DEFAULT: '#D9D3C7',
          strong: '#C3BCAD',
        },
        // Accent: a single deep tournament red for advancement, wins, live state
        tournament: {
          DEFAULT: '#9B2226',
          soft: '#B84044',
        },
        // Support: desaturated pine green, secondary only
        pine: {
          DEFAULT: '#3E5C4B',
          soft: '#5A7A67',
        },
        // Semantic: verification freshness badges
        fresh: '#3E7A4E', // green   — under 30 days
        stale: '#B8860B', // amber   — 30-90 days
        expired: '#78726A', // gray  — beyond 90 / self-declared
      },
      fontFamily: {
        // Headers: condensed sans, uppercase — draw sheet / scoreboard energy
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
  plugins: [],
} satisfies Config;
