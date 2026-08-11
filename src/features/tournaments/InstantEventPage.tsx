/**
 * Instant events (addendum §2) — "start a Sunday game" in under a minute.
 * A member picks a pre-approved template, sets course/date/fee within the
 * template's bounds, chooses a payout shape from its allowed list, and the
 * event is live immediately: published purse, itemized 10% fee, real tournament.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button, Card, Field, Num, SectionHeader } from '@/components/ui';
import { dollarsToCents, formatCents, itemizeEntry, splitPurse } from '@/lib/money';
import { createInstantEvent } from '@/lib/callable';
import { PlacesAutocomplete, type CoursePick } from '@/features/courses/PlacesAutocomplete';

interface Template {
  id: string;
  name: string;
  formatId: string;
  fieldSize: number;
  fieldSizeMin?: number; // runs at this many; caps at fieldSize
  indexRange?: [number, number] | null;
  entryFeeMinCents: number;
  entryFeeMaxCents: number;
  allowedPayoutShapes: string[];
  adminFeePercent: number;
  netCapable?: boolean;
  active: boolean;
}

const SHAPE_LABEL: Record<string, { label: string; shares: number[] }> = {
  winnerTakeAll: { label: 'Winner take all', shares: [100] },
  '70_30': { label: '70 / 30', shares: [70, 30] },
  '60_30_10': { label: '60 / 30 / 10', shares: [60, 30, 10] },
};

export function InstantEventPage() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [course, setCourse] = useState<CoursePick | null>(null);
  const [startsAt, setStartsAt] = useState('');
  const [fee, setFee] = useState('');
  const [shape, setShape] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketId = profile?.marketId ?? 'kc';
  useEffect(() => {
    const q = query(
      collection(db, 'eventTemplates'),
      where('marketId', '==', marketId),
      where('active', '==', true),
    );
    return onSnapshot(
      q,
      (snap) => setTemplates(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Template, 'id'>) }))),
      () => setTemplates([]),
    );
  }, [marketId]);

  // A free template (min = max = $0) needs no fee input at all.
  const isFreeTemplate = !!tpl && tpl.entryFeeMaxCents === 0;
  let feeCents = 0;
  let feeError: string | null = null;
  if (tpl && fee && !isFreeTemplate) {
    try {
      feeCents = dollarsToCents(fee);
      if (feeCents < tpl.entryFeeMinCents || feeCents > tpl.entryFeeMaxCents) {
        feeError = `Between ${formatCents(tpl.entryFeeMinCents)} and ${formatCents(tpl.entryFeeMaxCents)}.`;
      }
    } catch {
      feeError = 'Enter a dollar amount.';
    }
  }

  const valid =
    !!tpl && !!startsAt && !feeError && !!shape && (isFreeTemplate || feeCents > 0);
  const item = tpl && feeCents ? itemizeEntry(feeCents, tpl.adminFeePercent) : null;
  // Mirror the server's pool math including the $10 event minimum — the
  // preview must never show a bigger purse than completion will pay.
  const rawPool = item && tpl ? item.prizeCents * tpl.fieldSize : 0;
  const floorShortfall =
    item && tpl && tpl.adminFeePercent > 0
      ? Math.max(0, 1000 - item.adminCents * tpl.fieldSize)
      : 0;
  const pool = Math.max(0, rawPool - floorShortfall);
  const shapeShares = shape ? SHAPE_LABEL[shape]?.shares ?? [] : [];
  const prizes = pool && shapeShares.length ? splitPurse(pool, shapeShares) : [];

  async function submit() {
    if (!tpl || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createInstantEvent({
        templateId: tpl.id,
        placeId: course?.placeId ?? null,
        startsAt: new Date(startsAt).getTime(),
        entryFeeCents: feeCents,
        payoutShape: shape,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      nav(`/tournaments/${res.data.tournamentId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <SectionHeader>Start a game</SectionHeader>
      <p className="mb-5 text-sm text-ink-soft">
        Pick a template, set the details, and it's live — a real tournament with a
        published purse and an itemized fee. You can play in it.
      </p>

      {/* 1. Template */}
      <div className="space-y-2">
        {templates === null && <p className="text-sm text-ink-faint">Loading templates…</p>}
        {templates?.map((t) => (
          <Card
            key={t.id}
            onClick={() => {
              setTpl(t);
              setShape(t.allowedPayoutShapes[0] ?? '');
            }}
            className={`p-3 ${tpl?.id === t.id ? 'border-tournament ring-1 ring-tournament' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display uppercase tracking-wide">{t.name}</span>
              <span className="text-xs text-ink-faint">
                <Num>{t.fieldSize}</Num>{' '}
                {t.formatId.toLowerCase().includes('scramble') ? 'teams' : 'players'}
                {t.adminFeePercent > 0 ? <> · {t.adminFeePercent}% fee</> : <> · free</>}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              Entry {formatCents(t.entryFeeMinCents)}–{formatCents(t.entryFeeMaxCents)}
            </p>
          </Card>
        ))}
        {templates?.length === 0 && (
          <p className="text-sm text-ink-faint">No templates in your market yet.</p>
        )}
      </div>

      {tpl && (
        <div className="mt-6 space-y-5">
          <Field label="Course">
            <PlacesAutocomplete onSelect={setCourse} />
            {course && <p className="mt-1 text-sm text-pine">Selected: {course.name}</p>}
          </Field>

          <Field label="Name this game (optional)" hint="So your crew spots it in the list.">
            <input
              className="field-input"
              placeholder={tpl.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Tee time">
              <input
                type="datetime-local"
                className="field-input tnum"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </Field>
            {isFreeTemplate ? (
              <Field label="Entry fee">
                <p className="field-input flex items-center text-pine">Free</p>
              </Field>
            ) : (
              <Field label="Entry fee" hint={feeError ?? undefined}>
                <input
                  className="field-input tnum"
                  inputMode="decimal"
                  placeholder="$50"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
              </Field>
            )}
          </div>

          {tpl.netCapable && (
            <p className="rounded-sm border border-pine/30 bg-pine/5 p-3 text-xs text-ink-soft">
              This game pays <span className="text-ink">two divisions</span> —
              low gross and low net (handicaps applied). The payout below is
              split evenly between them, so your higher-handicap buddies have a
              real shot. Net uses the course rating when it's on file, otherwise
              your full index.
            </p>
          )}

          <Field label="Payout shape">
            <div className="flex gap-2">
              {tpl.allowedPayoutShapes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShape(s)}
                  className={`btn flex-1 ${
                    shape === s ? 'bg-ink text-paper' : 'border border-rule-strong text-ink-soft'
                  }`}
                >
                  {SHAPE_LABEL[s]?.label ?? s}
                </button>
              ))}
            </div>
          </Field>

          {/* The dollar grid, before anyone pays (addendum §3) */}
          {item && prizes.length > 0 && !feeError && (
            <Card className="p-4">
              <p className="text-sm">
                <Num>{item.line}</Num>
              </p>
              <div className="mt-3 space-y-1 text-sm">
                {prizes.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-ink-soft">
                      {i + 1}
                      {['st', 'nd', 'rd'][i] ?? 'th'} place
                    </span>
                    <Num className="text-tournament">{formatCents(p)}</Num>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-faint">
                At a full field of <Num>{tpl.fieldSize}</Num>.{' '}
                {tpl.fieldSizeMin && tpl.fieldSizeMin < tpl.fieldSize ? (
                  <>
                    Runs at <Num>{tpl.fieldSizeMin}</Num>+ players — cards are
                    charged only if the event runs, and the purse scales with
                    the field.
                  </>
                ) : (
                  <>Charged only if the field fills.</>
                )}
              </p>
            </Card>
          )}

          {error && <p className="text-sm text-tournament">{error}</p>}

          <Button variant="primary" className="w-full" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Creating…' : 'Create — it goes live now'}
          </Button>
        </div>
      )}
    </div>
  );
}
