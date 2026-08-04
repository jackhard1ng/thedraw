/**
 * Registration inputs. For team formats (teamSize > 1 on the format doc) we
 * collect a partner and an optional team name before entering; for singles there
 * is nothing to collect and the form renders a single confirmation line. The
 * partner is identified by userId here — a partner picker/search is a later
 * refinement; the Cloud Function validates the partnership either way.
 */
import { Field } from '@/components/ui';

export interface RegistrationValue {
  partnerId: string;
  teamName: string;
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
        hint="Your partner's user ID. They must also be eligible."
      >
        <input
          className="field-input tnum"
          placeholder="user id"
          value={value.partnerId}
          onChange={(e) => onChange({ ...value, partnerId: e.target.value.trim() })}
        />
      </Field>
      <Field label="Team name" hint="Optional. Shown on the bracket and leaderboard.">
        <input
          className="field-input"
          placeholder="e.g. Front Nine Bandits"
          value={value.teamName}
          onChange={(e) => onChange({ ...value, teamName: e.target.value })}
        />
      </Field>
    </div>
  );
}
