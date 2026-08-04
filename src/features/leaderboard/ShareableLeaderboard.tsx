/**
 * A shareable leaderboard card — the same printed sheet, rendered as a
 * self-contained inline <svg> so it can be serialized to a PNG and shared. The
 * app mark reuses the curve-and-flag motif from public/icon.svg. "Download image"
 * serializes the SVG, rasterizes it through a canvas, and triggers a download —
 * no external libraries, no network.
 */
import { useRef } from 'react';
import { Button, Spinner } from '@/components/ui';
import { useLeaderboard } from './useLeaderboard';

const PAPER = '#F7F4EE';
const INK = '#1A1815';
const INK_FAINT = '#78726A';
const RULE = '#D9D3C7';
const RED = '#9B2226';

export function ShareableLeaderboard({ tournamentId }: { tournamentId: string }) {
  const { ready, tournament, gross } = useLeaderboard(tournamentId);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!ready || !tournament) return <Spinner />;

  const rows = gross.slice(0, 8);
  const W = 640;
  const top = 128;
  const rowH = 46;
  const H = top + rows.length * rowH + 56;

  function download() {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const img = new Image();
    img.onload = () => {
      const scale = 2; // retina
      const canvas = document.createElement('canvas');
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tournament!.name.replace(/\s+/g, '-').toLowerCase()}-leaderboard.png`;
      a.click();
    };
    img.src = svg64;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          style={{ maxWidth: '100%', height: 'auto', border: `1px solid ${RULE}` }}
        >
          <rect width={W} height={H} fill={PAPER} />

          {/* App mark — the curve + flag from icon.svg */}
          <g transform="translate(28,28) scale(0.13)">
            <path
              d="M112 112 H240 Q352 112 352 256 Q352 400 240 400 H112"
              fill="none"
              stroke={INK}
              strokeWidth={28}
              strokeLinecap="square"
            />
            <line x1={352} y1={256} x2={432} y2={256} stroke={RED} strokeWidth={28} />
            <circle cx={432} cy={256} r={26} fill={RED} />
          </g>

          <text
            x={92}
            y={44}
            fill={INK_FAINT}
            fontFamily="Barlow Semi Condensed, Arial Narrow, sans-serif"
            fontSize={14}
            letterSpacing={3}
          >
            THE DRAW
          </text>
          <text
            x={92}
            y={70}
            fill={INK}
            fontFamily="Barlow Semi Condensed, Arial Narrow, sans-serif"
            fontSize={28}
            fontWeight={700}
          >
            {tournament.name.toUpperCase().slice(0, 34)}
          </text>

          <line x1={28} y1={100} x2={W - 28} y2={100} stroke={INK} strokeWidth={2} />

          {/* Column header */}
          <text x={28} y={122} fill={INK_FAINT} fontFamily="Barlow Semi Condensed, sans-serif" fontSize={13} letterSpacing={2}>
            POS
          </text>
          <text x={92} y={122} fill={INK_FAINT} fontFamily="Barlow Semi Condensed, sans-serif" fontSize={13} letterSpacing={2}>
            PLAYER
          </text>
          <text x={W - 28} y={122} textAnchor="end" fill={INK_FAINT} fontFamily="Barlow Semi Condensed, sans-serif" fontSize={13} letterSpacing={2}>
            TOTAL
          </text>

          {rows.map((r, i) => {
            const y = top + i * rowH;
            const leader = r.position === '1';
            return (
              <g key={r.entryId}>
                <line x1={28} y1={y - 10} x2={W - 28} y2={y - 10} stroke={RULE} strokeWidth={1} />
                <text x={28} y={y + 16} fill={INK} fontFamily="Roboto Mono, monospace" fontSize={18}>
                  {r.position}
                </text>
                <text
                  x={92}
                  y={y + 16}
                  fill={INK}
                  fontFamily="Inter, sans-serif"
                  fontSize={18}
                  fontWeight={leader ? 700 : 400}
                >
                  {r.name.slice(0, 30)}
                </text>
                <text
                  x={W - 28}
                  y={y + 16}
                  textAnchor="end"
                  fill={leader ? RED : INK}
                  fontFamily="Roboto Mono, monospace"
                  fontSize={18}
                  fontWeight={leader ? 700 : 400}
                >
                  {r.totalLabel}
                </text>
              </g>
            );
          })}

          <line x1={28} y1={H - 40} x2={W - 28} y2={H - 40} stroke={INK} strokeWidth={2} />
          <text x={28} y={H - 18} fill={INK_FAINT} fontFamily="Inter, sans-serif" fontSize={12}>
            Gross · scores to par
          </text>
        </svg>
      </div>
      <div className="mt-3">
        <Button variant="ghost" onClick={download}>
          Download image
        </Button>
      </div>
    </div>
  );
}
