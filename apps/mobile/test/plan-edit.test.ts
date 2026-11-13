import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf, type PbBlockView, type PbEditScope } from '@fizz/domain';
import type { PlanBuilderAnswers, Routine } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { PlanBuilderSession } from '../src/services/plan-builder-service';
import type { TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 26 Oct: Edit plan on a running plan; plan-builder.md "Editing a running plan") End to end on real SQLite,
 * offline: Library › Your plan › `Edit plan` keeps every answer; a change (abs 10 → 14) shows as the Changes card;
 * one line rejected; `From week 4`; Apply writes one versioned, idempotent edit (rule 5): done weeks and the weeks
 * before 4 don't change, the plan's workouts don't change until week 4; Undo puts it all back; a stale Apply is
 * refused; a force-close keeps what was applied; a new week's sync makes the workouts follow; Summary's
 * `Keep for next time?` keeps working with versions; Move day this week with Undo.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  // Monday 19 Oct 2026.
  h = createHarness('2026-10-19T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

/** Today's card for a plan day, committed, started and finished (one set logged as planned). */
async function doDay(s: AppServices, gymId: string, name: string): Promise<string> {
  const data = await loaded(s);
  const day = data.days.find((d) => d.name === name);
  const controls = day === undefined ? undefined : data.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name} day in ${data.days.map((d) => d.name).join(', ')}`);
  const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  const sessionId = r.aggregate.session.id;
  await finishWorkout(h, s, sessionId);
  h.clockMs += 3_600_000;
  return sessionId;
}

function nextMonday(): void {
  const now = new Date(h.clockMs);
  const back = (now.getUTCDay() + 6) % 7;
  h.clockMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + 7, 7);
}

/** A running 6-week builder plan (4 days, Upper/Lower, abs 10), offline. */
async function running(s: AppServices, gymId: string, patch: Partial<PlanBuilderAnswers> = {}): Promise<{ planId: string; answers: PlanBuilderAnswers }> {
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Back squat', sets: [{ load: 120, reps: 5, rpe: 8 }] },
  ]);
  h.clockMs += 3_600_000;
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a: PlanBuilderAnswers = { ...session.answers, sessions: 4, split: 'ul', abs: 10, ...patch };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error(`not built: ${built.reason}`);
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  return { planId: built.planId, answers: a };
}

async function editing(s: AppServices, planId: string): Promise<PlanBuilderSession & { running: NonNullable<PlanBuilderSession['running']> }> {
  const e = await s.planBuilder.open({ editPlanId: planId });
  if (e?.running == null) throw new Error('not editing a running plan');
  return e as PlanBuilderSession & { running: NonNullable<PlanBuilderSession['running']> };
}

const rowsOf = (v: PbBlockView | undefined) => JSON.stringify(v?.days.map((d) => ({ i: d.index, n: d.name, rows: d.rows.map((r) => [r.name, r.line, r.kg]) })));
const planDays = async (s: AppServices): Promise<Routine[]> => {
  const ov = await s.plans.overview();
  const out: Routine[] = [];
  for (const d of ov?.days ?? []) {
    const r = (await s.routines.editor({ routineId: d.routineId, gymId: null }))?.routine;
    if (r != null) out.push(r);
  }
  return out;
};
const shape = (rs: readonly Routine[]) => rs.map((r) => ({ id: r.id, name: r.name, ex: r.exercises.map((e) => [e.exerciseId, e.setTemplates.filter((t) => t.setType !== 'warmup').length]) }));

describe('Edit plan on a running plan', () => {
  it('abs 10 → 14, reject one line, from week 4, Apply, Undo; stale refused; force-close; the new week’s sync', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { planId, answers } = await running(s, gymId);

    // Week 1: Upper A done; week 2 now.
    await doDay(s, gymId, 'Upper A');
    nextMonday();
    await doDay(s, gymId, 'Upper A');
    const before = await s.plans.overview();
    expect(before?.block).toMatchObject({ current: 2, editable: true });
    const daysBefore = shape(await planDays(s));

    // Edit plan: every answer kept; the Changes card against the plan as it is.
    const e = await editing(s, planId);
    expect(e.opensOn).toBe('plan');
    expect(e.answers).toEqual(answers);
    expect(e.running.week).toBe(2);
    const none = e.running.preview(e.answers, new Set(), { kind: 'from', week: 2 });
    expect(none.items).toEqual([]);
    expect(none.canApply).toBe(false);

    const abs14 = { ...e.answers, abs: 14 as const };
    const scope: PbEditScope = { kind: 'from', week: 4 };
    const all = e.running.preview(abs14, new Set(), scope);
    expect(all.items.length).toBeGreaterThan(1);
    const rejected = all.items[0];
    if (rejected === undefined) throw new Error('no items');
    const pv = e.running.preview(abs14, new Set([rejected.id]), scope);
    expect(pv.counted).toBe(`${String(all.items.length - 1)} of ${String(all.items.length)}`);
    expect(pv.items.find((it) => it.id === rejected.id)?.accepted).toBe(false);
    expect(pv.changed.every((w) => w >= 4)).toBe(true);
    // Any week can be viewed: weeks 1–3 as they are (done week 1 read-only); week 4 as it will be.
    for (const w of [1, 2, 3]) expect(rowsOf(pv.views[w - 1])).toBe(rowsOf(before?.block?.views[w - 1]));
    expect(pv.views[0]?.readOnly).toBe(true);
    expect(rowsOf(pv.views[3])).not.toBe(rowsOf(before?.block?.views[3]));

    // Apply: one write, idempotent on its op ID.
    const opId = h.ids();
    const r = await s.planBuilder.applyEdit(e, abs14, new Set([rejected.id]), scope, opId);
    if (!r.ok) throw new Error(r.message);
    expect(await s.planBuilder.applyEdit(e, abs14, new Set([rejected.id]), scope, opId)).toEqual(r);
    const after = await s.plans.overview();
    expect(after?.block?.planVersion).toBe(r.version);
    for (const w of [1, 2, 3]) expect(rowsOf(after?.block?.views[w - 1])).toBe(rowsOf(before?.block?.views[w - 1]));
    for (const w of [4, 5, 6]) expect(rowsOf(after?.block?.views[w - 1])).toBe(rowsOf(pv.views[w - 1]));
    // Not until week 4: the plan's workouts (Today) are as they were.
    expect(shape(await planDays(s))).toEqual(daysBefore);
    // The builder now opens on the edited answers.
    expect((await editing(s, planId)).answers.abs).toBe(14);

    // A stale Apply (the read before this one) is refused, nothing written.
    const staleTry = await s.planBuilder.applyEdit(e, { ...e.answers, abs: 6 }, new Set(), { kind: 'from', week: 2 }, h.ids());
    expect(staleTry).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.plans.overview())?.block?.planVersion).toBe(r.version);

    // Undo: the plan exactly as before.
    const u = await s.planBuilder.undoEdit({ planId, expectedVersion: r.version, opId: h.ids() });
    if (!u.ok) throw new Error(u.message);
    const undone = await s.plans.overview();
    for (const w of [1, 2, 3, 4, 5, 6]) expect(rowsOf(undone?.block?.views[w - 1])).toBe(rowsOf(before?.block?.views[w - 1]));
    expect(shape(await planDays(s))).toEqual(daysBefore);
    expect((await editing(s, planId)).answers.abs).toBe(10);
    // Undo of the same edit again: stale.
    expect(await s.planBuilder.undoEdit({ planId, expectedVersion: r.version, opId: h.ids() })).toMatchObject({ ok: false });

    // From week 3 this time; force-close; next Monday is week 3: the plan's workouts follow on the next open.
    const e2 = await editing(s, planId);
    const r2 = await s.planBuilder.applyEdit(e2, abs14, new Set(), { kind: 'from', week: 3 }, h.ids());
    if (!r2.ok) throw new Error(r2.message);
    expect(shape(await planDays(s))).toEqual(daysBefore);
    const week3 = (await s.plans.overview())?.block?.views[2];
    await h.forceClose();
    nextMonday();
    const { services: s2 } = await h.launch();
    const ov3 = await s2.plans.overview();
    expect(ov3?.block?.current).toBe(3);
    expect(rowsOf(ov3?.block?.views[2])).toBe(rowsOf(week3));
    const now3 = await planDays(s2);
    expect(shape(now3)).not.toEqual(daysBefore);
    // Each plan day's workout has week 3's exercises and set counts.
    for (const d of ov3?.block?.views[2]?.days ?? []) {
      const r = now3.find((x) => x.createdFromPlan?.dayIndex === d.index);
      expect(r?.exercises.map((x) => x.exerciseId).sort()).toEqual(d.rows.map((row) => row.exerciseId).sort());
    }
    // Idempotent: another open writes nothing.
    expect(await s2.plans.syncWeek()).toBe(false);
    // Today plans the edited day.
    const today = await loaded(s2);
    expect(today.block?.text).toBe('Week 3 of 6');
  });

  it('this week onwards: a day done this week keeps this week; the others change now; Undo puts the workouts back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { planId } = await running(s, gymId);
    await doDay(s, gymId, 'Upper A');
    const before = await planDays(s);
    const e = await editing(s, planId);
    const abs14 = { ...e.answers, abs: 14 as const };
    const pv = e.running.preview(abs14, new Set(), { kind: 'from', week: 1 });
    const upperA = before.find((r) => r.name === 'Upper A');
    const doneIndex = upperA?.createdFromPlan?.dayIndex;
    // Week 1's Upper A (done) stays as it is.
    const w1 = pv.views[0]?.days.find((d) => d.index === doneIndex);
    const was = (await s.plans.overview())?.block?.views[0]?.days.find((d) => d.index === doneIndex);
    expect(JSON.stringify(w1?.rows)).toBe(JSON.stringify(was?.rows));
    const r = await s.planBuilder.applyEdit(e, abs14, new Set(), { kind: 'from', week: 1 }, h.ids());
    if (!r.ok) throw new Error(r.message);
    const after = await planDays(s);
    const changedDays = new Set(pv.items.map((it) => (it.id.split('|')[0] ?? '')).map(Number));
    for (const rt of after) {
      const i = rt.createdFromPlan?.dayIndex ?? -1;
      const old = before.find((b) => b.id === rt.id);
      // Every changed day's workout changed now (the done one too: its next session is next week's).
      if (changedDays.has(i)) expect(shape([rt])).not.toEqual(shape(old === undefined ? [] : [old]));
      else expect(shape([rt])).toEqual(shape(old === undefined ? [] : [old]));
    }
    const u = await s.planBuilder.undoEdit({ planId, expectedVersion: r.version, opId: h.ids() });
    if (!u.ok) throw new Error(u.message);
    expect(shape(await planDays(s))).toEqual(shape(before));
  });

  it('Keep for next time? keeps working with plan versions: kept before an edit stays kept; an edit after Start makes it stale', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { planId } = await running(s, gymId);
    const ok = (w: BuilderWriteResult): BuilderSnapshot => {
      if (w.status !== 'written' && w.status !== 'replayed') throw new Error(w.message);
      return w.snapshot;
    };
    // Upper A on Your workout with one more set on the main lift, started and finished.
    const startEdited = async (): Promise<{ sessionId: string; mainId: string }> => {
      const data = await loaded(s);
      const day = data.days.find((d) => d.name === 'Upper A');
      const controls = day === undefined ? undefined : data.initial[day.key];
      if (day === undefined || controls === undefined) throw new Error('no Upper A');
      const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, h.ids());
      if (!c.ok) throw new Error(c.message);
      const snap = await s.builder.read(c.draftId);
      if (snap === null) throw new Error('no draft');
      const main = slotsOf(snap.workout.blocks)[0];
      if (main === undefined) throw new Error('no main');
      const more = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: main.key }, { opId: h.ids(), basis: { version: snap.version } }));
      const st = await s.builder.start(more.draftId, { opId: h.ids(), expectedVersion: more.version, gymId, checkIn: null });
      if (!st.ok) throw new Error(st.message);
      await finishWorkout(h, s, st.sessionId);
      h.clockMs += 3_600_000;
      return { sessionId: st.sessionId, mainId: main.exerciseId };
    };
    const sets = (r: Routine | undefined) => r?.exercises.find((x) => x.exerciseId === first.mainId)?.setTemplates.filter((t) => t.setType !== 'warmup').length;
    const initial = (await planDays(s)).find((r) => r.name === 'Upper A');
    const first = await startEdited();
    const keep = await s.builder.keepNextTimeOf(first.sessionId);
    expect(keep?.state).toBe('open');
    expect(await s.builder.keepNextTime(first.sessionId, 'apply')).toEqual({ ok: true });
    const kept = sets((await planDays(s)).find((r) => r.name === 'Upper A'));
    expect(kept).toBe((sets(initial) ?? 0) + 1);

    // An edit this week onwards (abs): Ben's kept set on the main lift stays (only the accepted lines change).
    const e = await editing(s, planId);
    const r = await s.planBuilder.applyEdit(e, { ...e.answers, abs: 14 }, new Set(), { kind: 'from', week: 1 }, h.ids());
    if (!r.ok) throw new Error(r.message);
    const afterEdit = (await planDays(s)).find((x) => x.name === 'Upper A');
    expect(sets(afterEdit)).toBe(kept);

    // A workout started from the day, then an edit of the day before its Summary: Keep is out of date (rule 5).
    const second = await startEdited();
    expect((await s.builder.keepNextTimeOf(second.sessionId))?.state).toBe('open');
    const e2 = await editing(s, planId);
    const r2 = await s.planBuilder.applyEdit(e2, { ...e2.answers, abs: 6 }, new Set(), { kind: 'from', week: 1 }, h.ids());
    if (!r2.ok) throw new Error(r2.message);
    expect(e2.running.preview({ ...e2.answers, abs: 6 }, new Set(), { kind: 'from', week: 1 }).items.some((it) => it.text.startsWith('Upper A'))).toBe(true);
    expect(await s.builder.keepNextTimeOf(second.sessionId)).toBeNull();
    expect(await s.builder.keepNextTime(second.sessionId, 'apply')).toMatchObject({ ok: false });
  });

  it('Move day: this week only, Undo; Any days plans have no Move day', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { planId } = await running(s, gymId, { schedule: 'set', days: [0, 1, 3, 4] });
    const ov = await s.plans.overview();
    const b = ov?.block;
    if (b == null) throw new Error('no block');
    const lowerA = b.views[0]?.days.find((d) => d.name === 'Lower A');
    if (lowerA === undefined) throw new Error('no Lower A');
    expect(lowerA.weekday).toBe(1);
    expect(b.actions[lowerA.index]?.moveTo).toEqual([1, 2, 5, 6]);
    const m = await s.plans.moveDay({ planId, dayIndex: lowerA.index, weekday: 5, expectedVersion: b.planVersion, opId: h.ids() });
    if (!m.ok) throw new Error(m.message);
    const moved = (await s.plans.overview())?.block;
    expect(moved?.views[0]?.days.find((d) => d.index === lowerA.index)?.weekday).toBe(5);
    expect(moved?.views[1]?.days.find((d) => d.index === lowerA.index)?.weekday).toBe(1);
    // A stale move (the read before) is refused.
    expect((await s.plans.moveDay({ planId, dayIndex: lowerA.index, weekday: 6, expectedVersion: b.planVersion, opId: h.ids() })).ok).toBe(false);
    const u = await s.plans.undoMove({ planId, expectedVersion: m.plan.version, opId: h.ids() });
    expect(u.ok).toBe(true);
    expect((await s.plans.overview())?.block?.views[0]?.days.find((d) => d.index === lowerA.index)?.weekday).toBe(1);
    // Do today: each day not done this week opens on Today by its key.
    expect(b.actions[lowerA.index]?.todayKey).toBe(`plan:${planId}:${String(lowerA.index)}`);
    expect((await loaded(s)).days.some((d) => d.key === b.actions[lowerA.index]?.todayKey)).toBe(true);
  });

  it('Any days: no weekdays and no Move day; a done day has no actions', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await running(s, gymId);
    await doDay(s, gymId, 'Upper A');
    const b = (await s.plans.overview())?.block;
    expect(b?.views[0]?.days.every((d) => d.weekday === null)).toBe(true);
    const done = b?.views[0]?.days.find((d) => d.done);
    expect(done).toBeDefined();
    expect(b?.actions[done?.index ?? -1]).toBeUndefined();
    expect(Object.values(b?.actions ?? {}).every((x) => x.moveTo === null)).toBe(true);
    h.clockMs += DAY;
  });
});
