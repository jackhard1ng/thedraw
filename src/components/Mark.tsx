/**
 * The mark (spec §8): the bracket rail and the draw-flight ball path are the
 * same curve — one shape, both meanings. Championship blue rail, orange ball.
 */
export function Mark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        d="M14 14 H30 Q44 14 44 32 Q44 50 30 50 H14"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="square"
      />
      <line x1="44" y1="32" x2="55" y2="32" stroke="#0A46C2" strokeWidth="4" />
      <circle cx="55" cy="32" r="4" fill="#E8720C" />
    </svg>
  );
}

/** The slim draw-sheet masthead shown at the top of every signed-in page. */
export function Masthead({ marketName }: { marketName: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-sheet items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2 text-ink">
          <Mark className="h-6 w-6" />
          <span className="font-display uppercase tracking-[0.2em] text-sm">
            The Draw
          </span>
        </div>
        <span className="font-display uppercase tracking-widest text-xs text-ink-faint">
          {marketName}
        </span>
      </div>
    </header>
  );
}
