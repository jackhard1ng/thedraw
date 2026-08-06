/**
 * Course data entry (spec §4 tiers) — the deliberate alternative to bulk-
 * importing a national ratings database. The promotion queue is the ordering:
 * the most-played listed courses surface first, each ~5 minutes of copy-paste
 * from ncrdb.usga.org plus the scorecard's handicap row. Full tee data +
 * stroke index promotes the course to `supported`, unlocking net scoring,
 * booking-window notices, and different-tee match suggestions.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Badge, Button, Card, Field, Num, SectionHeader } from '@/components/ui';
import { updateCourseData } from '@/lib/callable';
import type { Course } from '@/types/models';

type CourseRow = Course & { id: string };

function parseTees(text: string) {
  // One tee per line: "Blue, 6500, 71.8, 128, 71" (name, yardage, rating, slope, par)
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, yardage, rating, slope, par] = l.split(',').map((s) => s.trim());
      return {
        name,
        yardage: Number(yardage),
        rating: Number(rating),
        slope: Number(slope),
        par: Number(par),
      };
    });
}

export function CourseDataPanel() {
  const { profile } = useAuth();
  const marketId = profile?.marketId ?? 'kc';
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [editing, setEditing] = useState<CourseRow | null>(null);
  const [teeText, setTeeText] = useState('');
  const [strokeIndex, setStrokeIndex] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'courses'),
      where('marketId', '==', marketId),
      orderBy('roundCount', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => setCourses(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Course) }))),
      () => setCourses([]),
    );
  }, [marketId]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      const teeSets = teeText.trim() ? parseTees(teeText) : undefined;
      const order = strokeIndex.trim()
        ? strokeIndex.split(/[,\s]+/).map(Number).filter((n) => !Number.isNaN(n))
        : undefined;
      const res = await updateCourseData({
        placeId: editing.placeId,
        ...(teeSets ? { teeSets } : {}),
        ...(order ? { holeHandicapOrder: order } : {}),
      });
      setMsg(res.data.promoted ? 'Saved — course promoted to supported.' : 'Saved.');
      setEditing(null);
      setTeeText('');
      setStrokeIndex('');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      <SectionHeader
        right={
          <a
            href="https://ncrdb.usga.org"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-tournament underline"
          >
            Look up ratings ↗
          </a>
        }
      >
        Course data
      </SectionHeader>
      <p className="mb-3 text-xs text-ink-faint">
        Most-played courses first — enter tee ratings and the scorecard's
        handicap row to unlock net events and tee suggestions there.
      </p>

      {courses === null && <p className="text-sm text-ink-faint">Loading…</p>}
      <div className="divide-y divide-rule">
        {(courses ?? []).slice(0, 10).map((c) => (
          <div key={c.id} className="flex items-center justify-between py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-ink">{c.name}</p>
              <p className="text-xs text-ink-faint">
                <Num>{c.roundCount}</Num> rounds
              </p>
            </div>
            {c.tier === 'supported' ? (
              <Badge tone="fresh">Supported</Badge>
            ) : (
              <Button
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={() => {
                  setEditing(c);
                  setMsg(null);
                }}
              >
                Add data
              </Button>
            )}
          </div>
        ))}
        {courses?.length === 0 && (
          <p className="py-2 text-sm text-ink-faint">
            Courses appear here as players select them.
          </p>
        )}
      </div>

      {editing && (
        <Card className="mt-3 p-4">
          <p className="mb-3 font-display uppercase tracking-wide text-sm">
            {editing.name}
          </p>
          <div className="space-y-4">
            <Field
              label="Tee sets"
              hint='One per line: name, yardage, rating, slope, par — e.g. "Blue, 6500, 71.8, 128, 71"'
            >
              <textarea
                className="field-input tnum min-h-20"
                value={teeText}
                onChange={(e) => setTeeText(e.target.value)}
              />
            </Field>
            <Field
              label="Stroke index (handicap row)"
              hint="18 numbers from the scorecard, hole 1 through 18 — each of 1-18 once."
            >
              <input
                className="field-input tnum"
                placeholder="7, 1, 13, 5, 17, 9, 3, 15, 11, 2, 14, 6, 18, 10, 4, 16, 12, 8"
                value={strokeIndex}
                onChange={(e) => setStrokeIndex(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="primary" className="flex-1" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save course data'}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {msg && <p className="mt-2 text-sm text-pine">{msg}</p>}
    </div>
  );
}
