import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId } from '@fizz/domain';

import { PlanSetupScreen } from '../../src/screens/plan/PlanSetupScreen';
import { createHarness, type Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 30 Oct, build 486: "my preferences to remove leg extension in setting as non preferred hasn't updated plan")
 * Library › Your plan › Any preferences on the plan in use, over real SQLite: Quad extra is `Split squat`, so leg
 * extension is not preferred, and Legs A and Legs B still have it. The page shows one line with Replace; Replace shows
 * the plan-wide swap card (Leg extension → Split squat, each day); Apply changes the plan days; Undo puts them back.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-30T08:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

describe('Any preferences: In your plan … · Replace', () => {
  it('the line, Replace → the proposal card, Apply, Undo; no React warning', async () => {
    const launched = await h.launch();
    const s = launched.services;
    await s.setup.saveUnits('kg');
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
    await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
    await s.setup.complete();
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no builder');
    const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], prefs: { quads: 1 as const } };
    const built = await s.planBuilder.save(session, a, null, h.ids());
    if (!built.ok) throw new Error('not built');
    expect((await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok).toBe(true);
    const le = catalogueExerciseId('machine-leg-extension');
    const legs = ((await s.plans.active())?.days ?? []).filter((d) => d.name.startsWith('Legs'));
    for (const d of legs) {
      const t = (await s.routines.editor({ routineId: d.routineId, gymId: null }))?.routine;
      if (t == null) throw new Error('no template');
      expect((await s.plans.editDayEveryWeek({ routineId: d.routineId, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: le, afterRowId: null } })).ok).toBe(true);
    }

    const r = await renderScreen(h, launched, PlanSetupScreen, { name: 'PlanSetup', params: { editPlanId: built.planId } }, (t) => t.includes('Any preferences'));
    // The row's label is its title and value (`Any preferences, 1 set`).
    const row = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Any preferences'))[0];
    if (row === undefined) throw new Error('no Any preferences row');
    const onPress = row.props.onPress as (e: unknown) => unknown;
    await act(async () => {
      await onPress({ nativeEvent: {} });
    });
    await r.waitFor((t) => t.includes('Leg extension · In your plan: Legs A, Legs B') && t.includes('Replace'), 'the not-preferred line');
    await r.press('Replace');
    await r.waitFor((t) => t.includes('Every week') && t.includes('Leg extension → ') && t.includes('Apply'), 'the swap card');
    await r.press('Apply');
    await r.waitFor((t) => t.includes('Applied') && t.includes('Undo') && !t.includes('In your plan: Legs A'), 'applied, the line gone');
    for (const d of legs) expect((await s.routines.editor({ routineId: d.routineId, gymId: null }))?.routine?.exercises.map((e) => e.exerciseId)).not.toContain(le);
    await r.press('Undo');
    await r.waitFor((t) => t.includes('Undone') && t.includes('In your plan: Legs A, Legs B'), 'undone, the line back');
    expectHealthy(r);
    await r.unmount();
  });
});
