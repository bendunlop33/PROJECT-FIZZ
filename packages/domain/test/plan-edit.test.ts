import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, PlanDayDraft, PlanDraft, Routine } from '@fizz/schemas';

import {
  applyPlan,
  applyPlanEdit,
  buildPlanFromAnswers,
  movePlanDay,
  pbComposeDays,
  pbDayTargets,
  pbDiffDays,
  pbEditPreview,
  pbNewPlanDraft,
  pbPlanVersion,
  pbResizeSlot,
  pbSlotSets,
  pbStartReps,
  pbWeekDaysOf,
  pbWeekdaysOf,
  pbWeekVersionOf,
  syncPlanWeek,
  undoMovePlanDay,
  undoPlanEdit,
  type PbEditBlock,
  type PbEditScope,
  type PbPlan,
} from '../src/index';
import { OWNER, TZ } from './fixtures';
import { DB, HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 26 Oct: Edit plan on a running plan; plan-builder.md "Editing a running plan"; prototype `diffItems`,
 * `compose`, `planFor`) The Changes card's items, composing only the accepted ones, scoping to weeks, done weeks and
 * done workouts never changing (rule 2), one versioned idempotent write with Undo and stale refused (rule 5), the
 * new-week sync, and Move day.
 */

const at = (ms = NOW) => ({ utc: new Date(ms).toISOString(), tz: TZ });
const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nameOf = (id: string) => id.slice(0, 6);
const keepOf = (p: PbPlan) => (i: number) => p.days.find((d) => d.index === i)?.exercises.map((e) => e.key) ?? [];
const build = (a: PlanBuilderAnswers, keep?: PbPlan) => buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW, ...(keep === undefined ? {} : { keep: keepOf(keep) }) });

function running(a: PlanBuilderAnswers = answers({ abs: 10 })) {
  const plan = build(a);
  const draft = pbNewPlanDraft({ plan, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: op(1), at: at() });
  const r = applyPlan(draft, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: op(2), at: at(), live: [] });
  if (r.kind !== 'write') throw new Error(r.kind);
  return { plan: r.next, routines: r.create, built: plan, answers: a };
}

/** The rebuild's days for new answers (same plan ID: same slot keys). */
function rebuilt(planId: string, a: PlanBuilderAnswers, keep: PbPlan) {
  const p = build(a, keep);
  const v = pbPlanVersion({ plan: p, answers: a, kitOf: KIT_OF, gymId: null, equipmentVersion: 'v1', opId: op(3), at: at(), planId });
  return { days: v.days, startReps: pbStartReps(p, planId) };
}

function edit(plan: PlanDraft, routines: readonly Routine[], a: PlanBuilderAnswers, keep: PbPlan, o: { block?: PbEditBlock; scope?: PbEditScope; rejected?: ReadonlySet<string>; opId?: string; expectedVersion?: number } = {}) {
  const block = o.block ?? { week: 1, doneThisWeek: [] };
  const next = rebuilt(plan.id, a, keep);
  const preview = pbEditPreview({ plan, weeksNow: 6, weeks: a.weeks, next: next.days, block, rejected: o.rejected ?? new Set(), scope: o.scope ?? { kind: 'from', week: block.week }, nameOf });
  const change = applyPlanEdit(plan, { expectedVersion: o.expectedVersion ?? plan.version, opId: o.opId ?? op(10), at: at(NOW + 60_000), answers: a, gymId: null, equipmentVersion: 'v1', weekDays: preview.weekDays, startReps: next.startReps, block, routines });
  return { preview, change, next };
}

/** Routines after a write. */
function after(routines: readonly Routine[], c: { create: Routine[]; update: { next: Routine }[] }): Routine[] {
  const m = new Map(routines.map((r) => [r.id, r]));
  for (const u of c.update) m.set(u.next.id, u.next);
  for (const r of c.create) m.set(r.id, r);
  return [...m.values()];
}
const content = (rs: readonly Routine[]) => rs.map((r) => ({ id: r.id, name: r.name, exercises: r.exercises, deleted: r.deletedAtUtc ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1));

describe('the Changes card: diff and compose', () => {
  it('abs 10 → 14 on a running plan: one line per exercise change; editing keeps the plan (only what the change needs moves)', () => {
    const { plan, built, answers: a } = running();
    const next = rebuilt(plan.id, { ...a, abs: 14 }, built);
    const items = pbDiffDays(pbWeekDaysOf(plan, 1), next.days, nameOf);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(6);
    for (const it of items) expect(['add', 'remove', 'sets']).toContain(it.kind);
    expect(items.every((it) => /^(Upper|Lower) [AB]: /.test(it.text))).toBe(true);
    // Without keeping the plan, the same change reshuffles more.
    const loose = pbPlanVersion({ plan: build({ ...a, abs: 14 }), answers: { ...a, abs: 14 }, kitOf: KIT_OF, gymId: null, equipmentVersion: 'v1', opId: op(3), at: at(), planId: plan.id });
    expect(pbDiffDays(pbWeekDaysOf(plan, 1), loose.days, nameOf).length).toBeGreaterThanOrEqual(items.length);
  });

  it('a focus change is one whole-day item; a day gone is one item', () => {
    const { plan, built, answers: a } = running();
    const next = rebuilt(plan.id, { ...a, sessions: 3, days: [0, 2, 4] }, built);
    const items = pbDiffDays(pbWeekDaysOf(plan, 1), next.days, nameOf);
    const whole = items.filter((it) => it.kind === 'focus');
    expect(whole).toHaveLength(1);
    expect(whole[0]?.text).toBe('2 · Lower: was Lower A');
    expect(items.filter((it) => it.dayIndex === whole[0]?.dayIndex)).toHaveLength(1);
    expect(items.filter((it) => it.kind === 'gone').map((it) => it.text)).toEqual(['4 · Lower B: removed']);
  });

  it('accept all gives the rebuild; reject all gives the plan as it is; a partial accept keeps the rejected line as it was', () => {
    const { plan, built, answers: a } = running();
    const base = pbWeekDaysOf(plan, 1);
    const next = rebuilt(plan.id, { ...a, abs: 14 }, built).days;
    const items = pbDiffDays(base, next, nameOf);
    const ids = (ds: readonly PlanDayDraft[]) => ds.map((d) => ({ i: d.index, ex: d.plan.slots.map((s) => [s.exerciseId, pbSlotSets(s)]) }));
    const all = pbComposeDays(base, next, items, new Set());
    expect(ids(all).map((d) => ({ ...d, ex: [...d.ex].sort() }))).toEqual(ids(next).map((d) => ({ ...d, ex: [...d.ex].sort() })));
    expect(pbComposeDays(base, next, items, new Set(items.map((it) => it.id)))).toEqual(base);
    const one = items[0];
    if (one === undefined) throw new Error('no items');
    const partial = pbComposeDays(base, next, items, new Set([one.id]));
    expect(pbDiffDays(base, partial, nameOf).map((it) => it.id)).toEqual(items.filter((it) => it.id !== one.id).map((it) => it.id));
  });

  it('a kept exercise keeps its plan load and convention (per-hand dumbbells stay per hand; kg stays kg); resizing never touches loads', () => {
    const { plan, built, answers: a } = running();
    const base = pbWeekDaysOf(plan, 1);
    const next = rebuilt(plan.id, { ...a, abs: 14 }, built).days;
    const composed = pbComposeDays(base, next, pbDiffDays(base, next, nameOf), new Set());
    for (const d of composed) {
      for (const s of d.plan.slots) {
        const was = base.find((x) => x.index === d.index)?.plan.slots.find((x) => x.exerciseId === s.exerciseId);
        if (was === undefined) continue;
        const wl = was.setTemplates.find((t) => t.setType !== 'warmup')?.load?.load;
        const nl = s.setTemplates.find((t) => t.setType !== 'warmup')?.load?.load;
        expect(nl).toEqual(wl);
        if (s.checkedOn?.equipmentId === DB.equipmentId) expect(nl?.convention).toBe('per_hand');
      }
    }
    const t = [{ setType: 'warmup' as const }, { setType: 'top' as const }, { setType: 'backoff' as const }, { setType: 'backoff' as const }];
    expect(pbResizeSlot(t, 4).map((x) => x.setType)).toEqual(['warmup', 'top', 'backoff', 'backoff', 'backoff']);
    expect(pbResizeSlot(t, 1).map((x) => x.setType)).toEqual(['warmup', 'top']);
    expect(pbResizeSlot([{ setType: 'working' as const }, { setType: 'working' as const }], 3)).toHaveLength(3);
  });
});

describe('weeks: scope, done weeks and done workouts never change (rule 2)', () => {
  it('from week 4: weeks 1–3 stay; only week 4: weeks 1–3 and 5–6 stay', () => {
    const { plan, built, answers: a } = running();
    const next = rebuilt(plan.id, { ...a, abs: 14 }, built).days;
    const base = pbWeekDaysOf(plan, 1);
    const from = pbEditPreview({ plan, weeksNow: 6, weeks: 6, next, block: { week: 2, doneThisWeek: [] }, rejected: new Set(), scope: { kind: 'from', week: 4 }, nameOf });
    expect(from.changed).toEqual([4, 5, 6]);
    for (const w of [1, 2, 3]) expect(from.weekDays[w - 1]).toEqual(base);
    const only = pbEditPreview({ plan, weeksNow: 6, weeks: 6, next, block: { week: 2, doneThisWeek: [] }, rejected: new Set(), scope: { kind: 'only', week: 4 }, nameOf });
    expect(only.changed).toEqual([4]);
  });

  it('this week onwards in week 3 with day 0 done: weeks 1–2 and day 0 this week stay as they were; day 0 changes from next week', () => {
    const { plan, built, answers: a } = running();
    const next = rebuilt(plan.id, { ...a, abs: 14 }, built).days;
    const base = pbWeekDaysOf(plan, 1);
    const p = pbEditPreview({ plan, weeksNow: 6, weeks: 6, next, block: { week: 3, doneThisWeek: [0] }, rejected: new Set(), scope: { kind: 'from', week: 3 }, nameOf });
    expect(p.weekDays[0]).toEqual(base);
    expect(p.weekDays[1]).toEqual(base);
    expect(p.weekDays[2]?.find((d) => d.index === 0)).toEqual(base.find((d) => d.index === 0));
    const changedDay0 = pbDiffDays(base, next, nameOf).some((it) => it.dayIndex === 0);
    if (changedDay0) expect(p.weekDays[3]?.find((d) => d.index === 0)).not.toEqual(base.find((d) => d.index === 0));
  });

  it('a done week can never be written, even if asked (refused, nothing written)', () => {
    const { plan, routines, built, answers: a } = running();
    const next = rebuilt(plan.id, { ...a, abs: 14 }, built).days;
    const weekDays = Array.from({ length: 6 }, () => next);
    const c = applyPlanEdit(plan, { expectedVersion: plan.version, opId: op(11), at: at(), answers: { ...a, abs: 14 }, gymId: null, equipmentVersion: 'v1', weekDays, startReps: {}, block: { week: 3, doneThisWeek: [] }, routines });
    expect(c).toMatchObject({ kind: 'invalid', reason: 'done_week' });
  });

  it('a plan length shorter than the week it is in is refused', () => {
    const { plan, built, answers: a } = running();
    const p = pbEditPreview({ plan, weeksNow: 6, weeks: 4, next: rebuilt(plan.id, { ...a, weeks: 4 }, built).days, block: { week: 5, doneThisWeek: [] }, rejected: new Set(), scope: { kind: 'from', week: 5 }, nameOf });
    expect(p.tooShort).toBe(true);
  });
});

describe('Apply changes and Undo', () => {
  it('one versioned write: new version, week map, workouts follow this week; Undo puts the plan and workouts back exactly', () => {
    const { plan, routines, built, answers: a } = running();
    const { change } = edit(plan, routines, { ...a, abs: 14 }, built);
    if (change.kind !== 'write') throw new Error(change.kind);
    const next = change.next;
    expect(next.version).toBe(plan.version + 1);
    expect(next.currentVersion).toBe(2);
    expect(next.weekVersions).toEqual([2, 2, 2, 2, 2, 2]);
    expect(next.versions.find((v) => v.n === 2)?.builder?.answers.abs).toBe(14);
    expect(next.lastEdit?.versionAfter).toBe(next.version);
    expect(change.create).toEqual([]);
    const now = after(routines, change);
    // Each day's workout now has the version-2 day's exercises and set counts.
    for (const d of pbWeekDaysOf(next, 1)) {
      const r = now.find((x) => x.createdFromPlan?.dayIndex === d.index);
      const want = [...d.plan.slots].map((s) => [s.exerciseId, pbSlotSets(s)]).sort();
      const got = (r?.exercises ?? []).map((e) => [e.exerciseId, e.setTemplates.filter((t) => t.setType !== 'warmup').length]).sort();
      expect(got).toEqual(want);
    }
    // Duplicate op ID: nothing more.
    expect(applyPlanEdit(next, { expectedVersion: next.version, opId: op(10), at: at(), answers: a, gymId: null, equipmentVersion: 'v1', weekDays: [], startReps: {}, block: { week: 1, doneThisWeek: [] }, routines: now }).kind).toBe('duplicate');
    // Undo: exactly as before.
    const u = undoPlanEdit(next, { expectedVersion: next.version, opId: op(20), at: at(NOW + 120_000), routines: now });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(content(after(now, u))).toEqual(content(routines));
    expect(u.next.currentVersion).toBe(1);
    expect(u.next.weekVersions).toBeUndefined();
    expect(u.next.daysAt).toBeUndefined();
    expect(u.next.versions.map((v) => v.n)).toEqual([1]);
    expect(u.next.name).toBe(plan.name);
    // Undo again (a stale card): refused.
    expect(undoPlanEdit(u.next, { expectedVersion: next.version, opId: op(21), at: at(), routines: after(now, u) }).kind).toBe('stale');
  });

  it('stale: an Apply from an older read is refused, nothing written (rule 5)', () => {
    const { plan, routines, built, answers: a } = running();
    expect(edit(plan, routines, { ...a, abs: 14 }, built, { expectedVersion: plan.version - 1 }).change.kind).toBe('stale');
  });

  it('nothing accepted: nothing to write', () => {
    const { plan, routines, built, answers: a } = running();
    const next = rebuilt(plan.id, { ...a, abs: 14 }, built);
    const items = pbDiffDays(pbWeekDaysOf(plan, 1), next.days, nameOf);
    const { change } = edit(plan, routines, { ...a, abs: 14 }, built, { rejected: new Set(items.map((it) => it.id)) });
    // The answers changed (abs 14), so one version records them, but no workout changes.
    if (change.kind !== 'write') throw new Error(change.kind);
    expect(change.update).toEqual([]);
    expect(edit(plan, routines, a, built).change.kind).toBe('nothing');
  });

  it('Undo is refused when Ben changed a workout since (rule 2); his change stays', () => {
    const { plan, routines, built, answers: a } = running();
    const { change } = edit(plan, routines, { ...a, abs: 14 }, built);
    if (change.kind !== 'write') throw new Error(change.kind);
    const now = after(routines, change);
    const touched = change.update[0]?.next;
    if (touched === undefined) throw new Error('nothing touched');
    const his = now.map((r) => (r.id === touched.id ? { ...r, name: 'Mine', version: r.version + 1 } : r));
    const u = undoPlanEdit(change.next, { expectedVersion: change.next.version, opId: op(22), at: at(), routines: his });
    expect(u).toMatchObject({ kind: 'changed_since', names: ['Mine'] });
  });

  it('a day added and a whole-day change: the new day gets its own workout; Undo removes it', () => {
    const { plan, routines, built, answers: a } = running(answers({ abs: 10, sessions: 3, days: [0, 2, 4] }));
    const four = { ...a, sessions: 4, days: [0, 1, 3, 4] };
    const { change, preview } = edit(plan, routines, four, built);
    expect(preview.items.some((it) => it.kind === 'day')).toBe(true);
    if (change.kind !== 'write') throw new Error(change.kind);
    expect(change.create).toHaveLength(1);
    expect(change.next.applied?.made.map((m) => m.dayIndex).sort()).toEqual([0, 1, 2, 3]);
    expect(change.next.name).toBe('4-day plan');
    const now = after(routines, change);
    const u = undoPlanEdit(change.next, { expectedVersion: change.next.version, opId: op(23), at: at(), routines: now });
    if (u.kind !== 'write') throw new Error(u.kind);
    const back = after(now, u);
    expect(back.find((r) => r.id === change.create[0]?.id)?.deletedAtUtc).not.toBeNull();
    expect(u.next.applied?.made).toEqual(plan.applied?.made);
    expect(content(back.filter((r) => r.id !== change.create[0]?.id))).toEqual(content(routines));
  });
});

describe('a new week: the plan’s workouts follow that week’s version', () => {
  it('only week 2, applied in week 1: nothing changes now; week 2 syncs to it; week 3 syncs back; idempotent', () => {
    const { plan, routines, built, answers: a } = running();
    const { change } = edit(plan, routines, { ...a, abs: 14 }, built, { scope: { kind: 'only', week: 2 } });
    if (change.kind !== 'write') throw new Error(change.kind);
    expect(change.next.weekVersions).toEqual([1, 2, 1, 1, 1, 1]);
    expect(change.update).toEqual([]);
    let p = change.next;
    let rs = after(routines, change);
    const w2 = syncPlanWeek(p, { at: at(NOW + 7 * 86_400_000), block: { week: 2, doneThisWeek: [] }, weeks: 6, routines: rs });
    if (w2.kind !== 'write') throw new Error(w2.kind);
    expect(w2.update.length).toBeGreaterThan(0);
    p = w2.next;
    rs = after(rs, w2);
    expect([...pbDayTargets(p, 6, { week: 2, doneThisWeek: [] }).values()].every((n) => n === 2)).toBe(true);
    expect(syncPlanWeek(p, { at: at(), block: { week: 2, doneThisWeek: [] }, weeks: 6, routines: rs }).kind).toBe('nothing');
    const w3 = syncPlanWeek(p, { at: at(NOW + 14 * 86_400_000), block: { week: 3, doneThisWeek: [] }, weeks: 6, routines: rs });
    if (w3.kind !== 'write') throw new Error(w3.kind);
    // Back to version 1's days: the same exercises and set counts as Apply made.
    const strip = (r: readonly Routine[]) => r.map((x) => ({ id: x.id, ex: x.exercises.map((e) => [e.exerciseId, e.setTemplates.length]) })).sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(strip(after(rs, w3))).toEqual(strip(routines));
  });

  it('a day done this week keeps this week’s version until next week', () => {
    const { plan, routines, built, answers: a } = running();
    const { change } = edit(plan, routines, { ...a, abs: 14 }, built, { scope: { kind: 'from', week: 2 }, block: { week: 1, doneThisWeek: [] } });
    if (change.kind !== 'write') throw new Error(change.kind);
    const t = pbDayTargets(change.next, 6, { week: 1, doneThisWeek: [0] });
    expect(t.get(0)).toBe(pbWeekVersionOf(change.next, 2));
    expect(t.get(1)).toBe(1);
  });
});

describe('Move day (Set days, this week only)', () => {
  it('Legs → Sat this week; a taken day or a done day is refused; Undo puts it back', () => {
    const { plan, answers: a } = running(answers({ abs: 10, schedule: 'set', days: [0, 1, 3, 4] }));
    const idx = pbWeekDaysOf(plan, 1).map((d) => d.index);
    expect([...(pbWeekdaysOf(a, plan.moves, 1, idx) ?? [])]).toEqual([[0, 0], [1, 1], [2, 3], [3, 4]]);
    const m = movePlanDay(plan, { expectedVersion: plan.version, opId: op(30), at: at(), block: { week: 1, doneThisWeek: [] }, dayIndex: 1, weekday: 5 });
    if (m.kind !== 'write') throw new Error(m.kind);
    expect(pbWeekdaysOf(a, m.next.moves, 1, idx)?.get(1)).toBe(5);
    expect(pbWeekdaysOf(a, m.next.moves, 2, idx)?.get(1)).toBe(1);
    expect(movePlanDay(m.next, { expectedVersion: m.next.version, opId: op(31), at: at(), block: { week: 1, doneThisWeek: [] }, dayIndex: 2, weekday: 5 }).kind).toBe('invalid');
    expect(movePlanDay(m.next, { expectedVersion: m.next.version, opId: op(32), at: at(), block: { week: 1, doneThisWeek: [2] }, dayIndex: 2, weekday: 6 }).kind).toBe('invalid');
    expect(movePlanDay(m.next, { expectedVersion: m.next.version, opId: op(30), at: at(), block: { week: 1, doneThisWeek: [] }, dayIndex: 1, weekday: 5 }).kind).toBe('duplicate');
    const u = undoMovePlanDay(m.next, { expectedVersion: m.next.version, opId: op(33), at: at() });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next.moves).toEqual([]);
    expect(undoMovePlanDay(u.next, { expectedVersion: m.next.version, opId: op(34), at: at() }).kind).toBe('stale');
  });

  it('Any days: no weekdays, Move day refused', () => {
    const { plan, answers: a } = running();
    expect(pbWeekdaysOf(a, undefined, 1, [0, 1])).toBeNull();
    expect(movePlanDay(plan, { expectedVersion: plan.version, opId: op(35), at: at(), block: { week: 1, doneThisWeek: [] }, dayIndex: 0, weekday: 6 }).kind).toBe('invalid');
  });
});
