/**
 * A one-line push nudge shown at the moments notifications actually matter —
 * right after entering the draw or joining a round — instead of buried on the
 * profile page. Dismissal is remembered; an enabled device never sees it.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { pushSupported } from '@/lib/push';

const DISMISS_KEY = 'thedraw.pushNudgeDismissed';

export function PushNudge({ context }: { context: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (localStorage.getItem(DISMISS_KEY)) return;
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return;
      if (!(await pushSupported())) return;
      if (mounted) setShow(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-sm border border-tournament/30 bg-paper-sunken p-3">
      <p className="text-xs text-ink-soft">{context}</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="primary"
          className="px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { enablePush } = await import('@/lib/push');
            const result = await enablePush();
            setBusy(false);
            if (result === 'enabled') setShow(false);
          }}
        >
          {busy ? '…' : 'Turn on'}
        </Button>
        <button
          className="text-xs text-ink-faint underline"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, '1');
            setShow(false);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
