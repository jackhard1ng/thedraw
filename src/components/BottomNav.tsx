/**
 * Thumb-reachable primary navigation (spec §8 mobile-first). Icon + label per
 * tab — stroke icons drawn to match the mark's line weight, active tab in
 * championship blue with a top indicator bar.
 */
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

function Icon({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mx-auto mb-0.5 h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
      {extra}
    </svg>
  );
}

// Board: a pinned sheet. Compete: a bracket. Results: a flag. Merit: a podium.
// Me: a player. Organize: a whistle-ish clipboard.
const ICONS: Record<string, React.ReactNode> = {
  '/': <Icon d="M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5" />,
  '/tournaments': (
    <Icon d="M4 5h5v5H4z M4 14h5v5H4z M9 7.5h4v9h-4 M13 12h4" extra={<circle cx="19.5" cy="12" r="1.6" fill="currentColor" stroke="none" />} />
  ),
  '/results': <Icon d="M6 21V4 M6 4c4-2 8 2 12 0v9c-4 2-8-2-12 0" />,
  '/standings': <Icon d="M3 20h5v-7H3z M9.5 20h5V8h-5z M16 20h5v-4h-5z" />,
  '/me': <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />,
  '/organizer': <Icon d="M8 3h8v4H8z M5 7h14v14H5z M9 13h6 M9 17h4" />,
};

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const BASE: NavItem[] = [
  { to: '/', label: 'Board', end: true },
  { to: '/tournaments', label: 'Compete' },
  { to: '/results', label: 'Results' },
  { to: '/standings', label: 'Merit' },
  { to: '/me', label: 'Me' },
];

export function BottomNav() {
  const { profile } = useAuth();
  const items = [...BASE];
  // Organizers and admins get a console entry (§5 Roles).
  if (profile && profile.role !== 'member') {
    items.splice(4, 0, { to: '/organizer', label: 'Organize' });
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper-raised/95 backdrop-blur">
      <div className="mx-auto flex max-w-sheet">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `relative flex-1 py-2 text-center font-display uppercase tracking-wide text-[0.65rem] transition-colors ${
                isActive ? 'text-tournament' : 'text-ink-faint hover:text-ink-soft'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-tournament" />
                )}
                {ICONS[it.to]}
                {it.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
