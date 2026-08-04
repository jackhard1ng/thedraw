/** Thumb-reachable primary navigation (spec §8 mobile-first). */
import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'Board', end: true },
  { to: '/rounds/new', label: 'Log', end: false },
  { to: '/me', label: 'Me', end: false },
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper-raised/95 backdrop-blur">
      <div className="mx-auto flex max-w-sheet">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `flex-1 py-3 text-center font-display uppercase tracking-wide text-sm ${
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
