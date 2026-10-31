import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import type { ImportDraft } from '../src/import/import-service';
import type { TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 30 Oct, 21:40) Real SQLite, offline, no coach. Ben's 6-day Set days plan (Mon Push A, Tue Pull A, Wed Legs,
 * Thu Push B, Fri Pull B, Sat Legs B), applied Mon 26. His week: Legs Mon 26 (an Empty workout, squat first), a Pull
 * imported from a FitNotes CSV for Tue 27 (29 sets; rows and pull-ups), Push A from the plan Wed 28, Legs B from the
 * plan Fri 30. Before: Library › Plan read `Pull B ✓ Tue 27`, the day sheet read `Tue · Pull A · Missed` above the very
 * workout that did it, and Up next read Push B. Now:
 * - a Set days workout named for variants (`Pull`) is the variant scheduled on its own weekday: Tuesday's Pull A,
 *   whichever lift the file lists first;
 * - Library's days, the day sheet, Today's tiles and Up next all read that one link;
 * - Up next follows the approved Set days order (plan3, 28 Oct), from tomorrow once he has trained today (Ben, 31 Oct):
 *   Saturday's Legs B is done, so the earliest missed day (Thu: Push B).
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-26T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

async function applyPlan(s: AppServices): Promise<void> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
}

const HEADER = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time';
async function importFile(s: AppServices, rows: string[], opId: string): Promise<void> {
  const opened = await s.imports.open({ name: `FitNotes_${opId}.csv`, text: [HEADER, ...rows].join('\n') });
  if (opened.kind !== 'preview') throw new Error(`expected a preview, got ${opened.kind}`);
  let draft: ImportDraft = opened.draft;
  const step = async (change: Parameters<AppServices['imports']['answer']>[2]) => {
    const r = await s.imports.answer(draft.draftId, draft.mappingVersion, change);
    if (!r.ok) throw new Error(r.reason);
    draft = r.draft;
  };
  for (const n of draft.analysis.names.filter((x) => x.needsAnswer)) if (n.match.exerciseId) await step({ kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId } });
  if (draft.analysis.total?.open) await step({ kind: 'total', answer: 'total' });
  if (draft.analysis.perHand?.open) await step({ kind: 'per_hand', answer: 'each' });
  const r = await s.imports.commit(draft.draftId, draft.mappingVersion, opId);
  if (!r.ok) throw new Error(r.reason);
}

async function startDay(s: AppServices, gymId: string, at: string, name: string): Promise<void> {
  h.clockMs = Date.parse(at);
  const d = await loaded(s);
  const day = d.days.find((x) => x.name === name);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  h.clockMs += 60_000;
  await finishWorkout(h, s, r.aggregate.session.id);
}

const nextName = (d: TodaySessionData) => d.days.find((x) => x.key === d.nextKey)?.name ?? null;

/** Every reader of the week: Library's done days (with dates) and NEXT, Today's Up next, the day sheet on Tue 27, the tiles. */
async function week(s: AppServices) {
  const d = await loaded(s);
  const ov = await s.plans.overview();
  const tue = s.todaySession.daySheet(d, { date: '2026-10-27' }, d.nextKey, (x) => x);
  return {
    library: ov?.days.filter((x) => x.state === 'done').map((x) => `${x.name} ${x.doneOn ?? ''}`).sort(),
    libraryNext: ov?.days.find((x) => x.state === 'next')?.name ?? null,
    thisWeek: ov?.daysThisWeek.text,
    todayNext: nextName(d),
    tuesday: `${tue.title} ${tue.statusText}`,
    tiles: s.todaySession.week(d, nextName(d)).map((t) => `${t.date.slice(8)} ${t.state}`),
  };
}

/** Ben's week up to Friday evening; `pullRows`: the Tuesday import's rows in the file's order. */
async function bensWeek(s: AppServices, gymId: string, pullRows: string[]): Promise<void> {
  await applyPlan(s);
  h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Romanian deadlift', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] },
  ]);
  h.clockMs = Date.parse('2026-10-27T21:00:00.000Z');
  await importFile(s, pullRows, 'import-tue-pull');
  await startDay(s, gymId, '2026-10-28T18:04:00.000Z', 'Push A');
  await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B');
  h.clockMs = Date.parse('2026-10-30T19:00:00.000Z');
}

const ROWS = Array.from({ length: 4 }, () => '2026-10-27,Barbell Row,Back,105.0,7,,,');
const PULLUPS = Array.from({ length: 3 }, () => '2026-10-27,Pull Up,Back,0.0,8,,,');

describe('Ben’s Tue 27 imported pull on his Set days plan (Ben, 30 Oct)', () => {
  for (const [label, rows] of [
    ['rows first', [...ROWS, ...PULLUPS]],
    ['pull-ups first in the file', [...PULLUPS, ...ROWS]],
  ] as const) {
    it(`${label}: Pull A done Tue 27 (Tuesday’s day), never Missed; Pull B not done; every reader agrees`, async () => {
      const { services: s } = await h.launch();
      const gymId = await setUpGym(h, s);
      await bensWeek(s, gymId, [...rows]);
      const w = await week(s);
      expect(w.library).toEqual(['Legs A 2026-10-26', 'Legs B 2026-10-30', 'Pull A 2026-10-27', 'Push A 2026-10-28']);
      expect(w.thisWeek).toBe('4 of 6');
      expect(w.tuesday).toBe('Tue · Pull A Done');
      // Fri evening, Legs B done: Up next plans from tomorrow (Ben, 31 Oct). Saturday's Legs B is done, so the earliest
      // missed day, Push B (Thu); Library's NEXT is the same.
      expect(w.todayNext).toBe('Push B');
      expect(w.libraryNext).toBe('Push B');
      expect(w.tiles.slice(0, 5)).toEqual(['26 done', '27 done', '28 done', '29 plain', '30 done']);
      // A force-close re-derives the same (links are read, never stored).
      await h.forceClose();
      const { services: s2 } = await h.launch();
      expect(await week(s2)).toEqual(w);
    });
  }
});
