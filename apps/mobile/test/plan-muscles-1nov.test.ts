import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { directMuscleGroup } from '@fizz/domain';
import type { Exercise, Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 1 Nov: "the coach should have caught that my plan barely trains biceps") Real SQLite, the real plan builder:
 * Ben's 6-day PPL A/B with no curls → Plan › Muscles flags Biceps (direct sets; the range is 4–8 because rows and
 * pulldowns cover some) → Rebalance → Apply puts curls into Pull A and Pull B for every week, no day past its minutes
 * → Biceps in range → Undo puts the plan and its workouts back exactly.
 */

let h: Harness;
beforeEach(() => {
  // Sunday 1 Nov 2026, 10:00 in London.
  h = createHarness('2026-11-01T10:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function setUpGym(s: AppServices): Promise<void> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
}

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

async function bensPlan(): Promise<{ s: AppServices; days: Map<string, string> }> {
  const { services: s } = await h.launch();
  await setUpGym(s);
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], focus: 'muscle' as const }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const days = new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
  return { s, days };
}

let pool: Exercise[] = [];
const isBicepsLed = (_s: AppServices, id: string): boolean => {
  const e = pool.find((x) => x.id === id);
  return e !== undefined && directMuscleGroup(e) === 'Biceps';
};

describe('Plan › Muscles and Rebalance on Ben’s PPL A/B (real SQLite)', () => {
  it('flags Biceps → Rebalance adds curls to Pull A and Pull B every week (+2, the rest still flagged), within each day’s minutes → Undo', async () => {
    const { s, days } = await bensPlan();
    const pullA = days.get('Pull A') ?? '';
    const pullB = days.get('Pull B') ?? '';
    pool = await s.coachingKnowledge.exercises();
    // Strip any biceps-led accessory the build picked, so this is Ben's plan as he had it: no curls.
    for (const id of [pullA, pullB]) {
      const t = await template(s, id);
      for (const e of t.exercises.filter((x) => isBicepsLed(s, x.exerciseId))) {
        const now = await template(s, id);
        const r = await s.plans.editDayEveryWeek({ routineId: id, expectedVersion: now.version, opId: h.ids(), edit: { kind: 'remove', rowId: e.id, fromExerciseId: e.exerciseId, toExerciseId: null, afterRowId: null } });
        if (!r.ok) throw new Error(r.message);
      }
      expect((await template(s, id)).exercises.some((e) => isBicepsLed(s, e.exerciseId))).toBe(false);
    }

    const before = await s.planMuscles.muscles();
    if (before === null) throw new Error('no muscles view');
    const biceps = before.view.bars.find((b) => b.group === 'Biceps');
    expect(biceps?.direct).toBe(0);
    // The builder's pull days here lead with back work that gives Biceps little assisted work: the 6–10 range applies
    // (Ben's own rows-and-pulldowns plan, with ≥ 6 assisted, reads 4–8: packages/domain/test/plan-muscles-1nov.test.ts).
    expect(biceps?.range).toMatchObject({ min: 6, max: 10, why: 'goal' });
    expect(before.view.flagLines).toContain('Biceps 0/wk · below 6–10');
    expect(before.line).toMatch(/^Muscles · .*Biceps.* low/);
    expect(await s.planMuscles.line()).toBe(before.line);
    expect(before.canRebalance).toBe(true);

    const card = await s.planMuscles.rebalance();
    if (card === null) throw new Error('no card');
    const bicepsAdds = card.lines.filter((l) => /^Pull [AB]: \+ /.test(l.text) && /curl/i.test(l.text));
    expect(bicepsAdds.map((l) => l.text.split(':')[0])).toEqual(['Pull A', 'Pull B']);
    // +2 per group per proposal (rule 1 / V5): 0 → 2, still below, and shown so.
    expect(card.bars.find((b) => b.group === 'Biceps')).toMatchObject({ before: 0, after: 2, statusAfter: 'below' });
    expect(card.minutes.every((m) => !m.over)).toBe(true);
    expect(card.canApply).toBe(true);

    const r = await s.planMuscles.apply({ planId: card.planId, expectedVersion: card.planVersion, rejected: [], opId: 'rebalance-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Idempotent: the same op ID writes nothing more.
    expect(await s.planMuscles.apply({ planId: card.planId, expectedVersion: card.planVersion, rejected: [], opId: 'rebalance-1' })).toMatchObject({ ok: true, version: r.version });
    // A stale card is refused, never applied to the newer plan (rule 5).
    expect(await s.planMuscles.apply({ planId: card.planId, expectedVersion: card.planVersion, rejected: [], opId: 'rebalance-2' })).toMatchObject({ ok: false, reason: 'stale' });

    const after = await s.planMuscles.muscles();
    for (const name of ['Pull A', 'Pull B']) expect(after?.view.byDay.find((d) => d.name === name)?.chips.find((c) => c.group === 'Biceps')?.sets ?? 0).toBeGreaterThan(0);
    // The rest of the gap stays visible on the bars after Apply.
    expect(after?.view.flagLines).toContain('Biceps 2/wk · below 6–10');
    expect(after?.view.bars.find((b) => b.group === 'Biceps')?.direct).toBe(2);
    // Every later week has them too (future weeks read the plan's own version).
    for (const chip of after?.view.chips.filter((c) => c.key !== 'avg') ?? []) {
      const w = await s.planMuscles.muscles(chip.key);
      expect(w?.view.bars.find((b) => b.group === 'Biceps')?.direct ?? 0).toBe(2);
    }

    const undone = await s.planMuscles.undo({ planId: r.planId, expectedVersion: r.version, opId: 'rebalance-undo' });
    expect(undone.ok).toBe(true);
    const back = await s.planMuscles.muscles();
    for (const name of ['Pull A', 'Pull B']) expect(back?.view.byDay.find((d) => d.name === name)?.chips.some((c) => c.group === 'Biceps')).toBe(false);
    expect((await s.planMuscles.muscles())?.view.flagLines).toContain('Biceps 0/wk · below 6–10');
  });
});

describe('the coach’s muscle-gap offer: once per plan state (Ben, 1 Nov)', () => {
  it('raised after Apply; the weekly review doesn’t raise it again; Skip holds; a plan change raises it afresh', async () => {
    const { s, days } = await bensPlan();
    // Strip the build's biceps work (as above) so Biceps is out of range.
    pool = await s.coachingKnowledge.exercises();
    for (const id of [days.get('Pull A') ?? '', days.get('Pull B') ?? '']) {
      for (const e of (await template(s, id)).exercises.filter((x) => isBicepsLed(s, x.exerciseId))) {
        const now = await template(s, id);
        const r = await s.plans.editDayEveryWeek({ routineId: id, expectedVersion: now.version, opId: h.ids(), edit: { kind: 'remove', rowId: e.id, fromExerciseId: e.exerciseId, toExerciseId: null, afterRowId: null } });
        if (!r.ok) throw new Error(r.message);
      }
    }
    const first = await s.planMuscles.offer({ surface: 'apply', weekMonday: null, opId: 'offer-1' });
    expect(first?.text).toMatch(/only 0 sets a week · Rebalance\?$/);
    // The same surface shows the same one offer again (it is still open); a retried write is the same write.
    expect(await s.planMuscles.offer({ surface: 'apply', weekMonday: null, opId: 'offer-1' })).toEqual(first);
    // The weekly review doesn't raise the same gap again.
    expect(await s.planMuscles.offer({ surface: 'review', weekMonday: '2026-10-26', opId: 'offer-2' })).toBeNull();
    expect(await s.planMuscles.skipOffer({ key: first?.key ?? '', opId: 'skip-1' })).toBe(true);
    expect(await s.planMuscles.offer({ surface: 'apply', weekMonday: null, opId: 'offer-3' })).toBeNull();
    expect(await s.planMuscles.offer({ surface: 'review', weekMonday: '2026-11-02', opId: 'offer-4' })).toBeNull();
    // The plan changes (Pull A loses a set's exercise): a new plan state, raised once more by the review.
    const pullA = await template(s, days.get('Pull A') ?? '');
    const last = pullA.exercises.filter((e) => e.main !== true).at(-1);
    if (last === undefined) throw new Error('no accessory');
    const r = await s.plans.editDayEveryWeek({ routineId: pullA.id, expectedVersion: pullA.version, opId: h.ids(), edit: { kind: 'remove', rowId: last.id, fromExerciseId: last.exerciseId, toExerciseId: null, afterRowId: null } });
    expect(r.ok).toBe(true);
    const again = await s.planMuscles.offer({ surface: 'review', weekMonday: '2026-11-02', opId: 'offer-5' });
    expect(again).not.toBeNull();
    expect(again?.key).not.toBe(first?.key);
    // The coach's YOUR DATA lines: from the same count.
    expect((await s.planMuscles.coachLines())?.find((l) => l.startsWith('Biceps'))).toMatch(/^Biceps 0 direct .*· below$/);
  });
});
