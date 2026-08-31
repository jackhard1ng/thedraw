/**
 * Report / block controls (spec §5 Safety — required in Phase 1, not deferrable).
 * A product where strangers meet in a parking lot at 7am needs these on day one.
 * Both route through Cloud Functions: blocks are enforced server-side on join,
 * and report volume surfaces to the organizer proactively.
 */
import { useState } from 'react';
import { blockUser, submitReport } from '@/lib/callable';
import type { ReportTargetType } from '@/types/models';

export function ReportBlockMenu({
  targetType,
  targetId,
  subjectUserId,
  subjectName,
}: {
  targetType: ReportTargetType;
  targetId: string;
  subjectUserId?: string; // the person to block, if applicable
  subjectName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function report() {
    const reason = window.prompt(
      `Report ${subjectName ?? 'this'} to the organizer. What's wrong?`,
    );
    if (!reason) return;
    await submitReport({ targetType, targetId, reason });
    setDone('Reported. The organizer will review.');
    setOpen(false);
  }

  async function block() {
    if (!subjectUserId) return;
    if (!window.confirm(`Block ${subjectName ?? 'this player'}? Their posts hide from you and they can't join yours.`))
      return;
    await blockUser({ blockedId: subjectUserId });
    setDone('Blocked.');
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        className="px-2 text-ink-faint hover:text-ink"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-sm border border-rule-strong bg-paper-raised p-1 shadow-lg">
          <button
            type="button"
            onClick={report}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-paper-sunken"
          >
            Report
          </button>
          {subjectUserId && (
            <button
              type="button"
              onClick={block}
              className="block w-full px-3 py-2 text-left text-sm text-tournament hover:bg-paper-sunken"
            >
              Block player
            </button>
          )}
        </div>
      )}
      {done && (
        <p className="absolute right-0 mt-1 whitespace-nowrap text-xs text-pine">{done}</p>
      )}
    </div>
  );
}
