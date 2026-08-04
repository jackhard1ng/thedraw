/**
 * Organizer verification + rulings panel. Four authoritative actions, each a
 * callable (§5): verify a handicap source, set a Tour Index (never blended with
 * the claimed index — §5), rule a disputed match, and restrict/ban an account.
 * Disputed matches are listed by fanning out over the market's tournaments,
 * since `matches` carry no marketId.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Field, Num, SectionHeader } from '@/components/ui';
import {
  verifyHandicap,
  adjustTourIndex,
  resolveDispute,
  restrictUser,
} from '@/lib/callable';
import {
  entryDisplay,
  useTournaments,
  useTournamentEntries,
  useUsers,
} from '@/features/tournaments/useTournaments';
import type { HandicapSource, Match, UserStatus } from '@/types/models';

function ActionResult({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="mt-2 text-sm text-pine">{msg}</p>;
}

function DisputeCard({
  matchId,
  tournamentId,
  entryIds,
}: {
  matchId: string;
  tournamentId: string;
  entryIds: string[];
}) {
  const entries = useTournamentEntries(tournamentId);
  const two = (entries ?? []).filter((e) => entryIds.includes(e.id));
  const users = useUsers(two.flatMap((e) => e.userIds));
  const [winner, setWinner] = useState('');
  const [margin, setMargin] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Card className="p-3">
      <p className="text-xs text-ink-faint">Match {matchId.slice(0, 8)}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {two.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setWinner(e.id)}
            className={`btn ${winner === e.id ? 'bg-tournament text-paper' : 'border border-rule-strong text-ink'}`}
          >
            {entryDisplay(e, users).name}
          </button>
        ))}
      </div>
      <input
        className="field-input tnum mt-2"
        placeholder='Margin, e.g. "2&1"'
        value={margin}
        onChange={(e) => setMargin(e.target.value)}
      />
      <Button
        variant="primary"
        className="mt-2 w-full"
        disabled={busy || !winner || !margin}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await resolveDispute({ matchId, winnerEntryId: winner, margin: margin.trim() });
            setDone('Ruling recorded.');
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Rule this match
      </Button>
      <ActionResult msg={done} />
      {err && <p className="mt-2 text-sm text-tournament">{err}</p>}
    </Card>
  );
}

export function VerifyHandicapPanel() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const tournaments = useTournaments(marketId);

  // Verify handicap
  const [vUser, setVUser] = useState('');
  const [vSource, setVSource] = useState<HandicapSource>('ghin');
  const [vNote, setVNote] = useState('');
  const [vBusy, setVBusy] = useState(false);
  const [vMsg, setVMsg] = useState<string | null>(null);

  // Adjust Tour Index
  const [tUser, setTUser] = useState('');
  const [tIndex, setTIndex] = useState('');
  const [tNote, setTNote] = useState('');
  const [tBusy, setTBusy] = useState(false);
  const [tMsg, setTMsg] = useState<string | null>(null);

  // Restrict / ban
  const [rUser, setRUser] = useState('');
  const [rStatus, setRStatus] = useState<UserStatus>('restricted');
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState<string | null>(null);

  // Disputed matches
  const [disputes, setDisputes] = useState<
    { id: string; tournamentId: string; entryIds: string[] }[] | null
  >(null);
  const tKey = (tournaments ?? []).map((t) => t.id).sort().join(',');
  useEffect(() => {
    const idList = tKey ? tKey.split(',') : [];
    if (idList.length === 0) {
      setDisputes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const out: { id: string; tournamentId: string; entryIds: string[] }[] = [];
      for (let i = 0; i < idList.length; i += 30) {
        const snap = await getDocs(
          query(collection(db, 'matches'), where('tournamentId', 'in', idList.slice(i, i + 30))),
        );
        snap.docs.forEach((d) => {
          const m = d.data() as Match;
          if (m.result.disputed && m.status !== 'complete') {
            out.push({ id: d.id, tournamentId: m.tournamentId, entryIds: [...m.entryIds] });
          }
        });
      }
      if (!cancelled) setDisputes(out);
    })().catch(() => {
      if (!cancelled) setDisputes([]);
    });
    return () => {
      cancelled = true;
    };
  }, [tKey]);

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav('/organizer')} className="btn-quiet mb-4 px-0">
        ← Organizer
      </button>

      <SectionHeader>Verify handicap</SectionHeader>
      <div className="space-y-3">
        <Field label="User ID">
          <input className="field-input tnum" value={vUser} onChange={(e) => setVUser(e.target.value.trim())} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <select className="field-input" value={vSource} onChange={(e) => setVSource(e.target.value as HandicapSource)}>
              <option value="ghin">GHIN</option>
              <option value="thirdParty">Third party</option>
              <option value="self">Self</option>
            </select>
          </Field>
          <Field label="Note">
            <input className="field-input" value={vNote} onChange={(e) => setVNote(e.target.value)} />
          </Field>
        </div>
        <Button
          variant="primary"
          className="w-full"
          disabled={vBusy || !vUser}
          onClick={async () => {
            setVBusy(true);
            setVMsg(null);
            try {
              await verifyHandicap({ userId: vUser, source: vSource, note: vNote || undefined });
              setVMsg('Handicap verified.');
            } catch (e) {
              setVMsg((e as Error).message);
            } finally {
              setVBusy(false);
            }
          }}
        >
          Verify
        </Button>
        <ActionResult msg={vMsg} />
      </div>

      <div className="mt-8">
        <SectionHeader>Adjust Tour Index</SectionHeader>
        <p className="mb-2 text-xs text-ink-faint">
          A committee number shown alongside — never blended with — the claimed index (§5).
        </p>
        <div className="space-y-3">
          <Field label="User ID">
            <input className="field-input tnum" value={tUser} onChange={(e) => setTUser(e.target.value.trim())} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tour Index">
              <input type="number" step="0.1" className="field-input tnum" value={tIndex} onChange={(e) => setTIndex(e.target.value)} />
            </Field>
            <Field label="Note (required)">
              <input className="field-input" value={tNote} onChange={(e) => setTNote(e.target.value)} />
            </Field>
          </div>
          <Button
            variant="primary"
            className="w-full"
            disabled={tBusy || !tUser || tIndex === '' || !tNote.trim()}
            onClick={async () => {
              setTBusy(true);
              setTMsg(null);
              try {
                await adjustTourIndex({ userId: tUser, tourIndex: Number(tIndex), note: tNote.trim() });
                setTMsg('Tour Index set.');
              } catch (e) {
                setTMsg((e as Error).message);
              } finally {
                setTBusy(false);
              }
            }}
          >
            Set Tour Index
          </Button>
          <ActionResult msg={tMsg} />
        </div>
      </div>

      <div className="mt-8">
        <SectionHeader>Restrict / ban</SectionHeader>
        <div className="space-y-3">
          <Field label="User ID">
            <input className="field-input tnum" value={rUser} onChange={(e) => setRUser(e.target.value.trim())} />
          </Field>
          <Field label="Status">
            <select className="field-input" value={rStatus} onChange={(e) => setRStatus(e.target.value as UserStatus)}>
              <option value="active">Active (reinstate)</option>
              <option value="restricted">Restricted (free events only)</option>
              <option value="banned">Banned</option>
            </select>
          </Field>
          <Button
            variant="ghost"
            className="w-full"
            disabled={rBusy || !rUser}
            onClick={async () => {
              setRBusy(true);
              setRMsg(null);
              try {
                await restrictUser({ userId: rUser, status: rStatus });
                setRMsg(`Account set to ${rStatus}.`);
              } catch (e) {
                setRMsg((e as Error).message);
              } finally {
                setRBusy(false);
              }
            }}
          >
            Apply status
          </Button>
          <ActionResult msg={rMsg} />
        </div>
      </div>

      <div className="mt-8">
        <SectionHeader>
          Disputed matches{' '}
          {disputes && <Num className="text-tournament">{disputes.length}</Num>}
        </SectionHeader>
        {disputes === null ? (
          <p className="text-sm text-ink-faint">Loading…</p>
        ) : disputes.length === 0 ? (
          <p className="text-sm text-ink-faint">No disputes to rule.</p>
        ) : (
          <div className="space-y-3">
            {disputes.map((d) => (
              <DisputeCard
                key={d.id}
                matchId={d.id}
                tournamentId={d.tournamentId}
                entryIds={d.entryIds}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
