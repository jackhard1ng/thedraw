/**
 * The masthead bell — the always-visible door to the inbox. The unread badge
 * is what makes "something happened to you" impossible to miss even when SMS
 * and push are unavailable.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useUnreadCount } from './useNotifications';

export function Bell() {
  const { fbUser } = useAuth();
  const unread = useUnreadCount(fbUser?.uid);
  return (
    <Link to="/inbox" aria-label={`Inbox${unread ? `, ${unread} unread` : ''}`} className="relative block p-1 text-ink">
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-tournament px-1 font-mono text-[0.6rem] font-semibold text-paper">
          {unread >= 25 ? '25+' : unread}
        </span>
      )}
    </Link>
  );
}
