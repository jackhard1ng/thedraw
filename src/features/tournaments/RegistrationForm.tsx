/**
 * Registration inputs. For team formats (teamSize > 1 on the format doc) we
 * collect a partner via NAME SEARCH — nobody knows a userId — plus an optional
 * team name. The money reality is stated where it applies: the captain pays
 * the full team entry; prizes pay each member their half individually.
 */
import { useEffect, useRef, useState } from 'react';
import { formatIndex } from '@/lib/handicap';
import { Field, Num, Spinner } from '@/components/ui';
import { searchPlayers } from '@/lib/callable';

export interface RegistrationValue {
  partnerId: string;
  teamName: string;
}

interface Hit {
  uid: string;
  displayName: string;
  index: number;
  verified: boolean;
}

export function RegistrationForm({
  teamSize,
  value,
  onChange,
}: {
  teamSize: number;
  value: RegistrationValue;
  onChange: (v: RegistrationValue) => void;
}) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (picked || text.trim().length < 2) {
      setHits([]);
      return;
    }
    clearTimeout(timer.current);
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await searchPlayers({ query: text.trim() });
        setHits(res.data.results);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [text, picked]);

  if (teamSize <= 1) {
    return (
      <p className="text-sm text-ink-soft">
        Singles event — you enter as yourself. No partner needed.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Field
        label="Partner"
        hint={picked ? undefined : 'Search by name — they need an account in your market.'}
      >
        {picked ? (
          <div className="flex items-center justify-between rounded-sm border border-pine/40 bg-pine/10 p-3 text-sm">
            <span className="text-ink">
              {picked.displayName} <Num className="text-ink-faint">({formatIndex(picked.index)})</Num>
              {picked.verified && <span className="ml-1 text-xs text-pine">verified</span>}
            </span>
            <button
              className="text-xs text-tournament underline"
              onClick={() => {
                setPicked(null);
                onChange({ ...value, partnerId: '' });
              }}
            >
              change
            </button>
          </div>
        ) : (
          <>
            <input
              className="field-input"
              placeholder="Start typing their name…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {searching && (
              <div className="mt-2">
                <Spinner />
              </div>
            )}
            {hits.length > 0 && (
              <div className="mt-1 divide-y divide-rule rounded-sm border border-rule-strong bg-paper-raised">
                {hits.map((h) => (
                  <button
                    key={h.uid}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper-sunken"
                    onClick={() => {
                      setPicked(h);
                      onChange({ ...value, partnerId: h.uid });
                    }}
                  >
                    <span className="text-ink">{h.displayName}</span>
                    <Num className="text-ink-faint">{formatIndex(h.index)}</Num>
                  </button>
                ))}
              </div>
            )}
            {!searching && text.trim().length >= 2 && hits.length === 0 && (
              <p className="mt-1 text-xs text-ink-faint">
                No match — they may need to sign up first, or paste their Player
                ID (on their profile):
              </p>
            )}
            {!searching && text.trim().length >= 2 && hits.length === 0 && (
              <input
                className="field-input tnum mt-1"
                placeholder="Player ID"
                value={value.partnerId}
                onChange={(e) => onChange({ ...value, partnerId: e.target.value.trim() })}
              />
            )}
          </>
        )}
      </Field>
      <Field label="Team name" hint="Optional. Shown on the bracket and leaderboard.">
        <input
          className="field-input"
          placeholder="e.g. Front Nine Bandits"
          value={value.teamName}
          onChange={(e) => onChange({ ...value, teamName: e.target.value })}
        />
      </Field>
      <p className="rounded-sm border border-rule bg-paper-sunken p-3 text-xs text-ink-soft">
        You pay the full team entry on your card; if you win, the prize pays
        each of you your share individually — no settling up afterward.
      </p>
    </div>
  );
}
