import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId } from '@fizz/domain';

import { PlanSetupScreen } from '../../src/screens/plan/PlanSetupScreen';
import { ExercisePrefsScreen } from '../../src/screens/profile/ExercisePrefsScreen';
import { ProfileScreen } from '../../src/screens/profile/ProfileScreen';
import type { AppServices } from '../../src/services/app-services';
import { createHarness, type Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';

/**
 * (Ben, 2 Nov) Profile › Training › Likes & dislikes rendered over real SQLite: the row (`No plan` and not tappable
 * with no builder plan; counts with one), the screen's two lists with Add (the exercise picker) and Remove, and a
 * dislike for an exercise in the plan showing Plan setup's `In your plan … · Replace` line. No React warning.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-11-02T08:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function setUp(s: AppServices): Promise<void> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
}

async function bensPlan(s: AppServices): Promise<void> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], prefs: {}, likes: [], never: [] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  expect((await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok).toBe(true);
  const le = catalogueExerciseId('machine-leg-extension');
  for (const d of ((await s.plans.active())?.days ?? []).filter((x) => x.name.startsWith('Legs'))) {
    const t = (await s.routines.editor({ routineId: d.routineId, gymId: null }))?.routine;
    if (t == null) throw new Error('no template');
    if (t.exercises.some((e) => e.exerciseId === le)) continue;
    expect((await s.plans.editDayEveryWeek({ routineId: d.routineId, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: le, afterRowId: null } })).ok).toBe(true);
  }
}

async function tap(r: Rendered, match: (label: string) => boolean, index = 0): Promise<void> {
  const n = r.all((x) => typeof x.props.onPress === 'function' && typeof x.props.accessibilityLabel === 'string' && match(x.props.accessibilityLabel))[index];
  if (n === undefined) throw new Error('nothing to tap');
  const onPress = n.props.onPress as (e: unknown) => unknown;
  await act(async () => {
    await onPress({ nativeEvent: {} });
  });
}

describe('Profile › Likes & dislikes', () => {
  it('no plan in use: the row says `No plan` and doesn’t open', async () => {
    const launched = await h.launch();
    await setUp(launched.services);
    const r = await renderScreen(h, launched, ProfileScreen, { name: 'ProfileHome' }, (t) => t.includes('Likes & dislikes|No plan'));
    await tap(r, (l) => l.startsWith('Likes & dislikes'));
    expect(JSON.stringify(r.nav)).not.toContain('ExercisePrefs');
    expectHealthy(r);
    await r.unmount();
  });

  it('with a builder plan: counts on the row; it opens the screen', async () => {
    const launched = await h.launch();
    await setUp(launched.services);
    await bensPlan(launched.services);
    const r = await renderScreen(h, launched, ProfileScreen, { name: 'ProfileHome' }, (t) => t.includes('Likes & dislikes|None'));
    await tap(r, (l) => l.startsWith('Likes & dislikes'));
    expect(JSON.stringify(r.nav)).toContain('ExercisePrefs');
    expectHealthy(r);
    await r.unmount();
  });

  it('Add under Not preferred (the picker) → listed, and the plan’s `In your plan … · Replace` line; Remove clears both', async () => {
    const launched = await h.launch();
    const s = launched.services;
    await setUp(s);
    await bensPlan(s);
    const r = await renderScreen(h, launched, ExercisePrefsScreen, { name: 'ExercisePrefs' }, (t) => t.includes('Liked') && t.includes('Not preferred'));
    expect(r.text()).not.toContain('Leg extension');
    // The second `Add` is Not preferred's.
    await tap(r, (l) => l === 'Add', 1);
    await r.waitFor((t) => t.includes('|Leg extension|'), 'the picker');
    await tap(r, (l) => l.startsWith('Leg extension'));
    await r.waitFor((t) => t.includes('Leg extension · In your plan: Legs A, Legs B') && t.includes('Replace'), 'listed and the Replace line');
    const v = await s.exercisePrefs.view();
    expect(v.kind === 'ready' ? v.notPreferred.map((x) => x.key) : null).toEqual(['machine-leg-extension']);
    await tap(r, (l) => l === 'Remove Leg extension');
    await r.waitFor((t) => !t.includes('Leg extension'), 'removed');
    expectHealthy(r);
    await r.unmount();
  });

  it('a dislike set on Profile shows on Plan setup › Any preferences as `Not preferred · Leg extension ×`', async () => {
    const launched = await h.launch();
    const s = launched.services;
    await setUp(s);
    await bensPlan(s);
    const v = await s.exercisePrefs.view();
    if (v.kind !== 'ready') throw new Error('no plan');
    expect((await s.exercisePrefs.set({ exercise: catalogueExerciseId('machine-leg-extension'), preference: 'not_preferred', expectedVersion: v.version, opId: h.ids() })).ok).toBe(true);
    const r = await renderScreen(h, launched, PlanSetupScreen, { name: 'PlanSetup', params: { editPlanId: v.planId } }, (t) => t.includes('Any preferences'));
    await tap(r, (l) => l.startsWith('Any preferences'));
    await r.waitFor((t) => t.includes('Not preferred|Leg extension ×') && t.includes('Leg extension · In your plan: Legs A, Legs B'), 'the Not preferred chips');
    expectHealthy(r);
    await r.unmount();
  });
});
