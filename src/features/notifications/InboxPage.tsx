/**
 * The inbox — where every notification can be caught up on, whatever happened
 * to SMS or push. Tapping a row marks it read and follows its link; unread rows
 * carry the blue spine.
 */
import { useNavigate } from 'react-router-dom';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Spinner } from '@/components/ui';
import { relativeDays } from '@/lib/format';
import { useNotifications } from './useNotifications';

export function InboxPage() {
  const { fbUser } = useAuth();
  const nav = useNavigate();
  const items = useNotifications(fbUser?.uid);

  if (items === null) return <Spinner />;

  const unread = items.filter((n) => !n.read);

  async function markAllRead() {
    const batch = writeBatch(db);
    for (const n of unread) batch.update(doc(db, 'notifications', n.id), { read: true });
    await batch.commit();
  }

  async function open(id: string, link: string | null, read: boolean) {
    if (!read) {
      // Fire-and-forget — navigation shouldn't wait on the write.
      updateDoc(doc(db, 'notifications', id), { read: true }).catch(() => undefined);
    }
    if (link) nav(link);
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl">Inbox</h1>
        {unread.length > 0 && (
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-sm border border-dashed border-rule-strong p-8 text-center">
          <p className="font-display uppercase tracking-wide text-ink-soft">
            Nothing yet
          </p>
          <p className="mt-1 text-sm text-ink-faint">
            Draws, deadlines, results, and payouts all land here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-rule">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n.id, n.link, n.read)}
              className={`block w-full py-3 text-left ${n.link ? '' : 'cursor-default'}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    n.read ? 'bg-transparent' : 'bg-tournament'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate text-sm ${n.read ? 'text-ink-soft' : 'text-ink'}`}>
                      {n.title}
                    </p>
                    <span className="shrink-0 text-xs text-ink-faint">
                      {n.createdAt ? relativeDays(n.createdAt) : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-faint">{n.body}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
