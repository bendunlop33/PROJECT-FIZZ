import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 30 Oct: "I don't think the whole start of week plan thing is working") Real SQLite, offline, no coach. Changes
 * to the plan in use never restart its block (training-blocks.md §4.1): Ben's Set days plan applied Wed 28 Oct (a
 * lead-in; week 1 starts Mon 2 Nov) after Legs Mon and Pull Tue, Push A from the plan Wed, a Move day and a Skip this
 * week. Then (a) Edit plan › Apply changes, (b) the builder again (Set up a plan while it runs is Edit plan; a new plan
 * document over it continues the block), (c) an Every week edit, (d) a plan-wide swap Apply, (e) Pause and Resume,
 * (f) a backup and restore. After each: the same lead-in, week numbers, deload, this week's done days and changes,
 * Up next and tiles.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-26T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const SET = { split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] };

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

const nextName = (d: TodaySessionData) => d.days.find((x) => x.key === d.nextKey)?.name ?? null;

/** Everything a restart would move: the block, this week's done days and changes, Up next, the tiles. */
async function snap(s: AppServices) {
  const d = await loaded(s);
  const ov = await s.plans.overview();
  const pullB = d.days.find((x) => x.name === 'Pull B');
  return {
    header: d.block?.text,
    startsOn: ov?.block?.startsOn,
    current: ov?.block?.current,
    deload: ov?.block?.views[0]?.deloadWeeks,
    strip: ov?.block?.views[0]?.strip.map((c) => c.state),
    thisWeek: ov?.daysThisWeek.text,
    done: ov?.days.filter((x) => x.state === 'done').map((x) => `${x.name} ${x.doneOn ?? ''}`).sort(),
    next: nextName(d),
    libraryNext: ov?.days.find((x) => x.state === 'next')?.name ?? null,
    legsB: d.week.planned.find((x) => x.key.endsWith(':5'))?.localDate ?? null,
    pullB: pullB === undefined ? null : s.todaySession.daySheet(d, { dayKey: pullB.key }, d.nextKey, (x) => x).statusText,
    tiles: s.todaySession.week(d, nextName(d)).map((t) => `${t.date.slice(8)} ${t.state}`),
  };
}

async function planRef(s: AppServices): Promise<{ planId: string; version: number }> {
  const ov = await s.plans.overview();
  if (ov?.block == null) throw new Error('no block');
  return { planId: ov.block.planId, version: ov.block.planVersion };
}

/** Wed 28 Oct: Ben's week before the changes. */
async function bensLeadIn(s: AppServices, gymId: string): Promise<void> {
  h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
  await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] }]);
  h.clockMs = Date.parse('2026-10-27T18:00:00.000Z');
  await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }] }]);
  h.clockMs = Date.parse('2026-10-28T09:00:00.000Z');
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  expect(session.running).toBeNull();
  const built = await s.planBuilder.save(session, { ...session.answers, ...SET }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  expect((await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok).toBe(true);
  // Push A from the plan, Wed 18:04.
  h.clockMs = Date.parse('2026-10-28T18:04:00.000Z');
  const d = await loaded(s);
  const day = d.days.find((x) => x.name === 'Push A');
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Push A');
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  h.clockMs += 60_000;
  await finishWorkout(h, s, r.aggregate.session.id);
  // This week's changes: Legs B moved to Sunday, Pull B skipped.
  h.clockMs = Date.parse('2026-10-29T08:00:00.000Z');
  let p = await planRef(s);
  expect((await s.plans.moveDay({ planId: p.planId, dayIndex: 5, weekday: 6, expectedVersion: p.version, opId: h.ids() })).ok).toBe(true);
  p = await planRef(s);
  expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'skip', dayIndex: 4 } })).toMatchObject({ ok: true });
}

const LEAD_IN = {
  header: 'Starts Mon 2 Nov',
  startsOn: '2026-11-02',
  current: 1,
  deload: [6],
  strip: ['current', 'todo', 'todo', 'todo', 'todo', 'todo'],
  thisWeek: '3 of 5',
  done: ['Legs A 2026-10-26', 'Pull A 2026-10-27', 'Push A 2026-10-28'],
  next: 'Push B',
  libraryNext: 'Push B',
  legsB: '2026-11-01',
  pullB: 'Skipped',
};

describe('changes to the plan in use never restart the block (Ben, 30 Oct)', () => {
  it('(a)–(f) on Ben’s lead-in week: the lead-in, week 1 = Mon 2 Nov, deload week 6, the done days and this week’s changes all stay', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensLeadIn(s, gymId);
    const base = await snap(s);
    expect(base).toMatchObject(LEAD_IN);
    const planId = (await planRef(s)).planId;

    // (a) Thu: Edit plan › Days and time (minutes) › Apply changes.
    const e = await s.planBuilder.open({ editPlanId: planId });
    if (e?.running == null) throw new Error('not running');
    const a = await s.planBuilder.applyEdit(e, { ...e.answers, minutes: e.answers.minutes === 60 ? 75 : 60 }, new Set(), { kind: 'from', week: e.running.week }, h.ids());
    expect(a).toMatchObject({ ok: true, planId });
    expect(await snap(s)).toEqual(base);

    // (b) The builder again while the plan runs: `Set up a plan` opens as Edit plan on it, and Apply changes keeps it.
    const b = await s.planBuilder.open();
    if (b === null) throw new Error('no builder');
    expect(b.running?.planId).toBe(planId);
    expect(b.opensOn).toBe('start');
    const bb = await s.planBuilder.applyEdit(b, { ...b.answers, minutes: b.answers.minutes === 60 ? 75 : 60 }, new Set(), { kind: 'from', week: b.running?.week ?? 1 }, h.ids());
    expect(bb).toMatchObject({ ok: true, planId });
    expect(await snap(s)).toEqual(base);

    // (c) Every week edit on a day: leg extension added to Legs A.
    const legsA = (await s.plans.active())?.days.find((x) => x.name === 'Legs A')?.routineId ?? '';
    const t = (await s.routines.editor({ routineId: legsA, gymId: null }))?.routine;
    if (t == null) throw new Error('no Legs A');
    const le = (await s.exercisePicker.forTemplate(gymId)).entries.find((x) => x.exercise.name === 'Leg extension')?.exercise.id ?? '';
    const c = await s.plans.editDayEveryWeek({ routineId: legsA, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: le, afterRowId: null } });
    expect(c.ok).toBe(true);
    expect(await snap(s)).toEqual(base);

    // (d) A plan-wide swap's Apply: leg extension → Bulgarian split squat in every plan day.
    const made = await s.planSwap.replace({ key: 'machine-leg-extension', replacementKey: 'dumbbell-bulgarian-split-squat', opId: 'swap-1' });
    if (!made.ok) throw new Error(made.line);
    expect(await s.planSwap.apply(made.actionId)).toEqual({ ok: true });
    expect(await snap(s)).toEqual(base);

    // (e) Pause, then Resume.
    let p = await planRef(s);
    expect((await s.plans.pause({ planId, untilDate: null, expectedVersion: p.version, opId: h.ids() })).ok).toBe(true);
    p = await planRef(s);
    expect((await s.plans.resumePause({ planId, expectedVersion: p.version, opId: h.ids() })).ok).toBe(true);
    expect(await snap(s)).toEqual(base);

    // (f) A backup, a workout after it, then the restore: everything exactly as in the backup.
    const backup = await s.backups.backUpOnPhone('manual');
    if (!backup.ok) throw new Error(backup.error);
    const text = await s.restore.readOnPhone(backup.record.fileName);
    if (text === null) throw new Error('no backup');
    h.clockMs = Date.parse('2026-10-29T10:00:00.000Z');
    p = await planRef(s);
    expect((await s.plans.moveDay({ planId, dayIndex: 5, weekday: 5, expectedVersion: p.version, opId: h.ids() })).ok).toBe(true);
    const prepared = await s.restore.prepare(text);
    if (!prepared.ok) throw new Error('preview');
    expect(await s.restore.restore(text, prepared.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    const { services: s2 } = await h.launch();
    expect(await snap(s2)).toEqual(base);

    // Next Monday: week 1 of 6, the deload still week 6; the lead-in's move was its week only.
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    const mon = await snap(s2);
    expect(mon).toMatchObject({ header: 'Week 1 of 6', startsOn: null, current: 1, deload: [6], legsB: '2026-11-07' });
  });

  it('(b) a new plan document applied over the running block in week 1 (the builder path before 30 Oct) continues it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensLeadIn(s, gymId);
    const base = await snap(s);
    await finishDay(s, gymId, '2026-11-02T18:00:00.000Z', 'Push A');
    h.clockMs = Date.parse('2026-11-04T08:00:00.000Z');
    expect((await snap(s)).header).toBe('Week 1 of 6');
    // As a build before 30 Oct did: a new plan built and applied while the plan is in use (Wed 4 Nov).
    const fresh = await s.planBuilder.open({ fromPlanId: (await planRef(s)).planId });
    if (fresh === null) throw new Error('no builder');
    const built = await s.planBuilder.save(fresh, fresh.answers, null, h.ids());
    if (!built.ok) throw new Error('not built');
    expect((await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok).toBe(true);
    // Before: `Starts Mon 9 Nov`, week 1 again, the deload a week later. Now the same block: week 1, deload week 6,
    // Monday's Push A still this week's.
    const after = await snap(s);
    expect(after).toMatchObject({ header: 'Week 1 of 6', startsOn: null, current: 1, deload: [6], strip: base.strip, done: ['Push A 2026-11-02'] });
    // Next week: week 2, counted across both plan documents.
    h.clockMs = Date.parse('2026-11-10T08:00:00.000Z');
    expect((await snap(s)).header).toBe('Week 2 of 6');
  });
});

async function finishDay(s: AppServices, gymId: string, at: string, name: string): Promise<void> {
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
