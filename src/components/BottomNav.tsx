/** Thumb-reachable primary navigation (spec §8 mobile-first). */
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

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
              `flex-1 py-3 text-center font-display uppercase tracking-wide text-xs ${
                isActive ? 'text-tournament' : 'text-ink-faint'
              }`
            }
          >
            {it.label}
          </NavLink>
        ))}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
