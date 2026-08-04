/**
 * UI primitives — the printed-sheet vocabulary from spec §8.
 * Typographic rather than decorative: rules, aligned columns, tabular figures.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet';
}) {
  const cls =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'btn-ghost'
        : 'btn-quiet';
  return <button className={`${cls} ${className}`} {...props} />;
}

/** A number rendered the one correct way: monospace, tabular, right-alignable. */
export function Num({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`tnum ${className}`}>{children}</span>;
}

/** A ruled divider — the draw-sheet rail. */
export function Rule({ className = '' }: { className?: string }) {
  return <hr className={`sheet-rule ${className}`} />;
}

export type BadgeTone = 'fresh' | 'stale' | 'expired' | 'tournament' | 'neutral';

/** Verification and status badges. Shown as a fact, never a star rating (§4). */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const map: Record<BadgeTone, string> = {
    fresh: 'bg-fresh/10 text-fresh border-fresh/30',
    stale: 'bg-stale/10 text-stale border-stale/40',
    expired: 'bg-ink-faint/10 text-ink-faint border-ink-faint/30',
    tournament: 'bg-tournament/10 text-tournament border-tournament/30',
    neutral: 'bg-paper-sunken text-ink-soft border-rule',
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-display uppercase tracking-wide ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/** A bordered card that reads like a cell on the draw sheet. */
export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-sm border border-rule bg-paper-raised ${
        onClick ? 'cursor-pointer hover:border-rule-strong' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function SectionHeader({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-ink pb-1 mb-3">
      <h2 className="text-lg">{children}</h2>
      {right}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10 text-ink-faint">
      <span className="font-display uppercase tracking-widest text-sm animate-pulse">
        Loading…
      </span>
    </div>
  );
}

/** Contextual glossary term — tap for a one-sentence definition, no manual (§5). */
export function Term({ word, def }: { word: string; def: string }) {
  return (
    <button
      type="button"
      title={def}
      onClick={() => alert(def)}
      className="underline decoration-dotted decoration-tournament underline-offset-2"
    >
      {word}
    </button>
  );
}
