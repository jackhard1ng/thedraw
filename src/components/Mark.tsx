/**
 * The mark: a capital D drawn as a tournament bracket — seeds on the spine,
 * rounds converging rightward — with a white golf ball sitting in the
 * champion's slot, completing the letter. Chosen by Jack from designed
 * candidates; two colors only (championship blue + white ball).
 */
export function Mark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true">
      <g stroke="#0A46C2" strokeWidth="8" strokeLinecap="square">
        <path d="M24 14 V86" />
        <path d="M24 14 H50 Q74 14 76 38" />
        <path d="M24 86 H50 Q74 86 76 62" />
        <path d="M24 36 H44" />
        <path d="M24 64 H44" />
        <path d="M44 36 V50 H58" />
        <path d="M44 64 V50" />
      </g>
      <circle cx="76" cy="50" r="11" fill="#FFFFFF" stroke="#0A46C2" strokeWidth="4.5" />
      <circle cx="72.5" cy="46.5" r="1.5" fill="#0A46C2" />
      <circle cx="78.5" cy="48" r="1.5" fill="#0A46C2" />
      <circle cx="73.5" cy="52.5" r="1.5" fill="#0A46C2" />
      <circle cx="79" cy="54" r="1.5" fill="#0A46C2" />
    </svg>
  );
}

/** The slim draw-sheet masthead shown at the top of every signed-in page. */
export function Masthead({
  marketName,
  right,
}: {
  marketName: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-sheet items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2 text-ink">
          <Mark className="h-6 w-6" />
          <span className="font-display uppercase tracking-[0.2em] text-sm">
            The Draw
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-display uppercase tracking-widest text-xs text-ink-faint">
            {marketName}
          </span>
          {right}
        </div>
      </div>
    </header>
  );
}
